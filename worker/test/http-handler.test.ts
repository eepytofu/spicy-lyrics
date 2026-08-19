import { describe, expect, it, vi } from "vitest";
import {
  type ProviderAdapter,
  type ProviderAdapterRegistry,
  type ProviderPayload,
  type WorkerProviderId,
} from "../src/acquisition";
import { createWorkerHandler, parseTrackMetadata } from "../src/http/handler";
import { ProviderRateLimitError, ProviderUpstreamError } from "../src/http/fetch";

const trackQuery =
  "?request_version=19&title=Song&artist_name=First&artist_name=Second&album=Album&duration=240";

function adapters(
  provider: WorkerProviderId,
  adapter: ProviderAdapter,
): ProviderAdapterRegistry {
  const noMatch: ProviderAdapter = async () => undefined;
  return {
    amlldb: noMatch,
    qq: noMatch,
    kugou: noMatch,
    netease: noMatch,
    soda: noMatch,
    [provider]: adapter,
  };
}

function request(
  provider: WorkerProviderId = "qq",
  query = trackQuery,
  init?: RequestInit,
): Request {
  return new Request(`https://worker.test/v1/lyrics/${provider}/track-id${query}`, init);
}

describe("Worker HTTP boundary", () => {
  it("handles CORS preflight without acquiring lyrics", async () => {
    const adapter = vi.fn<ProviderAdapter>();
    const response = await createWorkerHandler(adapters("qq", adapter))(
      request("qq", trackQuery, { method: "OPTIONS" }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(adapter).not.toHaveBeenCalled();
  });

  it("rejects unknown routes and unsupported methods", async () => {
    const handler = createWorkerHandler();
    expect((await handler(new Request("https://worker.test/unknown"))).status).toBe(404);
    expect((await handler(request("qq", trackQuery, { method: "POST" }))).status).toBe(404);
  });

  it("rejects malformed track IDs and incomplete metadata", async () => {
    const handler = createWorkerHandler();
    expect(
      (
        await handler(
          new Request(`https://worker.test/v1/lyrics/qq/%${trackQuery}`),
        )
      ).status,
    ).toBe(400);
    expect((await handler(request("qq", "?request_version=19&title=Song&duration=240"))).status).toBe(400);
  });

  it("rejects stale request contracts and oversized metadata", async () => {
    const handler = createWorkerHandler();
    expect((await handler(request("qq", trackQuery.replace("request_version=19", "request_version=18")))).status).toBe(426);
    expect((await handler(request("qq", `${trackQuery}&artist_name=${"x".repeat(257)}`))).status).toBe(400);
  });

  it("parses repeated artist fields", () => {
    expect(
      parseTrackMetadata(new URL(`https://worker.test/${trackQuery}`), "id"),
    ).toEqual({
      id: "id",
      title: "Song",
      artists: ["First", "Second"],
      album: "Album",
      durationMs: 240_000,
    });
  });

  it("rejects the removed comma-separated artist field", () => {
    expect(
      parseTrackMetadata(
        new URL("https://worker.test/?title=Song&artist=First,Second&duration=1.5"),
        "id",
      ),
    ).toBeUndefined();
  });

  it("serializes native JSON with the cache and CORS contract", async () => {
    const payload: ProviderPayload = {
      format: "json",
      lyrics: {
        Type: "Static",
        Lines: [{ Text: "作词：Writer", ProviderInfoKind: "credit" }],
        source: "qq",
        fetchProvider: "qq",
        sourceDisplayName: "QQ Music",
      },
    };
    const response = await createWorkerHandler(
      adapters("qq", async () => payload),
    )(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe("public, max-age=3600, stale-if-error=86400");
    expect(response.headers.get("Cache-Tag")).toBe("spicy-lyrics-v19");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toMatchObject({
      Type: "Static",
      source: "qq",
      Lines: [{ Text: "作词：Writer", ProviderInfoKind: "credit" }],
    });
  });

  it("serializes AMLL TTML and match metadata", async () => {
    const payload: ProviderPayload = {
      format: "ttml",
      ttml: "<tt></tt>",
      match: {
        title: "Song",
        artists: ["First"],
        score: 110,
        confidence: 1,
        method: "spotify-id",
      },
    };
    const response = await createWorkerHandler(
      adapters("amlldb", async () => payload),
    )(request("amlldb"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/ttml+xml");
    expect(
      JSON.parse(decodeURIComponent(response.headers.get("X-Spicy-Lyrics-Match")!)),
    ).toMatchObject({ method: "spotify-id", confidence: 1 });
    expect(await response.text()).toBe("<tt></tt>");
  });

  it("distinguishes no-match, timeout, abort, and provider error outcomes", async () => {
    const noMatch = await createWorkerHandler(
      adapters("qq", async () => undefined),
    )(request());
    expect(noMatch.status).toBe(404);
    expect(noMatch.headers.get("Cache-Control")).toBe("no-store");

    const timeout = await createWorkerHandler(
      adapters("qq", async () => {
        throw new DOMException("Timed out", "AbortError");
      }),
    )(request());
    expect(timeout.status).toBe(504);
    expect(timeout.headers.get("Cache-Control")).toBe("no-store");

    const rateLimited = await createWorkerHandler(
      adapters("qq", async () => {
        throw new ProviderRateLimitError("limited", "5");
      }),
    )(request());
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("Retry-After")).toBe("5");

    const upstreamFailed = await createWorkerHandler(
      adapters("qq", async () => {
        throw new ProviderUpstreamError("failed", 503);
      }),
    )(request());
    expect(upstreamFailed.status).toBe(502);

    const controller = new AbortController();
    controller.abort();
    const aborted = await createWorkerHandler(
      adapters("qq", async () => {
        throw new Error("must not run");
      }),
    )(request("qq", trackQuery, { signal: controller.signal }));
    expect(aborted.status).toBe(499);
    expect(aborted.headers.get("Cache-Control")).toBe("no-store");

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await createWorkerHandler(
      adapters("qq", async () => {
        throw new Error("upstream");
      }),
    )(request());
    expect(failed.status).toBe(502);
    expect(failed.headers.get("Cache-Control")).toBe("no-store");
    expect(consoleError).toHaveBeenCalledWith(
      "[worker] provider request failed",
      { provider: "qq", category: "provider-error" },
    );
    consoleError.mockRestore();
  });

  it("rejects malformed successful payloads without exposing the body", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await createWorkerHandler(
      adapters("qq", async () => ({ format: "json", lyrics: {} as any })),
    )(request());
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(consoleError).toHaveBeenCalledWith(
      "[worker] invalid provider response",
      { provider: "qq", category: "invalid-payload" },
    );

    const invalidMarker = await createWorkerHandler(
      adapters("qq", async () => ({
        format: "json",
        lyrics: {
          Type: "Static",
          Lines: [{ Text: "line", ProviderInfoKind: "unknown" }],
          source: "qq",
          fetchProvider: "qq",
          sourceDisplayName: "QQ Music",
        } as any,
      })),
    )(request());
    expect(invalidMarker.status).toBe(502);
    consoleError.mockRestore();
  });

  it("passes the incoming request signal to the provider adapter", async () => {
    let receivedSignal: AbortSignal | undefined;
    const response = await createWorkerHandler(
      adapters("qq", async (_track, context) => {
        receivedSignal = context.signal;
        return undefined;
      }),
    )(request());

    expect(response.status).toBe(404);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });
});
