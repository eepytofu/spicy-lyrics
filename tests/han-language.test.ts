import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createHanLanguageContext,
  resolveHanLanguageTag,
  splitHanLanguageRuns,
} from "../src/utils/Lyrics/HanLanguage.ts";

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

test("one line context resolves mixed Chinese form before per-run splitting", () => {
  assert.deepEqual(
    createHanLanguageContext(
      { Language: "cmn", LanguageISO2: "zh", ChineseCharacterForm: "original" },
      "风起かな",
      true,
      "Chinese",
    ),
    {
      enabled: true,
      characterForm: "original",
      primaryScript: "Chinese",
      lineLanguage: "zh-Hans",
    },
  );
});

test("font routing splits only script-bearing runs and leaves Latin text neutral", () => {
  assert.deepEqual(
    splitHanLanguageRuns("Shout 暁 Records", {
      enabled: true,
      primaryScript: "Japanese",
      lineLanguage: "ja",
    }),
    [
      { text: "Shout ", language: null },
      { text: "暁", language: "ja" },
      { text: " Records", language: null },
    ],
  );
});

test("Chinese-dominant mixed text keeps one Chinese form while Kana stays Japanese", () => {
  assert.deepEqual(
    splitHanLanguageRuns("风起かな", {
      enabled: true,
      primaryScript: "Chinese",
      lineLanguage: "zh-Hans",
    }),
    [
      { text: "风起", language: "zh-Hans" },
      { text: "かな", language: "ja" },
    ],
  );
});

test("disabled Han repair keeps one untagged source run", () => {
  assert.deepEqual(
    splitHanLanguageRuns("Shout 暁 Records", {
      enabled: false,
      lineLanguage: null,
    }),
    [{ text: "Shout 暁 Records", language: null }],
  );
});

test("Han font CSS is scoped to tagged runs in both bundled and system-font modes", () => {
  const css = readFileSync(new URL("../src/css/default.css", import.meta.url), "utf8");
  assert.equal(css.includes(".FixHanGlyphVariants .line:lang("), false);
  assert.equal(
    css.includes('#SpicyLyricsPage:not(.UseSpicyFont).FixHanGlyphVariants .lyric-base-run[lang="ja"]'),
    true,
  );
  assert.equal(
    css.includes('#SpicyLyricsPage.UseSpicyFont.FixHanGlyphVariants .lyric-base-run[lang="zh-Hant"]'),
    true,
  );
});
