import { describe, expect, it, vi } from "vitest";
import {
  type ProviderAdapter,
  type ProviderAdapterRegistry,
  type ProviderPayload,
  type WorkerProviderId,
} from "../src/acquisition";
import { createWorkerHandler, parseTrackMetadata } from "../src/http/handler";

const trackQuery =
  "?title=Song&artist_name=First&artist_name=Second&album=Album&duration=240";

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
    expect((await handler(request("qq", "?title=Song&duration=240"))).status).toBe(400);
  });

  it("parses repeated artists and the legacy comma-separated artist field", () => {
    expect(
      parseTrackMetadata(new URL(`https://worker.test/${trackQuery}`), "id"),
    ).toEqual({
      id: "id",
      title: "Song",
      artists: ["First", "Second"],
      album: "Album",
      durationMs: 240_000,
    });
    expect(
      parseTrackMetadata(
        new URL("https://worker.test/?title=Song&artist=First,Second&duration=1.5"),
        "id",
      )?.artists,
    ).toEqual(["First", "Second"]);
  });

  it("serializes native JSON with the compatible cache and CORS contract", async () => {
    const payload: ProviderPayload = {
      format: "json",
      lyrics: {
        Type: "Static",
        Lines: [{ Text: "line" }],
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
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toMatchObject({ Type: "Static", source: "qq" });
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

    const timeout = await createWorkerHandler(
      adapters("qq", async () => {
        throw new DOMException("Timed out", "AbortError");
      }),
    )(request());
    expect(timeout.status).toBe(504);

    const controller = new AbortController();
    controller.abort();
    const aborted = await createWorkerHandler(
      adapters("qq", async () => {
        throw new Error("must not run");
      }),
    )(request("qq", trackQuery, { signal: controller.signal }));
    expect(aborted.status).toBe(499);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await createWorkerHandler(
      adapters("qq", async () => {
        throw new Error("upstream");
      }),
    )(request());
    expect(failed.status).toBe(502);
    expect(consoleError).toHaveBeenCalledWith(
      "[worker] qq failed",
      expect.any(Error),
    );
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
