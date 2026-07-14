import assert from "node:assert/strict";
import { test } from "node:test";
import {
  preserveProviderReading,
  restoreProviderReading,
  shouldUseConfiguredLocalReading,
} from "../src/utils/Lyrics/Processing/ReadingPrecedence.ts";

test("configured and structured scripts use local readings", () => {
  assert.equal(shouldUseConfiguredLocalReading("银行", ["Chinese"]), true);
  assert.equal(shouldUseConfiguredLocalReading("銀行へ行く", ["Japanese"]), true);
  assert.equal(shouldUseConfiguredLocalReading("사랑", ["Korean"]), true);
  assert.equal(shouldUseConfiguredLocalReading("Привет", ["Cyrillic"]), true);
  assert.equal(shouldUseConfiguredLocalReading("Αγάπη", ["Greek"]), false);
  assert.equal(shouldUseConfiguredLocalReading("remix", ["Chinese"]), false);
});

test("provider reading is preserved separately and restored as fallback", () => {
  const entry = { RomanizedText: "provider reading", TransliteratedText: "provider reading" };
  assert.equal(preserveProviderReading(entry), "provider reading");
  assert.equal(entry.ProviderRomanizedText, "provider reading");

  entry.RomanizedText = "local reading";
  entry.TransliteratedText = "local reading";
  assert.equal(preserveProviderReading(entry), "provider reading");

  delete entry.RomanizedText;
  delete entry.TransliteratedText;
  assert.equal(restoreProviderReading(entry), true);
  assert.equal(entry.RomanizedText, "provider reading");
  assert.equal(entry.TransliteratedText, "provider reading");
});
