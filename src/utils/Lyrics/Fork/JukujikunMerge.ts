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

export type JapaneseBoundaryReason =
  | "start"
  | "consumed"
  | "phonetic"
  | "linguistic"
  | "punctuation"
  | "sourceWhitespace"
  | "sourceAdjacency"
  | "mixedScript";

export type JapaneseTokenBoundary = {
  tokenIndex: number;
  joinsPrevious: boolean;
  reasons: readonly JapaneseBoundaryReason[];
};

export type JapaneseBoundaryPlan = readonly JapaneseTokenBoundary[];

/**
 * Determines the display-reading boundary before every analyzer token while
 * retaining why that boundary exists. Source evidence, linguistic grouping,
 * phonetic joining, punctuation, and mixed-script policy therefore remain
 * distinguishable to downstream romaji and timing projection.
 */
export function buildJapaneseBoundaryPlan(
  entries: MergeableEntry[],
  tokens: readonly JapaneseAnalyzerToken[],
  sourceText?: string,
): JapaneseBoundaryPlan {
  if (tokens.length === 0) return [];
  const plan: JapaneseTokenBoundary[] = [];
  const addReason = (
    reasons: JapaneseBoundaryReason[],
    reason: JapaneseBoundaryReason,
  ) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  for (let i = 1; i < tokens.length; i++) {
    const reasons: JapaneseBoundaryReason[] = [];
    let joinsPrevious = false;
    const joinFor = (reason: JapaneseBoundaryReason) => {
      joinsPrevious = true;
      addReason(reasons, reason);
    };
    if (entries[i].consumed) {
      plan.push({ tokenIndex: i, joinsPrevious: true, reasons: ["consumed"] });
      continue;
    }

    let pi = i - 1;
    while (pi >= 0 && entries[pi].consumed) pi--;
    if (pi < 0) {
      plan.push({ tokenIndex: i, joinsPrevious: false, reasons: ["start"] });
      continue;
    }

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
      joinFor("phonetic");
    }

    // う extending previous o-row sound (long vowel)
    if ((currSf === "う" || currPron === "う") && prevPron) {
      const last = prevPron[prevPron.length - 1];
      if ("おこそとのほもよろをごぞどぼぽょうくすつぬふむゆるぐずづぶぷゅ".includes(last)) {
        joinFor("phonetic");
      }
    }

    // い extending previous e-row sound (long vowel)
    if ((currSf === "い" || currPron === "い") && prevPron) {
      const last = prevPron[prevPron.length - 1];
      if ("えけせてねへめれげぜでべぺぇ".includes(last)) {
        joinFor("phonetic");
      }
    }

    // A separately tokenized chōonpu still extends the preceding mora.
    if (PROLONGED_SOUND_MARK.test(currSf)) {
      joinFor("phonetic");
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
        joinFor("linguistic");
      if (currPos === "particle" && currFeatures.includes("conjunctiveParticle"))
        joinFor("linguistic");
      if (currPos === "auxiliaryVerb" && !/^(?:でしょ|です|だろ)/.test(currSf))
        joinFor("linguistic");
    }

    if (
      entries[pi].readingGroupId &&
      entries[pi].readingGroupId === entries[i].readingGroupId
    ) {
      joinFor("linguistic");
    }

    // Closing punctuation stays attached to the preceding text. Opening
    // punctuation starts a new Latin-typography group, while the first token
    // inside it stays attached to the opening mark.
    if (LeadingClosingPunctuation.test(currSf)) {
      joinFor("punctuation");
    }
    if (TrailingOpeningPunctuation.test(prevSf)) {
      joinFor("punctuation");
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
      joinFor("sourceAdjacency");
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
      joinFor("mixedScript");
    }

    if (reasons.length === 0) {
      const sourceGap =
        sourceText !== undefined &&
        entries[pi].end !== undefined &&
        entries[i].start !== undefined
          ? sourceText.slice(entries[pi].end, entries[i].start)
          : "";
      addReason(
        reasons,
        /\s/u.test(sourceGap)
          ? "sourceWhitespace"
          : "linguistic",
      );
    }
    plan.push({ tokenIndex: i, joinsPrevious, reasons });
  }

  return [
    { tokenIndex: 0, joinsPrevious: false, reasons: ["start"] },
    ...plan,
  ];
}

export function japaneseTokenJoinsPrevious(
  plan: JapaneseBoundaryPlan,
  tokenIndex: number,
): boolean {
  return plan[tokenIndex]?.joinsPrevious === true;
}
