export type ResponseCache = Pick<Cache, "match" | "put">;

export type WaitUntil = (promise: Promise<unknown>) => void;

function isCacheable(response: Response): boolean {
  return response.headers.get("Cache-Control")?.startsWith("public,") ?? false;
}

export function withResponseCache(
  handler: (request: Request) => Promise<Response>,
  cache: ResponseCache,
  waitUntil?: WaitUntil,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET" || request.signal.aborted) return handler(request);

    const cached = await cache.match(request).catch((error) => {
      console.error("[worker] response cache read failed", error);
      return undefined;
    });
    if (cached) return cached;

    const response = await handler(request);
    if (!isCacheable(response)) return response;

    const write = cache.put(request, response.clone()).catch((error) => {
      console.error("[worker] response cache write failed", error);
    });
    if (waitUntil) waitUntil(write);
    else await write;
    return response;
  };
}
