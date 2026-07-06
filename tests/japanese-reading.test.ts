import assert from "node:assert/strict";
import { test } from "node:test";
import { okuriganaAnchoredKanjiRunReading } from "../src/utils/Lyrics/Reading/JapaneseReading.ts";

test("okurigana anchoring keeps maximal kanji reading prefix", () => {
  assert.equal(okuriganaAnchoredKanjiRunReading("だいきらい", 0, "い"), "だいきら");
  assert.equal(okuriganaAnchoredKanjiRunReading("えがく", 0, "く"), "えが");
  assert.equal(okuriganaAnchoredKanjiRunReading("ながい", 0, "い"), "なが");
});
