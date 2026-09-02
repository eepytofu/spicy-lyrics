/**
 * Translation ownership boundary.
 *
 * Provider translations stay in ProviderTranslatedText. This fork has no
 * built-in machine-translation lane.
 */

import { shouldDisplayTranslation } from "./TranslationEligibility.ts";
import { collectTranslationLineRefs } from "./TranslationLines.ts";

export {
  effectiveTranslationSource,
  hasObviousNonTargetScript,
  looksLikeRomanizationEcho,
  normalizeCompare,
  romanizationCandidates,
  shouldDisplayTranslation,
  shouldTranslateLine,
} from "./TranslationEligibility.ts";
export {
  collectTranslationLineRefs,
  joinSyllableText,
  type TranslationLineRef,
} from "./TranslationLines.ts";

export const TRANSLATION_SIDECAR_SCHEMA_VERSION = 2;

/**
 * Capture translations that arrived with freshly fetched lyrics. This is the
 * ownership boundary for native APIs, TTML, Workers, and custom servers using
 * the native lyric schema.
 */
export function captureSourceTranslations(lyrics: any): number {
  const lineRefs = collectTranslationLineRefs(lyrics);
  let captured = 0;

  for (const ref of lineRefs) {
    const existingProvider = typeof ref.obj.ProviderTranslatedText === "string"
      ? ref.obj.ProviderTranslatedText.trim()
      : "";
    const sourceTranslation = existingProvider || (
      typeof ref.obj.TranslatedText === "string" ? ref.obj.TranslatedText.trim() : ""
    );

    if (shouldDisplayTranslation(ref.sourceText, sourceTranslation)) {
      ref.obj.ProviderTranslatedText = sourceTranslation;
      const language = ref.obj.ProviderTranslationLanguage ?? ref.obj.TranslatedTextLanguage;
      if (typeof language === "string" && language.trim()) {
        ref.obj.ProviderTranslationLanguage = language.trim();
      }
      captured += 1;
    }

    delete ref.obj.TranslatedText;
    delete ref.obj.TranslatedTextLanguage;
  }

  lyrics.TranslationSidecarSchemaVersion = TRANSLATION_SIDECAR_SCHEMA_VERSION;
  normalizeProviderTranslations(lyrics);
  return captured;
}

/** Normalize provider sidecars without applying a display preference. */
export function normalizeProviderTranslations(lyrics: any): number {
  const lineRefs = collectTranslationLineRefs(lyrics);
  let available = 0;

  for (const ref of lineRefs) {
    const providerTranslation = typeof ref.obj.ProviderTranslatedText === "string"
      ? ref.obj.ProviderTranslatedText.trim()
      : "";

    if (shouldDisplayTranslation(ref.sourceText, providerTranslation)) available += 1;

    // Generic TranslatedText belonged to the retired built-in translation lane.
    // Provider-authored text has already been captured in its separate lane.
    delete ref.obj[ref.field];
    delete ref.obj.TranslatedTextLanguage;
  }

  lyrics.HasProviderTranslations = available > 0;
  lyrics.IncludesTranslation = lyrics.HasProviderTranslations;
  lyrics.TranslationPending = false;
  return available;
}
