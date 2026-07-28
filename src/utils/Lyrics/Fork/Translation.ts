/**
 * Translation ownership boundary.
 *
 * Provider translations stay in ProviderTranslatedText. The optional Google
 * fallback fills only uncovered lines through the separate client/cache module.
 */

import { isMeaningfullyDifferent } from "../TextCompare.ts";
import { batchTranslate } from "./GoogleTranslationClient.ts";
import {
  effectiveTranslationSource,
  normalizeCompare,
  shouldDisplayTranslation,
  shouldTranslateLine,
} from "./TranslationEligibility.ts";
import {
  collectTranslationLineRefs,
  type TranslationLineRef,
} from "./TranslationLines.ts";

export {
  batchTranslate,
  BATCH_MARKER_PATTERN,
  buildBatchChunks,
  buildBatchQuery,
  clearTranslationCache,
  parseBatchTranslation,
  stripMarkerEcho,
  TRANSLATION_BATCH_MAX_CHARS,
  TRANSLATION_BATCH_MAX_LINES,
} from "./GoogleTranslationClient.ts";
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

function hasGenericTranslation(ref: TranslationLineRef): boolean {
  return typeof ref.obj.TranslatedText === "string"
    && shouldDisplayTranslation(ref.sourceText, ref.obj.TranslatedText);
}

export const TRANSLATION_SIDECAR_SCHEMA_VERSION = 1;

/**
 * Capture translations that arrived with freshly fetched lyrics before the
 * built-in translator runs. This is the ownership boundary for native APIs,
 * TTML, external Workers, and custom servers using the native lyric schema.
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
    delete ref.obj.TranslatedTextSource;
    delete ref.obj.ChineseProviderTranslatedText;
  }

  lyrics.TranslationSidecarSchemaVersion = TRANSLATION_SIDECAR_SCHEMA_VERSION;
  normalizeProviderTranslations(lyrics);
  return captured;
}

/**
 * Normalize provider sidecars without applying a display preference. Older
 * Workers and caches duplicated ProviderTranslatedText into TranslatedText;
 * remove only that matching legacy copy while preserving a distinct built-in
 * target-language translation.
 */
export function normalizeProviderTranslations(lyrics: any): number {
  const lineRefs = collectTranslationLineRefs(lyrics);
  let available = 0;

  for (const ref of lineRefs) {
    const legacyProvider = typeof ref.obj.ChineseProviderTranslatedText === "string"
      ? ref.obj.ChineseProviderTranslatedText.trim()
      : "";
    if (!ref.obj.ProviderTranslatedText && legacyProvider) {
      ref.obj.ProviderTranslatedText = legacyProvider;
    }
    const providerTranslation = typeof ref.obj.ProviderTranslatedText === "string"
      ? ref.obj.ProviderTranslatedText.trim()
      : "";
    const wasProviderDisplay = ref.obj.TranslatedTextSource === "chinese-provider"
      || (
        !!providerTranslation
        && normalizeCompare(ref.obj.TranslatedText) === normalizeCompare(providerTranslation)
      );

    if (wasProviderDisplay) {
      delete ref.obj.TranslatedText;
      delete ref.obj.TranslatedTextLanguage;
      delete ref.obj.TranslatedTextSource;
    }

    delete ref.obj.ChineseProviderTranslatedText;
    if (shouldDisplayTranslation(ref.sourceText, providerTranslation)) available += 1;
  }

  lyrics.HasProviderTranslations = available > 0;
  lyrics.IncludesTranslation = lyrics.HasProviderTranslations || lineRefs.some(hasGenericTranslation);
  return available;
}

function clearGoogleTranslation(ref: TranslationLineRef): void {
  delete ref.obj[ref.field];
  delete ref.obj.TranslatedTextLanguage;
  delete ref.obj.TranslatedTextSource;
}

type TranslationOptions = {
  signal?: AbortSignal;
};

/**
 * Translate uncovered lines and store the Google fallback in TranslatedText.
 */
export async function translateLyrics(
  lyrics: any,
  options: TranslationOptions = {},
): Promise<void> {
  const { translationEnabled, translationTargetLang } = await import("../lyrics.ts");
  if (!translationEnabled || !translationTargetLang) return;

  const { signal } = options;
  const sourceLang = lyrics.Language || "und";
  const targetLang = translationTargetLang;
  const lineRefs = collectTranslationLineRefs(lyrics);
  if (lineRefs.length === 0) return;

  const hasProviderTranslation = lineRefs.map((ref) =>
    typeof ref.obj.ProviderTranslatedText === "string"
    && shouldDisplayTranslation(ref.sourceText, ref.obj.ProviderTranslatedText)
  );
  const providerTranslationCount = hasProviderTranslation.filter(Boolean).length;
  const candidateGroups = new Map<string, number[]>();

  for (let index = 0; index < lineRefs.length; index++) {
    const ref = lineRefs[index];
    if (
      hasProviderTranslation[index]
      || !shouldTranslateLine(ref.sourceText, sourceLang, targetLang)
    ) {
      continue;
    }
    const effectiveSource = effectiveTranslationSource(
      ref.sourceText,
      sourceLang,
      targetLang,
    );
    const group = candidateGroups.get(effectiveSource) ?? [];
    group.push(index);
    candidateGroups.set(effectiveSource, group);
  }

  if (candidateGroups.size === 0) {
    lineRefs.forEach((ref, index) => {
      if (!hasProviderTranslation[index]) clearGoogleTranslation(ref);
    });
    lyrics.IncludesTranslation = providerTranslationCount > 0;
    console.log("[SpicyLyrics:Translation] No additional lines need translation");
    return;
  }

  const translationsByIndex = new Map<number, string>();
  for (const [effectiveSource, indices] of candidateGroups) {
    if (signal?.aborted) throw new DOMException("Translation request aborted", "AbortError");
    const translations = await batchTranslate(
      indices.map((index) => lineRefs[index].sourceText),
      effectiveSource,
      targetLang,
      { signal },
    );
    for (let offset = 0; offset < indices.length; offset++) {
      translationsByIndex.set(indices[offset], translations[offset]);
    }
  }
  if (signal?.aborted) throw new DOMException("Translation request aborted", "AbortError");

  lineRefs.forEach((ref, index) => {
    if (!hasProviderTranslation[index]) clearGoogleTranslation(ref);
  });

  let assignedCount = providerTranslationCount;
  for (const [index, translated] of translationsByIndex) {
    if (isMeaningfullyDifferent(translated, lineRefs[index].sourceText)) {
      lineRefs[index].obj[lineRefs[index].field] = translated;
      assignedCount += 1;
    }
  }

  lyrics.IncludesTranslation = assignedCount > 0;
  console.log(
    `[SpicyLyrics:Translation] Done. ${assignedCount}/${lineRefs.length} lines translated (${translationsByIndex.size} candidates)`,
  );
}
