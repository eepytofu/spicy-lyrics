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

  live("NetEase Cloud Music returns native lyrics", async () => {
    const result = await neteaseProvider({ id: "personal-fixture", title: "乐鸣东方", artists: ["洛天依"], album: "", durationMs: 240_000 });
    expect(["Syllable", "Line"]).toContain(result?.Type);
  }, 30000);

  live("NetEase Cloud Music preserves distinct synced-lyrics and translation contributors", async () => {
    const result = await neteaseProvider({
      id: "personal-fixture",
      title: "一梦红尘",
      artists: ["Risa Yuzuki", "BlackY"],
      album: "ELYSIAN",
      durationMs: 219_440,
    });
    expect(result?.ProviderCredits).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "syncedLyrics", name: "Hendrix_u", provider: "netease" }),
      expect.objectContaining({ role: "translation", name: "冰霜暗月", provider: "netease" }),
    ]));
  }, 30000);

  live("KuGou retrieves the exact DJ fixture through catalog hash matching", async () => {
    const track = {
      id: "personal-dj-fixture",
      title: "大東北我的家鄉(DJ何鵬版)",
      artists: ["何玉"],
      album: "大東北我的家鄉",
      durationMs: 246_806,
    };
    const [qq, netease, kugou] = await Promise.all([
      qqProvider(track),
      neteaseProvider(track),
      kugouProvider(track),
    ]);

    expect(["Syllable", "Line"]).toContain(netease?.Type);
    expect(kugou?.Type).toBe("Syllable");
    expect(Array.isArray(kugou?.Content) ? kugou.Content.length : 0).toBeGreaterThan(40);
    expect(kugou?.SourceMatch).toMatchObject({
      title: "大东北我的家乡 (DJ何鹏版)",
      artists: ["何玉"],
      album: "大东北我的家乡",
      durationMs: 246_000,
      method: "catalog-hash",
      evidence: { versionConflict: false },
    });
    if (qq) {
      expect(qq.Type).toBe("Syllable");
      expect(qq.SourceMatch?.evidence?.versionConflict).toBe(false);
    }
  }, 30000);
});
