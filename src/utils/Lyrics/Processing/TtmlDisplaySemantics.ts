import { needsSyllableSpaceBefore, type BoundarySyllable } from "./SyllableBoundaries.ts";

const JAPANESE_CJK_EDGE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヵヶ]/u;

const firstCharacter = (value: string): string => Array.from(value)[0] ?? "";
const lastCharacter = (value: string): string => Array.from(value).at(-1) ?? "";

export function isJapaneseProviderLanguage(language: unknown): boolean {
  return typeof language === "string" && /^ja(?:-|$)/iu.test(language.trim());
}

/**
 * AMLL/Apple TTML frequently uses an authored inter-span space as a timing
 * boundary between Japanese glyph runs. Keep that boundary in source evidence,
 * copy, and timing; suppress only the renderer's synthetic visual gap when the
 * document itself declares Japanese and both touching edges are Japanese CJK.
 */
export function suppressJapaneseCjkProviderGapAfter(
  syllables: readonly BoundarySyllable[],
  index: number,
  providerLanguage: unknown
): boolean {
  if (!isJapaneseProviderLanguage(providerLanguage) || index < 0 || index >= syllables.length - 1) {
    return false;
  }
  const current = syllables[index];
  const next = syllables[index + 1];
  if (current?.IsPartOfWord !== false) return false;
  const currentEdge = lastCharacter(current.Text || "");
  const nextEdge = firstCharacter(next?.Text || "");
  return JAPANESE_CJK_EDGE.test(currentEdge) && JAPANESE_CJK_EDGE.test(nextEdge);
}

export function needsTtmlDisplaySpaceBefore(
  syllables: readonly BoundarySyllable[],
  index: number,
  providerLanguage: unknown
): boolean {
  return (
    needsSyllableSpaceBefore(syllables, index) &&
    !suppressJapaneseCjkProviderGapAfter(syllables, index - 1, providerLanguage)
  );
}
