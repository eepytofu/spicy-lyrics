export function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("Request aborted", "AbortError");
}

export async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = 7000): Promise<Response> {
  throwIfAborted(init?.signal);
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Provider request timed out", "AbortError")),
    timeoutMs,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}
