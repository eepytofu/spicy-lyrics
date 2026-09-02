import assert from "node:assert/strict";
import { test } from "node:test";
import {
  preserveProviderReading,
  preserveProviderReadingWithoutResidual,
  pendingLyricsPresentation,
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

test("Arabic script no longer requests a generated reading", () => {
  assert.equal(shouldPreferGeneratedReading("سيدي منصور", ["Arabic"]), false);
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

test("Arabic timed readings retain provider-authored fallback", () => {
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

test("pending fresh lyrics hide provider display aliases without mutating source evidence", () => {
  const lyrics = {
    Type: "Syllable",
    Content: [{
      Lead: {
        RomanizedText: "line provider reading",
        TransliteratedText: "line provider reading",
        Syllables: [{
          RomanizedText: "token provider reading",
          TransliteratedText: "token provider reading",
        }],
      },
      Background: [{
        ProviderRomanizedText: "background provider reading",
        RomanizedText: "background provider reading",
        Syllables: [],
      }],
    }],
  };

  const pending = pendingLyricsPresentation(lyrics);

  assert.equal(pending.Content[0].Lead.ProviderRomanizedText, "line provider reading");
  assert.equal(pending.Content[0].Lead.RomanizedText, undefined);
  assert.equal(pending.Content[0].Lead.TransliteratedText, undefined);
  assert.equal(pending.Content[0].Lead.Syllables[0].ProviderRomanizedText, "token provider reading");
  assert.equal(pending.Content[0].Lead.Syllables[0].RomanizedText, undefined);
  assert.equal(pending.Content[0].Background[0].ProviderRomanizedText, "background provider reading");
  assert.equal(pending.Content[0].Background[0].RomanizedText, undefined);
  assert.equal(lyrics.Content[0].Lead.RomanizedText, "line provider reading");
  assert.equal(lyrics.Content[0].Lead.Syllables[0].RomanizedText, "token provider reading");
});

test("pending provider suppression covers Static and Line lyric shapes", () => {
  const staticLyrics = pendingLyricsPresentation({
    Type: "Static",
    Lines: [{ Text: "雫", RomanizedText: "shi zu ku" }],
  });
  assert.equal(staticLyrics.Lines[0].ProviderRomanizedText, "shi zu ku");
  assert.equal(staticLyrics.Lines[0].RomanizedText, undefined);

  const lineLyrics = pendingLyricsPresentation({
    Type: "Line",
    Content: [{
      Text: "明日",
      RomanizedText: "a su",
      Background: [{ Text: "行く", TransliteratedText: "i ku" }],
    }],
  });
  assert.equal(lineLyrics.Content[0].ProviderRomanizedText, "a su");
  assert.equal(lineLyrics.Content[0].RomanizedText, undefined);
  assert.equal(lineLyrics.Content[0].Background[0].ProviderRomanizedText, "i ku");
  assert.equal(lineLyrics.Content[0].Background[0].TransliteratedText, undefined);
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
