import Defaults from "../../components/Global/Defaults.ts";
import Session from "../../components/Global/Session.ts";
import Logger from "../Logger.ts";
import {
  redactQueryHeaders,
  summarizeQueries,
  summarizeQueryResponse,
  summarizeQueryResult,
} from "./QueryLog.ts";
import {
  buildSpicyApiHeaders,
  buildSpicyApiRequestBody,
} from "./SpicyRequestContract.ts";
import {
  Acquire,
  IsTripStatus,
  ParseRetryAfter,
  SettleFailure,
  SettleNeutral,
  SettleSuccess,
} from "./CircuitBreaker.ts";

export type Query = {
  operation: string;
  variables?: any;
};

export type QueryObjectResult = {
  data: any;
  httpStatus: number;
  format: "text" | "json";
};

export type QueryObject = {
  operation: string;
  operationId: string;
  result: QueryObjectResult;
};

export interface QueryResultGetter {
  get(operationId: string): QueryObjectResult | undefined;
}

const queryLogger = new Logger("API Query");

export class QueryHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(status: number, retryAfterMs?: number) {
    super(`Request failed with status ${status}`);
    this.name = "QueryHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export type QueryNetworkFailureKind = "aborted" | "network" | "timeout";

export class QueryNetworkError extends Error {
  readonly kind: QueryNetworkFailureKind;

  constructor(cause: unknown, kind: QueryNetworkFailureKind) {
    super(kind === "timeout"
      ? "Request exceeded the 15-second deadline"
      : kind === "aborted"
        ? "Request was aborted"
        : "Request failed before a response could be read");
    this.name = "QueryNetworkError";
    this.cause = cause;
    this.kind = kind;
  }
}

export const SPICY_API_REQUEST_TIMEOUT_MS = 15_000;

export type QueryOptions = {
  probe?: boolean;
  signal?: AbortSignal;
};

function requestDeadline(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Spicy API request timed out", "TimeoutError"));
  }, SPICY_API_REQUEST_TIMEOUT_MS);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

export async function Query(
  queries: Query[],
  headers: Record<string, string> = {},
  options: QueryOptions = {},
): Promise<QueryResultGetter> {
  const host = Defaults.lyrics.api.url;
  const clientVersion = Session.SpicyLyrics.GetCurrentVersion();
  if (options.signal?.aborted) {
    throw new QueryNetworkError(options.signal.reason, "aborted");
  }
  const lease = Acquire(options.probe === true);
  const deadline = requestDeadline(options.signal);

  queryLogger.info("Sending API query request", {
    queries: summarizeQueries(queries),
    host,
    clientVersion: clientVersion?.Text,
    headers: redactQueryHeaders(headers),
  });

  try {
    const res = await fetch(`${host}/query`, {
      method: "POST",
      signal: deadline.signal,
      headers: buildSpicyApiHeaders(clientVersion?.Text ?? "", headers),
      body: buildSpicyApiRequestBody(
        queries,
        clientVersion?.Text ?? "unknown",
      ),
    });

    queryLogger.info("Received response", { status: res.status });

    if (IsTripStatus(res.status)) {
      const retryAfterMs = ParseRetryAfter(res.headers.get("Retry-After"));
      SettleFailure(lease, retryAfterMs);
      queryLogger.error(`Request refused with status ${res.status}`);
      throw new QueryHttpError(res.status, retryAfterMs);
    }

    SettleSuccess(lease);

    if (!res.ok) {
      queryLogger.error(`Request failed with status ${res.status}`);
      throw new QueryHttpError(res.status);
    }

    let data: any;
    try {
      data = await res.json();
    } catch (error) {
      if (deadline.signal.aborted) {
        throw new QueryNetworkError(
          error,
          deadline.timedOut() ? "timeout" : "aborted",
        );
      }
      throw error;
    }
    queryLogger.debug("Response summary", summarizeQueryResponse(data));
    const results: Map<string, QueryObjectResult> = new Map();

    for (const job of data.queries) {
      results.set(job.operationId, job.result);
      queryLogger.debug("Query result set", {
        operationId: job.operationId,
        result: summarizeQueryResult(job.result),
      });
    }

    return {
      get(operationId: string): QueryObjectResult | undefined {
        queryLogger.debug("Attempting to retrieve query result for operationId", operationId);
        const result = results.get(operationId);
        if (!result) {
          queryLogger.warn("Query result not found for operationId", operationId, Array.from(results.keys()));
        } else {
          queryLogger.debug(
            "Query result retrieved for operationId",
            operationId,
            summarizeQueryResult(result),
          );
        }
        return result;
      },
    };
  } catch (error) {
    if (error instanceof QueryHttpError || error instanceof QueryNetworkError) {
      queryLogger.error("Query error", error);
      throw error;
    }
    if (options.signal?.aborted) {
      SettleNeutral(lease);
      const aborted = new QueryNetworkError(error, "aborted");
      queryLogger.error("Query error", aborted);
      throw aborted;
    }
    if (deadline.timedOut()) {
      SettleFailure(lease);
      const timedOut = new QueryNetworkError(error, "timeout");
      queryLogger.error("Query error", timedOut);
      throw timedOut;
    }
    SettleFailure(lease);
    const networkError = new QueryNetworkError(error, "network");
    queryLogger.error("Query error", networkError);
    throw networkError;
  } finally {
    deadline.dispose();
  }
}
