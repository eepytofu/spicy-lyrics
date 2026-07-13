import { describe, expect, it } from "vitest";
import { amllDbProvider } from "../src/providers/amlldb";
import { kugouProvider } from "../src/providers/kugou";
import { neteaseProvider } from "../src/providers/netease";
import { decryptQrc, fetchQqLyric, parseQrc, qrcContent, qqProvider, searchQq } from "../src/providers/qq";

const live = process.env.LIVE_PROVIDER_TESTS === "1" ? it : it.skip;

describe("live upstream providers", () => {
  live("AMLL DB returns the personal TTML fixture with background vocals", async () => {
    const ttml = await amllDbProvider({ id: "7aSXHJ8djFxfqKLuOs039d", title: "乐鸣东方", artists: ["洛天依"], album: "乐鸣东方", durationMs: 240_000 });
    expect(ttml?.ttml).toContain("<tt");
    expect(ttml?.ttml).toContain("x-bg");
    expect(ttml?.ttml).toContain("ttm:agent");
  }, 30000);

  live("QQ returns native lyrics", async () => {
    const track = { id: "personal-fixture", title: "乐鸣东方", artists: ["洛天依"], album: "", durationMs: 240_000 };
    const songs = await searchQq(track);
    expect(songs.length).toBeGreaterThan(0);
    const payload = await fetchQqLyric(songs[0], track);
    expect(payload?.lyric?.length).toBeGreaterThan(0);
    const decrypted = decryptQrc(payload.lyric);
    expect(decrypted?.length).toBeGreaterThan(0);
    expect(parseQrc(qrcContent(decrypted) ?? "").length).toBeGreaterThan(0);
    const result = await qqProvider(track);
    expect(result?.Type).toBe("Syllable");
  }, 30000);

  live("Kugou returns native lyrics", async () => {
    const result = await kugouProvider({ id: "test", title: "逝去日子", artists: ["Beyond"], album: "", durationMs: 225000 });
    expect(result?.Type).toBe("Syllable");
  }, 30000);

  live("NetEase returns native lyrics", async () => {
    const result = await neteaseProvider({ id: "personal-fixture", title: "乐鸣东方", artists: ["洛天依"], album: "", durationMs: 240_000 });
    expect(["Syllable", "Line"]).toContain(result?.Type);
  }, 30000);
});
