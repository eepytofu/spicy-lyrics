import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectProviderAuthoredJapaneseReadings,
  projectProviderSourceOffset,
} from "../src/utils/Lyrics/Processing/Japanese/ProviderAuthoredReading.ts";

test("projects ASCII and fullwidth authored readings without changing source evidence", () => {
  for (const source of ["今宵も天(そら)は明るく", "今宵も天（そら）は明るく"]) {
    const projection = projectProviderAuthoredJapaneseReadings(source);
    assert.equal(projection.sourceText, "今宵も天(そら)は明るく");
    assert.equal(projection.displayText, "今宵も天は明るく");
    assert.deepEqual(projection.hints.map((hint) => ({
      surface: projection.displayText.slice(hint.displayRange.start, hint.displayRange.end),
      reading: hint.reading,
    })), [{ surface: "天", reading: "そら" }]);
  }
});

test("supports compound and repeated authored readings", () => {
  const projection = projectProviderAuthoredJapaneseReadings("永久(とわ)に天(そら)を見る");
  assert.equal(projection.displayText, "永久に天を見る");
  assert.deepEqual(projection.hints.map((hint) => [
    projection.displayText.slice(hint.displayRange.start, hint.displayRange.end),
    hint.reading,
  ]), [["永久", "とわ"], ["天", "そら"]]);
});

test("keeps a compound ruby across timed owners when its annotation shares visible text", () => {
  const source = "永久(とわ)に";
  const projection = projectProviderAuthoredJapaneseReadings(source, [
    { start: 0, end: 1 },
    { start: 1, end: 6 },
    { start: 6, end: 7 },
  ]);
  assert.equal(projection.displayText, "永久に");
  assert.deepEqual(projection.hints[0].displayRange, { start: 0, end: 2 });
});

test("rejects ordinary parentheticals and annotations that own a whole timed span", () => {
  assert.equal(projectProviderAuthoredJapaneseReadings("天(Stage)").hints.length, 0);
  assert.equal(projectProviderAuthoredJapaneseReadings("天 (そら)").hints.length, 0);

  const source = "天(そら)へ";
  const rejected = projectProviderAuthoredJapaneseReadings(source, [
    { start: 0, end: 1 },
    { start: 1, end: 5 },
    { start: 5, end: 6 },
  ]);
  assert.equal(rejected.displayText, source);
  assert.equal(rejected.hints.length, 0);
});

test("projects provider timing offsets around hidden annotation syntax", () => {
  const projection = projectProviderAuthoredJapaneseReadings("今宵も天(そら)は明るく");
  assert.equal(projectProviderSourceOffset(projection, 4), 4);
  assert.equal(projectProviderSourceOffset(projection, 8), 4);
  assert.equal(projectProviderSourceOffset(projection, projection.sourceText.length), projection.displayText.length);
});
