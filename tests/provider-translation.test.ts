import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureSourceTranslations,
  normalizeProviderTranslations,
  TRANSLATION_SIDECAR_SCHEMA_VERSION,
} from "../src/utils/Lyrics/Fork/Translation.ts";
import {
  preferredCopyTranslation,
  resolveTranslationSidecars,
} from "../src/utils/Lyrics/TranslationSidecar.ts";

function chineseProviderLine() {
  return {
    Type: "Line",
    source: "qq",
    fetchProvider: "qq",
    Content: [{
      Text: "どうせ水は乾く土地さ",
      ProviderTranslatedText: "反正水是干旱的土地上的",
    }],
  };
}

test("current provider translations remain in their independent lane", () => {
  const lyrics = chineseProviderLine();
  const available = normalizeProviderTranslations(lyrics);
  const line = lyrics.Content[0] as any;

  assert.equal(available, 1);
  assert.equal(line.TranslatedText, undefined);
  assert.equal(line.ProviderTranslatedText, "反正水是干旱的土地上的");
  assert.equal((lyrics as any).HasProviderTranslations, true);
  assert.equal((lyrics as any).IncludesTranslation, true);
});

test("word-synced provider translations use the same independent display lane", () => {
  const lyrics = {
    Type: "Syllable",
    source: "netease",
    fetchProvider: "netease",
    Content: [{
      Type: "Vocal",
      Lead: {
        Syllables: [
          { Text: "どうせ", IsPartOfWord: false },
          { Text: "水は乾く土地さ", IsPartOfWord: true },
        ],
        ProviderTranslatedText: "反正水是干旱的土地上的",
      },
    }],
  };

  assert.equal(normalizeProviderTranslations(lyrics), 1);
  assert.equal((lyrics.Content[0].Lead as any).TranslatedText, undefined);
  assert.equal((lyrics.Content[0].Lead as any).ProviderTranslatedText, "反正水是干旱的土地上的");
  assert.equal((lyrics as any).HasProviderTranslations, true);
  assert.equal((lyrics as any).IncludesTranslation, true);
});

test("word-synced native groups without an explicit Type keep translations", () => {
  const lyrics = {
    Type: "Syllable",
    Content: [{
      Lead: {
        Syllables: [{ Text: "どうせ水は乾く土地さ" }],
        TranslatedText: "反正水是干旱的土地上的",
      },
    }],
  } as any;

  assert.equal(captureSourceTranslations(lyrics), 1);
  assert.equal(lyrics.Content[0].Lead.TranslatedText, undefined);
  assert.equal(
    lyrics.Content[0].Lead.ProviderTranslatedText,
    "反正水是干旱的土地上的",
  );
});

test("a normalized provider payload remains raw and preference-independent", () => {
  const lyrics = chineseProviderLine();
  normalizeProviderTranslations(lyrics);
  const line = lyrics.Content[0] as any;

  assert.equal(line.TranslatedText, undefined);
  assert.equal(line.ProviderTranslatedText, "反正水是干旱的土地上的");
  assert.equal((lyrics as any).HasProviderTranslations, true);
});

test("a distinct built-in translation is preserved for any lyrics source", () => {
  const lyrics = chineseProviderLine() as any;
  lyrics.source = "spicy";
  lyrics.fetchProvider = "spicy";
  lyrics.Content[0].TranslatedText = "This is a separate built-in translation";
  normalizeProviderTranslations(lyrics);

  assert.equal(lyrics.Content[0].TranslatedText, "This is a separate built-in translation");
  assert.equal(lyrics.IncludesTranslation, true);
});

test("fresh AMLL or custom-server translations are captured before Google runs", () => {
  const lyrics = {
    Type: "Line",
    source: "amlldb",
    fetchProvider: "amlldb",
    Content: [{
      Text: "I used to think it's not worth it",
      TranslatedText: "往昔曾觉，万事皆是徒劳",
      TranslatedTextLanguage: "zh-CN",
    }],
  } as any;
  captureSourceTranslations(lyrics);

  assert.equal(lyrics.Content[0].TranslatedText, undefined);
  assert.equal(lyrics.Content[0].ProviderTranslatedText, "往昔曾觉，万事皆是徒劳");
  assert.equal(lyrics.Content[0].ProviderTranslationLanguage, "zh-CN");
  assert.equal(lyrics.TranslationSidecarSchemaVersion, TRANSLATION_SIDECAR_SCHEMA_VERSION);
  assert.equal(lyrics.HasProviderTranslations, true);
  assert.equal(lyrics.IncludesTranslation, true);
});

test("translation copy falls back to the provider sidecar without duplicating storage", () => {
  const providerOnly = { ProviderTranslatedText: "反正水是干旱的土地上的" };
  assert.equal(preferredCopyTranslation(providerOnly), providerOnly.ProviderTranslatedText);

  const withBuiltIn = {
    ...providerOnly,
    TranslatedText: "Built-in target-language translation",
  };
  assert.equal(preferredCopyTranslation(withBuiltIn), withBuiltIn.TranslatedText);
});

test("provider and built-in translation lanes remain independent", () => {
  const entry = {
    ProviderTranslatedText: "反正水是干旱的土地上的",
    TranslatedText: "This is the selected built-in translation",
  };

  assert.deepEqual(resolveTranslationSidecars(entry), {
    provider: entry.ProviderTranslatedText,
    providerLanguage: "zh-Hans",
    generic: entry.TranslatedText,
  });
});

test("provider language recognizes the Hangul script without overmatching past modern syllables", () => {
  assert.equal(resolveTranslationSidecars({
    ProviderTranslatedText: "\u{D7A3}",
  }).providerLanguage, "ko");
  assert.equal(resolveTranslationSidecars({
    ProviderTranslatedText: "\u1100\u1161",
  }).providerLanguage, "ko");
  assert.equal(resolveTranslationSidecars({
    ProviderTranslatedText: "\u{D7A4}",
  }).providerLanguage, undefined);
});

test("provider language uses source metadata and script fallback", () => {
  assert.equal(resolveTranslationSidecars({
    ProviderTranslatedText: "萬事皆是徒勞",
    ProviderTranslationLanguage: "zh-TW",
  }).providerLanguage, "zh-Hant");
  assert.equal(resolveTranslationSidecars({
    ProviderTranslatedText: "往昔曾觉，万事皆是徒劳",
  }).providerLanguage, "zh-Hans");
});
