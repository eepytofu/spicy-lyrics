import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ConverterFactory } from "opencc-js/core";
import JapaneseShinjitaiCharacters from "opencc-js/dict/JPShinjitaiCharactersRev";
import SimplifiedToTraditionalCharacters from "opencc-js/dict/STCharacters";
import {
  convertChineseLyricsText,
  convertChineseText,
  convertChineseTimedTextUnits,
  detectChineseCharacterForm,
} from "../src/utils/Lyrics/ChineseCharacterConversion.ts";
import {
  CHINESE_PROVIDER_CHARACTER_MAP_METADATA,
  CHINESE_PROVIDER_JAPANESE_CHARACTER_MAP,
} from "../src/utils/Lyrics/Processing/Japanese/ChineseProviderCharacterMap.generated.ts";
import {
  isChineseProviderJapaneseRepairSource,
  repairChineseProviderJapaneseText,
} from "../src/utils/Lyrics/Processing/Japanese/ChineseProviderJapaneseRepair.ts";

const broadJapaneseConverter = ConverterFactory(
  [SimplifiedToTraditionalCharacters],
  [JapaneseShinjitaiCharacters],
);

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
    repairChineseProviderJapaneseText("\u79d1\u6238\u306e\u98ce\u5439\u304d\u8fd0\u3076\u82b1\u306e\u9999"),
    "\u79d1\u6238\u306e\u98a8\u5439\u304d\u904b\u3076\u82b1\u306e\u9999"
  );
  assert.equal(
    repairChineseProviderJapaneseText("\u8fc2\u308a\u3086\u304f\u65f6\u4ee3\u306e\u65e0\u5e38\u3092\u53f9\u304f"),
    "\u8fc2\u308a\u3086\u304f\u6642\u4ee3\u306e\u7121\u5e38\u3092\u5606\u304f"
  );
  assert.equal(
    repairChineseProviderJapaneseText("梦见ては 覚めて见る"),
    "夢見ては 覚めて見る"
  );
});

test("keeps ambiguous Japanese lexical forms in safe source contexts", () => {
  assert.equal(
    repairChineseProviderJapaneseText("叶う 叶える 叶わない 叶った 叶っぱ"),
    "叶う 叶える 叶わない 叶った 葉っぱ"
  );
  assert.equal(
    repairChineseProviderJapaneseText("后妃 皇后 太后 后宫"),
    "后妃 皇后 太后 後宮"
  );
  assert.equal(
    repairChineseProviderJapaneseText("ひとり占めできるまで"),
    "ひとり占めできるまで"
  );
  assert.equal(
    repairChineseProviderJapaneseText("岩 干 里"),
    "岩 干 里"
  );
});

test("conservative repair ablates broad OpenCC changes without losing proven fixtures", () => {
  assert.equal(CHINESE_PROVIDER_CHARACTER_MAP_METADATA.broadChangedCodePoints, 3020);
  assert.equal(
    CHINESE_PROVIDER_JAPANESE_CHARACTER_MAP.size,
    CHINESE_PROVIDER_CHARACTER_MAP_METADATA.mappingCount,
  );
  assert.ok(
    CHINESE_PROVIDER_JAPANESE_CHARACTER_MAP.size <
      CHINESE_PROVIDER_CHARACTER_MAP_METADATA.broadChangedCodePoints,
  );
  const entries = [...CHINESE_PROVIDER_JAPANESE_CHARACTER_MAP];
  assert.equal(
    createHash("sha256")
      .update(
        `${entries.map(([source]) => source).join("")}\0${entries
          .map(([, target]) => target)
          .join("")}`,
        "utf8",
      )
      .digest("hex")
      .toUpperCase(),
    CHINESE_PROVIDER_CHARACTER_MAP_METADATA.mappingSha256,
  );
  assert.equal(entries.every(([source, target]) => source.length === target.length), true);

  for (const source of ["占", "岩", "干", "里"]) {
    assert.notEqual(broadJapaneseConverter(source), source, source);
    assert.equal(repairChineseProviderJapaneseText(source), source, source);
  }

  assert.equal(
    repairChineseProviderJapaneseText("风吹き运ぶ 时の无常 梦见ては 词を叹く"),
    "風吹き運ぶ 時の無常 夢見ては 詞を嘆く",
  );
});

test("limits Japanese kanji repair to built-in Chinese lyric providers", () => {
  for (const provider of ["qq", "kugou", "netease", "soda"]) {
    assert.equal(isChineseProviderJapaneseRepairSource({ fetchProvider: provider }), true, provider);
  }
  assert.equal(isChineseProviderJapaneseRepairSource({ source: "NETEASE" }), true);
  assert.equal(isChineseProviderJapaneseRepairSource({ fetchProvider: "apple", source: "aml" }), false);
  assert.equal(isChineseProviderJapaneseRepairSource({ fetchProvider: "custom:mine" }), false);
});

test("converts a complete timed line so phrases can cross timing units", () => {
  const units = [
    { Text: "\u5934", StartTime: 1, EndTime: 2, IsPartOfWord: true },
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
        { Text: "\u5934", StartTime: 1, EndTime: 2, IsPartOfWord: true },
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
