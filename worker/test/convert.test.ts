import { describe, expect, it } from "vitest";
import { attachSidecars, toLineLyrics, toSyllableLyrics } from "../src/convert";
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
      ProviderRomanizedText: "romanization",
      RomanizedText: "romanization",
    });
    expect(lyrics.Content[0].TranslatedText).toBeUndefined();
    expect(lyrics.IncludesTranslation).toBe(true);
    expect(lyrics.HasProviderTranslations).toBe(true);
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

  it("treats a NetEase Cloud Music instrumental sentinel as no usable lyrics", () => {
    expect(toLineLyrics(
      "[00:00.00] 纯音乐，请欣赏。 ",
      180_000,
      "netease",
    )).toBeUndefined();

    expect(toSyllableLyrics([{
      startMs: 0,
      durationMs: 2000,
      words: [
        { text: "纯音乐", startMs: 0, durationMs: 800 },
        { text: ",请欣赏", startMs: 800, durationMs: 1200 },
      ],
    }], "netease")).toBeUndefined();
  });

  it("does not discard a real NetEase lyric document containing the sentinel text", () => {
    const lyrics = toLineLyrics(
      "[00:00.00]纯音乐，请欣赏\n[00:02.00]actual lyric",
      5000,
      "netease",
    ) as any;
    expect(lyrics.Content.map((line: any) => line.Text)).toEqual(["纯音乐，请欣赏", "actual lyric"]);
  });

  it("removes QQ marker-only lyric lines and sidecars", () => {
    const lines = attachSidecars([
      {
        startMs: 0,
        durationMs: 1000,
        words: [{ text: "//", startMs: 0, durationMs: 1000 }],
      },
      {
        startMs: 1000,
        durationMs: 1000,
        words: [{ text: "Hmm", startMs: 1000, durationMs: 1000 }],
      },
    ], "[00:00.00]translation for removed marker\n[00:01.00] ／／ ", "[00:01.00]//");
    const lyrics = toSyllableLyrics(lines, "qq") as any;

    expect(lyrics.Content).toHaveLength(1);
    expect(lyrics.Content[0].Lead.Syllables.map((word: any) => word.Text).join("")).toBe("Hmm");
    expect(lyrics.Content[0].Lead.ProviderTranslatedText).toBeUndefined();
    expect(lyrics.Content[0].Lead.ProviderRomanizedText).toBeUndefined();
    expect(lyrics.IncludesTranslation).toBe(false);
    expect(lyrics.IncludesRomanization).toBe(false);
  });

  it("preserves QQ lyric text that merely contains slashes", () => {
    const lyrics = toSyllableLyrics([{
      startMs: 0,
      durationMs: 1000,
      words: [{ text: "left // right", startMs: 0, durationMs: 1000 }],
      translation: "translation // note",
    }], "qq") as any;

    expect(lyrics.Content[0].Lead.Syllables[0].Text).toBe("left // right");
    expect(lyrics.Content[0].Lead.ProviderTranslatedText).toBe("translation // note");
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
