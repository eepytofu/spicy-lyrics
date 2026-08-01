export type QueryLogEntry = {
  operation: string;
  variables?: unknown;
};

const SENSITIVE_HEADER_NAME = /(?:authorization|auth|token|cookie|secret|api[-_]?key)/iu;

export function redactQueryHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER_NAME.test(name) ? "[redacted]" : value,
    ]),
  );
}

export function summarizeQueries(
  queries: readonly QueryLogEntry[],
): Array<{ operation: string; variableKeys: string[] }> {
  return queries.map((query) => ({
    operation: query.operation,
    variableKeys:
      query.variables && typeof query.variables === "object" && !Array.isArray(query.variables)
        ? Object.keys(query.variables as Record<string, unknown>).sort()
        : [],
  }));
}

export function summarizeQueryResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") {
    return { hasResult: false };
  }

  const value = result as Record<string, unknown>;
  return {
    hasResult: true,
    httpStatus: value.httpStatus,
    format: value.format,
    hasData: value.data !== undefined && value.data !== null,
  };
}

export function summarizeQueryResponse(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return { queryCount: 0 };
  }

  const jobs = (data as Record<string, unknown>).queries;
  if (!Array.isArray(jobs)) {
    return { queryCount: 0 };
  }

  return {
    queryCount: jobs.length,
    results: jobs.map((job) => {
      if (!job || typeof job !== "object") return { hasResult: false };
      const value = job as Record<string, unknown>;
      return {
        operationId: value.operationId,
        ...summarizeQueryResult(value.result),
      };
    }),
  };
}
