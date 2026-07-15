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
      TranslatedText: "反正水是干旱的土地上的",
    }],
  };
}

test("legacy provider duplicates normalize to one provider lane", () => {
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
        TranslatedText: "反正水是干旱的土地上的",
      },
    }],
  };

  assert.equal(normalizeProviderTranslations(lyrics), 1);
  assert.equal((lyrics.Content[0].Lead as any).TranslatedText, undefined);
  assert.equal((lyrics.Content[0].Lead as any).ProviderTranslatedText, "反正水是干旱的土地上的");
  assert.equal((lyrics as any).HasProviderTranslations, true);
  assert.equal((lyrics as any).IncludesTranslation, true);
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

test("legacy duplicate translation values resolve to one provider lane", () => {
  const duplicate = {
    ProviderTranslatedText: "反正水是干旱的土地上的",
    TranslatedText: "反正水是干旱的土地上的",
  };

  assert.deepEqual(resolveTranslationSidecars(duplicate), {
    provider: duplicate.ProviderTranslatedText,
    providerLanguage: "zh-Hans",
    generic: undefined,
  });
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
