/**
 * Shared Jukujikun + Token Merge Logic
 *
 * Shared compound kanji reading lookup and phonetic merge rules.
 */

import type {
  JapaneseAnalyzerReadingState,
  JapaneseAnalyzerToken,
} from "../Processing/Japanese/JapaneseAnalyzer.ts";

export interface MergeableEntry extends JapaneseAnalyzerReadingState {}

const SMALL_TSU_ROMAJI = /(?:xtsu|ltsu|tsu)$/i;
const PROLONGED_SOUND_MARK = /^ー+$/u;
const LeadingClosingPunctuation = /^(?:\p{Pe}|\p{Pf}|[。、？！…・.?!,\s])+/u;
const TrailingOpeningPunctuation = /(?:\p{Ps}|\p{Pi})+$/u;
const ClosingBeforeOpeningPunctuation =
  /((?:\p{Pe}|\p{Pf}|[。、？！…・.?!,]))(?=(?:\p{Ps}|\p{Pi}))/gu;

const doubledSokuon = (romaji: string): string => {
  if (!romaji) return romaji;
  const lower = romaji.toLowerCase();
  if (!/^[a-z]/.test(lower) || /^[aeioun]/.test(lower)) return romaji;
  return `${romaji[0]}${romaji}`;
};

export function applyPhoneticMerges(
  entries: MergeableEntry[],
  tokens: readonly JapaneseAnalyzerToken[]
): void {
  for (const entry of entries) {
    entry.romaji = entry.romaji.replace(ClosingBeforeOpeningPunctuation, "$1 ");
  }

  for (let i = 1; i < tokens.length; i++) {
    if (entries[i].consumed) continue;

    let pi = i - 1;
    while (pi >= 0 && entries[pi].consumed) pi--;
    if (pi < 0) continue;

    const prevSf = tokens[pi].surface || "";
    const prevPron = tokens[pi].pronunciationKana || tokens[pi].readingKana || "";
    const currSf = tokens[i].surface || "";
    if (PROLONGED_SOUND_MARK.test(currSf)) {
      const vowel = entries[pi].romaji.match(/[aeiou]$/i)?.[0];
      if (vowel) entries[i].romaji = vowel.repeat(Array.from(currSf).length);
    }
    if (
      !(
        prevPron.endsWith("ッ") ||
        prevPron.endsWith("っ") ||
        prevSf.endsWith("っ") ||
        prevSf.endsWith("ッ")
      )
    ) {
      continue;
    }

    entries[pi].romaji = entries[pi].romaji.replace(SMALL_TSU_ROMAJI, "");
    entries[i].romaji = doubledSokuon(entries[i].romaji);
  }
}

/**
 * Pass 2: Determine which tokens should merge (no space before).
 * Returns a boolean array where true means "merge with previous token".
 */
export function computeNoSpaceBefore(
  entries: MergeableEntry[],
  tokens: readonly JapaneseAnalyzerToken[]
): boolean[] {
  const noSpaceBefore: boolean[] = Array.from({ length: tokens.length }, () => false);
  for (let i = 1; i < tokens.length; i++) {
    if (entries[i].consumed) {
      noSpaceBefore[i] = true;
      continue;
    }

    let pi = i - 1;
    while (pi >= 0 && entries[pi].consumed) pi--;
    if (pi < 0) continue;

    const prevSf = tokens[pi].surface;
    const prevPron = tokens[pi].pronunciationKana || tokens[pi].readingKana || "";
    const currSf = tokens[i].surface;
    const currPron = tokens[i].pronunciationKana || tokens[i].readingKana || "";

    // っ/ッ split onto either side of a token boundary still belongs to the
    // same romanized word.
    if (
      prevPron.endsWith("ッ") ||
      prevPron.endsWith("っ") ||
      prevSf.endsWith("っ") ||
      prevSf.endsWith("ッ") ||
      currPron.startsWith("ッ") ||
      currPron.startsWith("っ") ||
      currSf.startsWith("っ") ||
      currSf.startsWith("ッ")
    ) {
      noSpaceBefore[i] = true;
    }

    // う extending previous o-row sound (long vowel)
    if ((currSf === "う" || currPron === "う") && prevPron) {
      const last = prevPron[prevPron.length - 1];
      if ("おこそとのほもよろをごぞどぼぽょうくすつぬふむゆるぐずづぶぷゅ".includes(last)) {
        noSpaceBefore[i] = true;
      }
    }

    // い extending previous e-row sound (long vowel)
    if ((currSf === "い" || currPron === "い") && prevPron) {
      const last = prevPron[prevPron.length - 1];
      if ("えけせてねへめれげぜでべぺぇ".includes(last)) {
        noSpaceBefore[i] = true;
      }
    }

    // A separately tokenized chōonpu still extends the preceding mora.
    if (PROLONGED_SOUND_MARK.test(currSf)) {
      noSpaceBefore[i] = true;
    }

    const prevPos = tokens[pi].partOfSpeech;
    const prevFeatures = tokens[pi].morphologyFeatures;
    const currPos = tokens[i].partOfSpeech;
    const currFeatures = tokens[i].morphologyFeatures;
    const prevVerbLike =
      prevPos === "verb" ||
      prevPos === "auxiliaryVerb" ||
      prevFeatures.includes("conjunctiveParticle");
    if (prevVerbLike) {
      if (
        currPos === "verb" &&
        (currFeatures.includes("nonIndependent") || currFeatures.includes("suffix"))
      )
        noSpaceBefore[i] = true;
      if (currPos === "particle" && currFeatures.includes("conjunctiveParticle"))
        noSpaceBefore[i] = true;
      if (currPos === "auxiliaryVerb" && !/^(?:でしょ|です|だろ)/.test(currSf))
        noSpaceBefore[i] = true;
    }

    // Closing punctuation stays attached to the preceding text. Opening
    // punctuation starts a new Latin-typography group, while the first token
    // inside it stays attached to the opening mark.
    if (LeadingClosingPunctuation.test(currSf)) {
      noSpaceBefore[i] = true;
    }
    if (TrailingOpeningPunctuation.test(prevSf)) {
      noSpaceBefore[i] = true;
    }

    // Preserve authored slash adjacency instead of treating every slash as a
    // word separator. Entry offsets retain the source distinction between
    // `D/N/A`, `A/ B`, and `A / B` after tokenization.
    const adjacentInSource =
      entries[pi].end !== undefined &&
      entries[i].start !== undefined &&
      entries[pi].end === entries[i].start;
    const slashToken = /^[/／]+$/u;
    if (adjacentInSource && (slashToken.test(currSf) || slashToken.test(prevSf))) {
      noSpaceBefore[i] = true;
    }

    // Preserve an authored no-space boundary when Japanese text is attached
    // directly to a Latin/number label (for example 暁Records). Ordinary
    // Japanese token boundaries still use grammatical romaji spacing.
    const JapaneseText = /[぀-ヿ一-鿿々]/u;
    const LatinOrNumberText = /[\p{Script=Latin}\p{N}]/u;
    if (
      adjacentInSource &&
      ((JapaneseText.test(prevSf) && LatinOrNumberText.test(currSf)) ||
        (LatinOrNumberText.test(prevSf) && JapaneseText.test(currSf)))
    ) {
      noSpaceBefore[i] = true;
    }
  }
  return noSpaceBefore;
}
