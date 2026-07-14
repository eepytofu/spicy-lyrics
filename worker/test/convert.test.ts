import { describe, expect, it } from "vitest";
import { toLineLyrics, toSyllableLyrics } from "../src/convert";
import { dedupeProviderCredits, extractByCredit } from "../src/credits";
import { parseKrc } from "../src/providers/kugou";
import { parseQrc } from "../src/providers/qq";
import { neteaseProviderCredits, parseYrc } from "../src/providers/netease";

describe("native word-sync conversion", () => {
  it("parses QRC absolute word timings", () => {
    const lines = parseQrc("[1000,1000]你(1000,400)好(1400,600)");
    expect(lines[0].words.map((word) => word.text)).toEqual(["你", "好"]);
    expect(toSyllableLyrics(lines, "qq")?.Type).toBe("Syllable");
  });

  it("parses KRC relative word timings", () => {
    const lines = parseKrc("[1000,1000]<0,400,0>你<400,600,0>好");
    expect(lines[0].words[1].startMs).toBe(1400);
  });

  it("parses YRC absolute word timings", () => {
    const lines = parseYrc("[1000,1000](1000,400,0)你(1400,600,0)好");
    expect(lines[0].words[1].startMs).toBe(1400);
  });

  it("keeps translation and romanization on line-timed fallback lyrics", () => {
    const lyrics = toLineLyrics(
      "[00:01.00]original",
      3000,
      "netease",
      "[00:01.00]translation",
      "[00:01.00]romanization",
    ) as any;
    expect(lyrics.Content[0]).toMatchObject({
      ProviderTranslatedText: "translation",
      TranslatedText: "translation",
      ProviderRomanizedText: "romanization",
      RomanizedText: "romanization",
    });
    expect(lyrics.IncludesTranslation).toBe(true);
    expect(lyrics.IncludesRomanization).toBe(true);
  });

  it("does not advertise unmatched sidecars", () => {
    const lyrics = toLineLyrics(
      "[00:01.00]original",
      3000,
      "netease",
      "[00:10.00]too far away",
    ) as any;
    expect(lyrics.Content[0].ProviderTranslatedText).toBeUndefined();
    expect(lyrics.IncludesTranslation).toBe(false);
  });

  it("preserves distinct NetEase Cloud Music synced-lyrics and translation contributors", () => {
    expect(neteaseProviderCredits({
      lyricUser: { userid: 6493075429, nickname: "Hendrix_u" },
      transUser: { userid: 270201970, nickname: "冰霜暗月" },
      tlyric: { lyric: "[by:冰霜暗月]\n[00:01.00]translation" },
    })).toEqual([
      { role: "syncedLyrics", name: "Hendrix_u", provider: "netease", userId: "6493075429" },
      { role: "translation", name: "冰霜暗月", provider: "netease", userId: "270201970" },
    ]);
  });

  it("uses translation by-tags only when richer contributor metadata is absent", () => {
    expect(neteaseProviderCredits({
      tlyric: { lyric: "[by:community editor]\n[00:01.00]translation" },
    })).toEqual([
      { role: "translation", name: "community editor", provider: "netease" },
    ]);
  });

  it("extracts and de-duplicates plain provider by-tags", () => {
    const credit = extractByCredit("[ti:title]\n[by:  contributor  ]\n[00:01.00]line", "lyrics", "qq");
    expect(dedupeProviderCredits([credit, credit])).toEqual([
      { role: "lyrics", name: "contributor", provider: "qq" },
    ]);
  });
});
