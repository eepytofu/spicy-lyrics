import assert from "node:assert/strict";
import test from "node:test";
import { resolveHanLanguageTag } from "../src/utils/Lyrics/HanLanguage.ts";

test("track language disambiguates Han-only Japanese and Chinese lines", () => {
  assert.equal(resolveHanLanguageTag("\u6771\u65b9", "jpn", "ja"), "ja");
  assert.equal(resolveHanLanguageTag("\u4e1c\u65b9", "cmn", "zh"), "zh-Hans");
  assert.equal(resolveHanLanguageTag("\u6771\u65b9", "cmn", "zh"), "zh-Hant");
});

test("Kana identifies Japanese while ambiguous Han remains neutral", () => {
  assert.equal(resolveHanLanguageTag("\u541b\u306e\u58f0", undefined, undefined), "ja");
  assert.equal(resolveHanLanguageTag("\u4e2d\u6587", undefined, undefined), "zh");
  assert.equal(resolveHanLanguageTag("hello", "jpn", "ja"), null);
});

test("an explicit conversion target controls the Chinese language tag", () => {
  assert.equal(resolveHanLanguageTag("\u4e2d\u6587", "cmn", "zh", "simplified"), "zh-Hans");
  assert.equal(resolveHanLanguageTag("\u4e2d\u6587", "cmn", "zh", "traditional"), "zh-Hant");
});
