import type { JapaneseAnalyzerReadingState, JapaneseAnalyzerToken } from "./JapaneseAnalyzer.ts";

const PRODUCTIVE_PERSON_COUNTER_READINGS = new Map([
  ["一", "ひとり"],
  ["二", "ふたり"],
]);

const NAME_LIKE_SUFFIXES = new Set(["さん", "くん", "君", "ちゃん", "様", "氏", "殿"]);

export type ProductivePersonCounterDecision = {
  source: "productivePersonCounter";
  start: number;
  end: number;
  surface: string;
  readingKana: string;
  baselineReadingKana: string;
  tokenStartIndex: number;
  tokenEndIndex: number;
  geometry: "irreducibleWholeSpan";
};

export type ProductivePersonCounterAbstention = ProductivePersonCounterDecision & {
  reason: "insideLargerNumber" | "nameLikeContext" | "readingStateConflict";
};

export type ProductivePersonCounterCollection = {
  decisions: ProductivePersonCounterDecision[];
  abstentions: ProductivePersonCounterAbstention[];
};

export type ProductivePersonCounterAudit = {
  applied: ProductivePersonCounterDecision[];
  abstentions: ProductivePersonCounterAbstention[];
};

function candidate(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[],
  tokenStartIndex: number,
  readingKana: string
): ProductivePersonCounterDecision {
  const numberToken = tokens[tokenStartIndex];
  const counterToken = tokens[tokenStartIndex + 1];
  return {
    source: "productivePersonCounter",
    start: numberToken.start,
    end: counterToken.end,
    surface: text.slice(numberToken.start, counterToken.end),
    readingKana,
    baselineReadingKana: `${numberToken.readingKana}${counterToken.readingKana}`,
    tokenStartIndex,
    tokenEndIndex: tokenStartIndex + 1,
    geometry: "irreducibleWholeSpan",
  };
}

/**
 * Recognize only the two irregular native person counters that Kuromoji/IPADIC
 * splits into a numeric noun plus the 人 counter. This is intentionally not a
 * general dictionary or numeric-expression resolver.
 */
export function collectProductivePersonCounterReadings(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[]
): ProductivePersonCounterCollection {
  const decisions: ProductivePersonCounterDecision[] = [];
  const abstentions: ProductivePersonCounterAbstention[] = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const numberToken = tokens[index];
    const counterToken = tokens[index + 1];
    const readingKana = PRODUCTIVE_PERSON_COUNTER_READINGS.get(numberToken.surface);
    if (
      !readingKana ||
      numberToken.end !== counterToken.start ||
      numberToken.partOfSpeech !== "noun" ||
      !numberToken.morphologyFeatures.includes("numeric") ||
      counterToken.surface !== "人" ||
      counterToken.partOfSpeech !== "noun" ||
      !counterToken.morphologyFeatures.includes("counter")
    ) {
      continue;
    }

    const decision = candidate(text, tokens, index, readingKana);
    const preceding = tokens[index - 1];
    if (
      preceding &&
      preceding.end === decision.start &&
      preceding.morphologyFeatures.includes("numeric")
    ) {
      abstentions.push({ ...decision, reason: "insideLargerNumber" });
      continue;
    }

    const following = tokens[index + 2];
    if (
      following &&
      following.start === decision.end &&
      (following.morphologyFeatures.includes("properName") ||
        NAME_LIKE_SUFFIXES.has(following.surface))
    ) {
      abstentions.push({ ...decision, reason: "nameLikeContext" });
      continue;
    }

    if (decision.baselineReadingKana !== decision.readingKana) decisions.push(decision);
  }

  return { decisions, abstentions };
}

export function applyProductivePersonCounterReadings(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[],
  entries: JapaneseAnalyzerReadingState[]
): ProductivePersonCounterAudit {
  const collected = collectProductivePersonCounterReadings(text, tokens);
  const applied: ProductivePersonCounterDecision[] = [];
  const abstentions = [...collected.abstentions];

  for (const decision of collected.decisions) {
    const first = entries[decision.tokenStartIndex];
    const last = entries[decision.tokenEndIndex];
    if (
      !first ||
      !last ||
      first.consumed ||
      last.consumed ||
      first.start !== decision.start ||
      last.end !== decision.end
    ) {
      abstentions.push({ ...decision, reason: "readingStateConflict" });
      continue;
    }

    first.surface = decision.surface;
    first.end = decision.end;
    first.readingKana = decision.readingKana;
    last.consumed = true;
    applied.push(decision);
  }

  return { applied, abstentions };
}
