import assert from "node:assert/strict";
import { test } from "node:test";
import { allowsChineseProviderJapaneseRepair } from "../src/utils/Lyrics/Processing/Japanese/ChineseProviderRepairPolicy.ts";

test("label-shaped provider rows preserve exact glyphs without a job-title list", () => {
  for (const text of [
    "词:Haruka",
    "二胡：辰小弦",
    "Vocal Direction:Someone",
    "未知役職：Someone",
  ]) {
    assert.equal(allowsChineseProviderJapaneseRepair(text), false, text);
  }
});

test("ordinary Japanese lyric text remains eligible for Chinese-provider glyph repair", () => {
  assert.equal(allowsChineseProviderJapaneseRepair("夢见ては 覚めて见る"), true);
  assert.equal(allowsChineseProviderJapaneseRepair("ぶち壊してshout it out loud"), true);
});
