import { describe, expect, it, vi } from "vitest";
import {
  type ResponseCache,
  withResponseCache,
} from "../src/http/cache";

function cache(): ResponseCache & {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
} {
  return {
    match: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
  };
}

describe("Worker response cache", () => {
  it("returns a cached GET without calling the provider handler", async () => {
    const stored = new Response("cached", {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
    const responseCache = cache();
    responseCache.match.mockResolvedValue(stored);
    const handler = vi.fn(async () => new Response("fresh"));

    const response = await withResponseCache(handler, responseCache)(
      new Request("https://worker.test/v1/lyrics/qq/id?title=Song"),
    );

    expect(await response.text()).toBe("cached");
    expect(handler).not.toHaveBeenCalled();
    expect(responseCache.put).not.toHaveBeenCalled();
  });

  it("stores public successful responses", async () => {
    const responseCache = cache();
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    const handler = vi.fn(async () => new Response("fresh", {
      status: 200,
      headers: { "Cache-Control": "public, max-age=3600" },
    }));

    await withResponseCache(handler, responseCache, waitUntil)(
      new Request("https://worker.test/v1/lyrics/qq/id?title=Song"),
    );

    expect(responseCache.put).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
    await waitUntil.mock.calls[0][0];
  });

  it("does not cache preflight, no-match, invalid, timeout, abort, or failure responses", async () => {
    for (const status of [400, 404, 499, 502, 504]) {
      const responseCache = cache();
      const handler = vi.fn(async () => new Response("not reusable", {
        status,
        headers: { "Cache-Control": "no-store" },
      }));

      await withResponseCache(handler, responseCache)(
        new Request("https://worker.test/v1/lyrics/qq/id", {
          method: status === 400 ? "OPTIONS" : "GET",
        }),
      );

      if (status === 400) expect(responseCache.match).not.toHaveBeenCalled();
      expect(responseCache.put).not.toHaveBeenCalled();
    }
  });

  it("continues to the provider when a cache read fails", async () => {
    const responseCache = cache();
    responseCache.match.mockRejectedValue(new Error("cache unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn(async () => new Response("fresh", {
      headers: { "Cache-Control": "no-store" },
    }));

    const response = await withResponseCache(handler, responseCache)(
      new Request("https://worker.test/v1/lyrics/qq/id"),
    );

    expect(await response.text()).toBe("fresh");
    expect(handler).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "[worker] response cache read failed",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});
