import { describe, expect, it, vi } from "vitest";
import { createAmllDbProvider } from "../src/providers/amlldb";

const track = { id: "spotify-track", title: "乐鸣东方", artists: ["洛天依"], album: "乐鸣东方", durationMs: 240_000 };
const ttml = '<tt xmlns="http://www.w3.org/ns/ttml"><body /></tt>';

describe("AMLL TTML DB provider", () => {
  it("prefers the Spotify track-id mapping", async () => {
    const fetchMock = vi.fn(async () => new Response(ttml, { status: 200 })) as unknown as typeof fetch;
    const result = await createAmllDbProvider(fetchMock)(track);
    expect(result?.ttml).toBe(ttml);
    expect(result?.match.method).toBe("spotify-id");
    expect(result?.match.confidence).toBe(1);
    expect(String((fetchMock as any).mock.calls[0][0])).toContain("/spotify/spotify-track?format=ttml");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to title search and accepts platform artist aliases", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/spotify/")) return new Response("missing", { status: 404 });
      if (url.includes("/api/search-lyrics")) return Response.json([{ title: "乐鸣东方", artists: ["洛天依Official"], file: "fixture.ttml" }]);
      if (url.includes("/raw-lyrics/fixture.ttml")) return new Response(ttml, { status: 200 });
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;
    const result = await createAmllDbProvider(fetchMock)(track);
    expect(result?.ttml).toBe(ttml);
    expect(result?.match.method).toBe("title-search");
    expect((fetchMock as any).mock.calls.some((call: any[]) => String(call[0]).includes("/raw-lyrics/fixture.ttml"))).toBe(true);
  });
});
