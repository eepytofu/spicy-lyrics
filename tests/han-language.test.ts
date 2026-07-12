import assert from "node:assert/strict";
import test from "node:test";
import { resolveHanLanguageTag } from "../src/utils/Lyrics/HanLanguage.ts";

test("track language disambiguates Han-only Japanese and Chinese lines", () => {
  assert.equal(resolveHanLanguageTag("東方", "jpn", "ja"), "ja");
  assert.equal(resolveHanLanguageTag("东方", "cmn", "zh"), "zh-Hans");
});

test("Kana identifies Japanese while unknown Han falls back to Chinese", () => {
  assert.equal(resolveHanLanguageTag("君の声", undefined, undefined), "ja");
  assert.equal(resolveHanLanguageTag("天地之间", undefined, undefined), "zh-Hans");
  assert.equal(resolveHanLanguageTag("hello", "jpn", "ja"), null);
});
