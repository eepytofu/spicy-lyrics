import assert from "node:assert/strict";
import { test } from "node:test";
import {
  preserveProviderReading,
  preserveProviderReadingWithoutResidual,
  restoreProviderReading,
  restoreProviderReadingWithoutResidual,
  selectTimedLineReading,
  shouldPreferGeneratedReading,
  shouldUseConfiguredLocalReading,
} from "../src/utils/Lyrics/Processing/ReadingPrecedence.ts";

test("configured and structured scripts use local readings", () => {
  assert.equal(shouldUseConfiguredLocalReading("银行", ["Chinese"]), true);
  assert.equal(shouldUseConfiguredLocalReading("銀行へ行く", ["Japanese"]), true);
  assert.equal(shouldUseConfiguredLocalReading("사랑", ["Korean"]), true);
  assert.equal(shouldUseConfiguredLocalReading("Привет", ["Cyrillic"]), true);
  assert.equal(shouldUseConfiguredLocalReading("Αγάπη", ["Greek"]), false);
  assert.equal(shouldUseConfiguredLocalReading("سيدي منصور", ["Arabic"]), false);
  assert.equal(shouldUseConfiguredLocalReading("remix", ["Chinese"]), false);
});

test("Arabic-script Google readings precede provider fallback", () => {
  assert.equal(shouldPreferGeneratedReading("سيدي منصور", ["Arabic"]), true);
  assert.equal(shouldPreferGeneratedReading("sidi mansour", ["Arabic"]), false);
  assert.equal(shouldPreferGeneratedReading("Αγάπη", ["Greek"]), false);
});

test("Apple timing chunks cannot group locally generated Pinyin", () => {
  const generated = "wǒ zǒu zài cháng jiē zhōng tīng xì zi chàng jīng chéng";
  const appleTimedReading = "wǒ zǒu zài cháng jiēzhōngtīng xì zi chàng jīngchéng";

  assert.deepEqual(
    selectTimedLineReading(false, generated, undefined, appleTimedReading),
    { text: generated, provenance: "local", usesLineContext: false },
  );
});

test("Arabic timed readings retain generated-first provider fallback", () => {
  assert.deepEqual(
    selectTimedLineReading(true, "sidi mansour", "provider line", "provider chunks"),
    { text: "sidi mansour", provenance: "remoteFallback", usesLineContext: true },
  );
  assert.deepEqual(
    selectTimedLineReading(true, undefined, "provider line", "provider chunks"),
    { text: "provider line", provenance: "provider", usesLineContext: true },
  );
  assert.deepEqual(
    selectTimedLineReading(true, undefined, undefined, "provider chunks"),
    { text: "provider chunks", provenance: "provider", usesLineContext: false },
  );
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

test("same-script provider reading echoes stay as evidence but not display fallback", () => {
  const entry = {
    Text: "بضعف أوى وأنا جنبه وبسلم عليه",
    RomanizedText: "بضعف أوى وأنا جنبه وبسلم عليه",
  };
  assert.equal(
    preserveProviderReadingWithoutResidual(entry, /\p{Script=Arabic}/u),
    undefined,
  );
  assert.equal(entry.ProviderRomanizedText, "بضعف أوى وأنا جنبه وبسلم عليه");
  assert.equal(entry.RomanizedText, undefined);
  assert.equal(
    restoreProviderReadingWithoutResidual(entry, /\p{Script=Arabic}/u),
    false,
  );
  assert.equal(entry.RomanizedText, undefined);

  const realReading = { Text: "سلام", RomanizedText: "salam" };
  assert.equal(
    preserveProviderReadingWithoutResidual(realReading, /\p{Script=Arabic}/u),
    "salam",
  );
  assert.equal(realReading.ProviderRomanizedText, "salam");
  delete realReading.RomanizedText;
  assert.equal(
    restoreProviderReadingWithoutResidual(realReading, /\p{Script=Arabic}/u),
    true,
  );
  assert.equal(realReading.RomanizedText, "salam");
});
