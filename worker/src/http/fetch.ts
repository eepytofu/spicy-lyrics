export const MAX_PROVIDER_BODY_BYTES = 2 * 1024 * 1024;

export class ProviderTimeoutError extends Error {
  override readonly name = "ProviderTimeoutError";
}

export class ProviderBodyLimitError extends Error {
  override readonly name = "ProviderBodyLimitError";
}

export class ProviderRateLimitError extends Error {
  override readonly name = "ProviderRateLimitError";

  constructor(message: string, readonly retryAfter?: string) {
    super(message);
  }
}

export class ProviderUpstreamError extends Error {
  override readonly name = "ProviderUpstreamError";

  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function isProviderTimeoutError(error: unknown): error is ProviderTimeoutError {
  return error instanceof ProviderTimeoutError
    || (typeof error === "object" && error !== null && "name" in error
      && (error as { name?: unknown }).name === "ProviderTimeoutError");
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("Request aborted", "AbortError");
}

export function throwIfProviderRequestFailed(error: unknown, signal?: AbortSignal | null): void {
  throwIfAborted(signal);
  if (
    isProviderTimeoutError(error)
    || error instanceof ProviderRateLimitError
    || error instanceof ProviderUpstreamError
  ) throw error;
}

export async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = 7000): Promise<Response> {
  throwIfAborted(init?.signal);
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new ProviderTimeoutError("Provider request timed out")), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (response.status === 429) {
      throw new ProviderRateLimitError("Provider rate limit exceeded", response.headers.get("Retry-After") ?? undefined);
    }
    if (response.status >= 500) {
      throw new ProviderUpstreamError(`Provider returned status ${response.status}`, response.status);
    }
    return response;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}


export async function readResponseText(
  response: Response,
  maximumBytes = MAX_PROVIDER_BODY_BYTES,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ProviderBodyLimitError(`Provider response exceeds ${maximumBytes} bytes`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel("Provider response body limit exceeded");
        throw new ProviderBodyLimitError(`Provider response exceeds ${maximumBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function readResponseJson<T = unknown>(
  response: Response,
  maximumBytes = MAX_PROVIDER_BODY_BYTES,
): Promise<T> {
  return JSON.parse(await readResponseText(response, maximumBytes)) as T;
}
