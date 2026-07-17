import { isMeaningfullyDifferent } from "./TextCompare.ts";
import { resolveHanLanguageTag } from "./HanLanguage.ts";

export type TranslationSidecarEntry = {
  ProviderTranslatedText?: unknown;
  ProviderTranslationLanguage?: unknown;
  TranslatedText?: unknown;
};

const nonEmptyText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

function normalizeLanguageTag(value: unknown): string | undefined {
  const tag = nonEmptyText(value)?.replace(/_/g, "-");
  if (!tag) return undefined;
  const lower = tag.toLowerCase();
  if (["zh-cn", "zh-sg", "zh-hans", "cmn-hans"].includes(lower)) return "zh-Hans";
  if (["zh-tw", "zh-hk", "zh-mo", "zh-hant", "cmn-hant"].includes(lower)) return "zh-Hant";
  if (["ja", "jpn"].includes(lower)) return "ja";
  if (["ko", "kor"].includes(lower)) return "ko";
  return tag;
}

function providerTranslationLanguage(text: string | undefined, declared: unknown): string | undefined {
  const normalized = normalizeLanguageTag(declared);
  if (!text) return normalized;
  if (normalized && normalized.toLowerCase() !== "zh") return normalized;
  const han = resolveHanLanguageTag(text, normalized, normalized);
  if (han) return han;
  if (/[가-힯]/u.test(text)) return "ko";
  return normalized;
}

/**
 * Resolve the two translation lanes without treating an older Worker's
 * duplicated provider value as a separate built-in translation.
 */
export function resolveTranslationSidecars(entry: TranslationSidecarEntry): {
  provider?: string;
  providerLanguage?: string;
  generic?: string;
} {
  const provider = nonEmptyText(entry.ProviderTranslatedText);
  const candidate = nonEmptyText(entry.TranslatedText);
  const generic = candidate && (!provider || isMeaningfullyDifferent(candidate, provider))
    ? candidate
    : undefined;

  return {
    provider,
    providerLanguage: providerTranslationLanguage(provider, entry.ProviderTranslationLanguage),
    generic,
  };
}

/** A singular copy format prefers the requested built-in target, then provider text. */
export function preferredCopyTranslation(entry: TranslationSidecarEntry): string | undefined {
  const { provider, generic } = resolveTranslationSidecars(entry);
  return generic ?? provider;
}
