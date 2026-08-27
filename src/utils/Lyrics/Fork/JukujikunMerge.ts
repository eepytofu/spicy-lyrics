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

const TERMINAL_SOKUON_ROMAJI = /(?:xtsu|ltsu|tsu|')$/i;
const PROLONGED_SOUND_MARK = /^ー+$/u;
const LEADING_PROLONGED_SOUND_MARK = /^ー+/u;
const LEADING_SMALL_KANA = /^[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/u;
const LeadingClosingPunctuation = /^(?:\p{Pe}|\p{Pf}|[。、？！…・.?!,\s])+/u;
const TrailingOpeningPunctuation = /(?:\p{Ps}|\p{Pi})+$/u;
const LeadingOpeningPunctuation = /^(?:\p{Ps}|\p{Pi})+/u;
const JapanesePhoneticText = /^[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]/u;
const ClosingBeforeOpeningPunctuation =
  /((?:\p{Pe}|\p{Pf}|[。、？！…・.?!,]))(?=(?:\p{Ps}|\p{Pi}))/gu;

const doubledSokuon = (romaji: string): string => {
  if (!romaji) return romaji;
  const lower = romaji.toLowerCase();
  if (!/^[a-z]/.test(lower) || /^[aeioun]/.test(lower)) return romaji;
  return `${lower.startsWith("ch") ? "t" : romaji[0]}${romaji}`;
};

export function applyPhoneticMerges(
  entries: MergeableEntry[],
  tokens: readonly JapaneseAnalyzerToken[],
  kanaToRomaji?: (kana: string) => string,
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
    const currReading = entries[i].readingKana ||
      tokens[i].pronunciationKana || tokens[i].readingKana || currSf;
    const leadingMarks = LEADING_PROLONGED_SOUND_MARK.exec(currSf)?.[0] ||
      LEADING_PROLONGED_SOUND_MARK.exec(currReading)?.[0];
    if (leadingMarks) {
      const vowel = entries[pi].romaji.match(/[aeiou]$/i)?.[0];
      if (vowel) {
        const markCount = Array.from(leadingMarks).length;
        const restKana = Array.from(currReading).slice(markCount).join("");
        const restRomaji = !restKana
          ? ""
          : kanaToRomaji
            ? kanaToRomaji(restKana)
            : entries[i].romaji.replace(/^-+/u, "");
        entries[i].romaji = `${vowel.repeat(markCount)}${restRomaji ? ` ${restRomaji}` : ""}`;
      }
    }
    if (kanaToRomaji && LEADING_SMALL_KANA.test(currReading)) {
      const previousKana = Array.from(entries[pi].readingKana || prevPron);
      const currentKana = Array.from(currReading);
      const previousLast = previousKana.pop();
      const currentFirst = currentKana.shift();
      if (previousLast && currentFirst) {
        const previousBase = kanaToRomaji(previousLast);
        const combined = kanaToRomaji(`${previousLast}${currentFirst}`);
        let shared = 0;
        while (
          shared < previousBase.length &&
          shared < combined.length &&
          previousBase[shared] === combined[shared]
        ) {
          shared += 1;
        }
        if (shared > 0) {
          entries[pi].romaji = `${kanaToRomaji(previousKana.join(""))}${combined.slice(0, shared)}`;
          entries[i].romaji = `${combined.slice(shared)}${kanaToRomaji(currentKana.join(""))}`;
        }
      }
    }
    const previousEndsWithSokuon =
      prevPron.endsWith("ッ") ||
      prevPron.endsWith("っ") ||
      prevSf.endsWith("っ") ||
      prevSf.endsWith("ッ");
    if (!previousEndsWithSokuon) {
      continue;
    }

    const currentIsJapanesePhonetic =
      JapanesePhoneticText.test(currSf) || JapanesePhoneticText.test(currReading);
    if (currentIsJapanesePhonetic) {
      entries[pi].romaji = entries[pi].romaji.replace(TERMINAL_SOKUON_ROMAJI, "");
      entries[i].romaji = doubledSokuon(entries[i].romaji);
    } else if (/^\p{Script=Latin}/u.test(currSf)) {
      entries[pi].romaji = entries[pi].romaji.replace(TERMINAL_SOKUON_ROMAJI, "'");
    } else {
      entries[pi].romaji = entries[pi].romaji.replace(TERMINAL_SOKUON_ROMAJI, "");
    }
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
    const previousEndsWithSokuon =
      prevPron.endsWith("ッ") ||
      prevPron.endsWith("っ") ||
      prevSf.endsWith("っ") ||
      prevSf.endsWith("ッ");
    const currentStartsWithSokuon =
      currPron.startsWith("ッ") ||
      currPron.startsWith("っ") ||
      currSf.startsWith("っ") ||
      currSf.startsWith("ッ");
    if (
      currentStartsWithSokuon ||
      (previousEndsWithSokuon && JapanesePhoneticText.test(currSf || currPron))
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
    if (LEADING_PROLONGED_SOUND_MARK.test(currSf)) {
      joinFor("phonetic");
    }
    if (LEADING_SMALL_KANA.test(currSf) || LEADING_SMALL_KANA.test(currPron)) {
      joinFor("phonetic");
    }
    if (
      PROLONGED_SOUND_MARK.test(prevSf) &&
      JapanesePhoneticText.test(currSf) &&
      !LeadingOpeningPunctuation.test(currSf)
    ) {
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
    if (prevPos === "prefix") joinFor("linguistic");

    const previousReadingGroup =
      entries[pi].readingGroupEndId ?? entries[pi].readingGroupId;
    const currentReadingGroup =
      entries[i].readingGroupStartId ?? entries[i].readingGroupId;
    if (previousReadingGroup && previousReadingGroup === currentReadingGroup) {
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
    const LatinText = /\p{Script=Latin}/u;
    const NumberText = /\p{N}/u;
    const previousIsPhoneticMark = /^[ーｰ]+$/u.test(prevSf);
    const currentIsPhoneticMark = /^[ーｰ]+$/u.test(currSf);
    if (
      adjacentInSource &&
      ((JapaneseText.test(prevSf) && NumberText.test(currSf)) ||
        (NumberText.test(prevSf) && JapaneseText.test(currSf)))
    ) {
      addReason(reasons, "mixedScript");
    } else if (
      adjacentInSource &&
      !previousEndsWithSokuon &&
      !previousIsPhoneticMark &&
      !currentIsPhoneticMark &&
      ((JapaneseText.test(prevSf) && LatinText.test(currSf)) ||
        (LatinText.test(prevSf) && JapaneseText.test(currSf)))
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
