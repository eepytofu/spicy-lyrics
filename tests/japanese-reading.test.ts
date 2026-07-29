import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildJapaneseLineTextMap,
  okuriganaAnchoredKanjiRunReading,
  prepareJapaneseLineAnalysis,
  resolveJapaneseTokenKanaReading,
} from "../src/utils/Lyrics/Reading/JapaneseReading.ts";
import type {
  JapaneseAnalyzer,
  JapaneseAnalyzerToken,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";
import {
  furiganaSegmentKey,
  utf16FuriganaSegmentKey,
} from "../src/utils/Lyrics/Processing/Japanese/FuriganaIdentity.ts";

function fixtureAnalyzer(surface: string, readingKana: string): JapaneseAnalyzer {
  const token: JapaneseAnalyzerToken = {
    surface,
    start: 0,
    end: surface.length,
    readingKana,
    pronunciationKana: readingKana,
    partOfSpeech: "other",
    morphologyFeatures: [],
    baseForm: surface,
    conjugationType: "",
    conjugationForm: "",
    provenance: { analyzerId: "reading-fixture", rangeSource: "native" },
  };
  return {
    id: "reading-fixture",
    async analyze(text) {
      assert.equal(text, surface);
      return [token];
    },
  };
}

async function projectedFurigana(surface: string, readingKana: string) {
  return (
    await prepareJapaneseLineAnalysis(surface, undefined, undefined, {
      analyzer: fixtureAnalyzer(surface, readingKana),
      kanaRomanizer: (kana) => kana,
    })
  )?.reading.furigana.map(({ start, end, reading }) => ({ start, end, reading }));
}

test("furigana identity matches UTF-16 readings to code-point render plans", () => {
  const source = "😀今日";
  assert.equal(
    utf16FuriganaSegmentKey(source, 2, 4, "きょう"),
    furiganaSegmentKey(1, 3, "きょう"),
  );
});

test("okurigana anchoring keeps maximal kanji reading prefix", () => {
  assert.equal(okuriganaAnchoredKanjiRunReading("だいきらい", 0, "い"), "だいきら");
  assert.equal(okuriganaAnchoredKanjiRunReading("えがく", 0, "く"), "えが");
  assert.equal(okuriganaAnchoredKanjiRunReading("ながい", 0, "い"), "なが");
});

test("unknown Katakana tokens fall back to their written kana", () => {
  assert.equal(resolveJapaneseTokenKanaReading("タマモクロス", ""), "たまもくろす");
  assert.equal(
    resolveJapaneseTokenKanaReading("アレグロ・アジテート", ""),
    "あれぐろ・あじてえと",
  );
  assert.equal(
    resolveJapaneseTokenKanaReading("ウインタードリームトロフィー", "*"),
    "ういんたあどりいむとろふぃい",
  );
  assert.equal(resolveJapaneseTokenKanaReading("大歓声", ""), "");
  assert.equal(resolveJapaneseTokenKanaReading(")", ""), "");
});

test("repeated Kana anchors distribute readings across every Kanji run", async () => {
  const analysis = await prepareJapaneseLineAnalysis("離れ離れ", undefined, undefined, {
    analyzer: fixtureAnalyzer("離れ離れ", "はなればなれ"),
    kanaRomanizer: (kana) => kana,
  });

  assert.equal(analysis?.reading.romaji, "はなればなれ");
  assert.deepEqual(
    analysis?.reading.furigana.map(({ start, end, reading }) => ({ start, end, reading })),
    [
      { start: 0, end: 1, reading: "はな" },
      { start: 2, end: 3, reading: "ばな" },
    ]
  );
});

test("multi-run alignment handles distinct and leading Kana anchors", async () => {
  assert.deepEqual(await projectedFurigana("取り扱い", "とりあつかい"), [
    { start: 0, end: 1, reading: "と" },
    { start: 2, end: 3, reading: "あつか" },
  ]);
  assert.deepEqual(await projectedFurigana("お願い致します", "おねがいいたします"), [
    { start: 1, end: 2, reading: "ねが" },
    { start: 3, end: 4, reading: "いた" },
  ]);
});

test("multi-run alignment abstains when every Kana anchor cannot be proven", async () => {
  assert.deepEqual(await projectedFurigana("離れ離れ", "はなればな"), [
    { start: 0, end: 4, reading: "はなればな" },
  ]);
});

test("Japanese line text map keeps Japanese TTML fragments compact", () => {
  const map = buildJapaneseLineTextMap(
    ["だん", "だん", "剥", "がれて", "く"].map((Text) => ({ Text }))
  );

  assert.equal(map.lineText, "だんだん剥がれてく");
  assert.deepEqual(
    map.spans.map(({ normalizedText, start, end }) => [normalizedText, start, end]),
    [
      ["だん", 0, 2],
      ["だん", 2, 4],
      ["剥", 4, 5],
      ["がれて", 5, 8],
      ["く", 8, 9],
    ]
  );
});

test("Japanese line text map preserves explicit Latin spacing", () => {
  const map = buildJapaneseLineTextMap(
    ["Fake ", "の", "ゴールド", "メッキ"].map((Text) => ({ Text }))
  );

  assert.equal(map.lineText, "Fake のゴールドメッキ");
  assert.deepEqual(
    map.spans.map(({ normalizedText, start, end }) => [normalizedText, start, end]),
    [
      ["Fake", 0, 4],
      ["の", 5, 6],
      ["ゴールド", 6, 10],
      ["メッキ", 10, 13],
    ]
  );
});
