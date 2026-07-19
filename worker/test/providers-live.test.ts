import { describe, expect, it } from "vitest";
import { amllDbProvider } from "../src/providers/amlldb";
import { kugouProvider } from "../src/providers/kugou";
import { neteaseProvider, searchNetease } from "../src/providers/netease";
import { qqProvider } from "../src/providers/qq";
import { sodaProvider } from "../src/providers/soda";

const live = process.env.LIVE_PROVIDER_TESTS === "1" ? it : it.skip;

describe("live upstream providers", () => {
  live("AMLL DB returns the personal TTML fixture with background vocals", async () => {
    const ttml = await amllDbProvider({ id: "7aSXHJ8djFxfqKLuOs039d", title: "乐鸣东方", artists: ["洛天依"], album: "乐鸣东方", durationMs: 240_000 });
    expect(ttml?.ttml).toContain("<tt");
    expect(ttml?.ttml).toContain("x-bg");
    expect(ttml?.ttml).toContain("ttm:agent");
  }, 30000);

  live("QQ returns native lyrics for a regular catalog track", async () => {
    const result = await qqProvider({
      id: "personal-fixture",
      title: "乐鸣东方",
      artists: ["洛天依"],
      album: "乐鸣东方",
      durationMs: 240_000,
    });

    expect(result?.Type).toBe("Syllable");
    expect(Array.isArray(result?.Content) ? result.Content.length : 0).toBeGreaterThan(20);
    expect(result?.SourceMatch?.evidence?.versionConflict).toBe(false);
  }, 30000);

  live("QQ retrieves the exact DJ fixture end to end", async () => {
    const track = {
      id: "personal-dj-fixture",
      title: "大東北我的家鄉(DJ何鵬版)",
      artists: ["何玉"],
      album: "大東北我的家鄉",
      durationMs: 246_806,
    };
    const result = await qqProvider(track);
    expect(result?.Type).toBe("Syllable");
    expect(Array.isArray(result?.Content) ? result.Content.length : 0).toBeGreaterThan(40);
    expect(result?.SourceMatch).toMatchObject({
      title: "大东北我的家乡 (DJ何鹏版)",
      artists: ["何玉"],
      album: "大东北我的家乡",
      durationMs: 246_000,
      method: "search",
      evidence: { versionConflict: false },
    });
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
    const [netease, kugou] = await Promise.all([
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
      method: "catalog-hash-mobile-http",
      evidence: { versionConflict: false },
    });
  }, 30000);

  live("KuGou keeps a strong DJ catalog match when the lyric record shortens its title", async () => {
    const result = await kugouProvider({
      id: "nanshan-dj-fixture",
      title: "南山雪 - Dj降调版",
      artists: ["祥嘞嘞", "无名"],
      album: "南山雪 (Dj降调版)",
      durationMs: 202_000,
    });

    expect(result?.Type).toBe("Syllable");
    expect(Array.isArray(result?.Content) ? result.Content.length : 0).toBeGreaterThan(40);
    expect(result?.SourceMatch).toMatchObject({
      title: "南山雪 (DJ降调版)",
      artists: ["祥嘞嘞"],
      album: "南山雪",
      durationMs: 201_000,
      method: "catalog-hash-mobile-http",
      evidence: { versionConflict: false },
    });
  }, 30000);

  live("KuGou mobile catalog retrieves a Japanese catalog track omitted by WebFilter", async () => {
    const result = await kugouProvider({
      id: "japanese-catalog-fixture",
      title: "夜に駆ける",
      artists: ["YOASOBI"],
      album: "夜に駆ける",
      durationMs: 261_000,
    });
    expect(result?.Type).toBe("Syllable");
    expect(Array.isArray(result?.Content) ? result.Content.length : 0).toBeGreaterThan(20);
    expect(result?.SourceMatch).toMatchObject({
      title: "夜に駆ける",
      artists: ["YOASOBI"],
      method: "catalog-hash-mobile-http",
      evidence: { versionConflict: false },
    });
  }, 30000);

  live("KuGou mobile catalog retrieves a Japanese song with localized artist metadata", async () => {
    const result = await kugouProvider({
      id: "localized-artist-fixture",
      title: "Bad Apple!!",
      artists: ["nomico"],
      album: "Lovelight",
      durationMs: 319_000,
    });
    expect(result?.Type).toBe("Syllable");
    expect(result?.SourceMatch?.title).toBe("Bad Apple!!");
    expect(result?.SourceMatch?.evidence?.versionConflict).toBe(false);
  }, 30000);

  live("NetEase Cloud Music retrieves the localized Bad Apple catalog entry", async () => {
    const result = await neteaseProvider({
      id: "localized-artist-fixture",
      title: "Bad Apple!!",
      artists: ["のみこ"],
      album: "μοναξιά",
      durationMs: 315_374,
    });
    expect(["Syllable", "Line"]).toContain(result?.Type);
    expect(result?.SourceMatch?.title).toBe("Bad Apple!!");
    expect(result?.SourceMatch?.evidence?.versionConflict).toBe(false);
  }, 30000);

  live("NetEase Cloud Music keeps returned Japanese artist aliases", async () => {
    const songs = await searchNetease({
      id: "localized-artist-fixture",
      title: "瑠璃の鳥",
      artists: ["霜月遥"],
      album: "",
      durationMs: 284_000,
    });
    const song = songs.find((candidate) => candidate.name === "瑠璃の鳥");
    expect(song?.artists).toContain("霜月はるか");
    expect(song?.artistAliases).toContain("霜月遥");
  }, 30000);

  live("Soda Music returns native KRC for a regular catalog track", async () => {
    const result = await sodaProvider({
      id: "soda-regular-fixture",
      title: "一梦红尘",
      artists: ["Risa Yuzuki", "BlackY"],
      album: "ELYSIAN",
      durationMs: 219_440,
    });
    expect(result?.Type).toBe("Syllable");
    expect(Array.isArray(result?.Content) ? result.Content.length : 0).toBeGreaterThan(20);
    expect(result?.SourceMatch).toMatchObject({
      title: "一梦红尘",
      artists: ["Risa Yuzuki", "BlackY"],
      method: "luna-pc-krc",
      evidence: { versionConflict: false },
    });
  }, 30000);

  live("Soda Music retrieves the exact DJ fixture as native KRC", async () => {
    const result = await sodaProvider({
      id: "soda-dj-fixture",
      title: "大東北我的家鄉(DJ何鵬版)",
      artists: ["何玉"],
      album: "大東北我的家鄉",
      durationMs: 246_806,
    });
    expect(result?.Type).toBe("Syllable");
    expect(Array.isArray(result?.Content) ? result.Content.length : 0).toBeGreaterThan(40);
    expect(result?.SourceMatch).toMatchObject({
      title: "大东北我的家乡(DJ何鹏版)",
      artists: ["何玉"],
      durationMs: 246_807,
      method: "luna-pc-krc",
      evidence: { versionConflict: false },
    });
  }, 30000);
});
