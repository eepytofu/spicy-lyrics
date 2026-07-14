import assert from "node:assert/strict";
import test from "node:test";
import {
  convertChineseLyricsText,
  convertChineseText,
  convertChineseTimedTextUnits,
  detectChineseCharacterForm,
  isChineseLyricsProvider,
  normalizeChineseProviderJapaneseText,
} from "../src/utils/Lyrics/ChineseCharacterConversion.ts";

test("converts between Simplified and Taiwan Traditional character forms", () => {
  assert.equal(convertChineseText("\u6f22\u8a9e", "simplified"), "\u6c49\u8bed");
  assert.equal(convertChineseText("\u6c49\u8bed", "traditional"), "\u6f22\u8a9e");
  assert.equal(convertChineseText("\u6f22\u8a9e", "original"), "\u6f22\u8a9e");
});

test("detects form only when the text provides useful evidence", () => {
  assert.equal(detectChineseCharacterForm("\u6c49\u8bed"), "simplified");
  assert.equal(detectChineseCharacterForm("\u6f22\u8a9e"), "traditional");
  assert.equal(detectChineseCharacterForm("\u4e2d\u6587"), "ambiguous");
});

test("normalizes Chinese-provider variants to Japanese forms for analysis", () => {
  assert.equal(
    normalizeChineseProviderJapaneseText("\u79d1\u6238\u306e\u98ce\u5439\u304d\u8fd0\u3076\u82b1\u306e\u9999"),
    "\u79d1\u6238\u306e\u98a8\u5439\u304d\u904b\u3076\u82b1\u306e\u9999"
  );
  assert.equal(
    normalizeChineseProviderJapaneseText("\u8fc2\u308a\u3086\u304f\u65f6\u4ee3\u306e\u65e0\u5e38\u3092\u53f9\u304f"),
    "\u8fc2\u308a\u3086\u304f\u6642\u4ee3\u306e\u7121\u5e38\u3092\u5606\u304f"
  );
});

test("limits Japanese kanji repair to built-in Chinese lyric providers", () => {
  for (const provider of ["qq", "kugou", "netease"]) {
    assert.equal(isChineseLyricsProvider({ fetchProvider: provider }), true, provider);
  }
  assert.equal(isChineseLyricsProvider({ source: "NETEASE" }), true);
  assert.equal(isChineseLyricsProvider({ fetchProvider: "apple", source: "aml" }), false);
  assert.equal(isChineseLyricsProvider({ fetchProvider: "custom:mine" }), false);
});

test("converts a complete timed line so phrases can cross timing units", () => {
  const units = [
    { Text: "\u5934", StartTime: 1, EndTime: 2 },
    { Text: "\u53d1", StartTime: 2, EndTime: 3, IsPartOfWord: true },
  ];
  assert.deepEqual(convertChineseTimedTextUnits(units, "traditional"), ["\u982d", "\u9aee"]);
  assert.deepEqual(units.map(({ StartTime, EndTime }) => ({ StartTime, EndTime })), [
    { StartTime: 1, EndTime: 2 },
    { StartTime: 2, EndTime: 3 },
  ]);
});

test("converts primary lyrics without touching translations or timing", () => {
  const lyrics = {
    Type: "Syllable",
    Content: [{ Lead: {
      StartTime: 1,
      EndTime: 3,
      TranslatedText: "translation",
      Syllables: [
        { Text: "\u5934", StartTime: 1, EndTime: 2 },
        { Text: "\u53d1", StartTime: 2, EndTime: 3, IsPartOfWord: true },
      ],
    } }],
  };
  convertChineseLyricsText(lyrics, "traditional", () => true);
  assert.equal(lyrics.Content[0].Lead.Syllables[0].Text, "\u982d");
  assert.equal(lyrics.Content[0].Lead.Syllables[1].Text, "\u9aee");
  assert.equal(lyrics.Content[0].Lead.TranslatedText, "translation");
  assert.equal(lyrics.Content[0].Lead.StartTime, 1);
  assert.equal(lyrics.Content[0].Lead.EndTime, 3);
});

test("respects the Chinese line predicate", () => {
  const lyrics = { Type: "Line", Content: [{ Text: "\u6f22\u8a9e" }, { Text: "\u541b\u306e\u58f0" }] };
  convertChineseLyricsText(lyrics, "simplified", (text) => !text.includes("\u306e"));
  assert.equal(lyrics.Content[0].Text, "\u6c49\u8bed");
  assert.equal(lyrics.Content[1].Text, "\u541b\u306e\u58f0");
});
