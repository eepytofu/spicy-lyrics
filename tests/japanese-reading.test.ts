import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildJapaneseLineTextMap,
  okuriganaAnchoredKanjiRunReading,
} from "../src/utils/Lyrics/Reading/JapaneseReading.ts";
import {
  furiganaSegmentKey,
  utf16FuriganaSegmentKey,
} from "../src/utils/Lyrics/Processing/Japanese/FuriganaIdentity.ts";

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
