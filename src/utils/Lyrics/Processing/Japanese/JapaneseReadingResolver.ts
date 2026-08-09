import type { JapaneseAnalyzerReadingState, JapaneseAnalyzerToken } from "./JapaneseAnalyzer.ts";

const PRODUCTIVE_PERSON_COUNTER_READINGS = new Map([
  ["一", "ひとり"],
  ["二", "ふたり"],
]);

const NAME_LIKE_SUFFIXES = new Set(["さん", "くん", "君", "ちゃん", "様", "氏", "殿"]);

type VerifiedLexicalTokenRule = {
  surface: string;
  baselineReadingKana: string;
  readingKana: string;
};

type VerifiedLexicalRule = {
  lexicalSurface: string;
  tokens: readonly VerifiedLexicalTokenRule[];
  preserveTokenBoundaries?: true;
};

/**
 * Small product slice from pinned dictionary audits and authoritative lyric
 * evidence.
 * Each rule preserves Kuromoji's token ranges and applies only when the full
 * lexical surface, tokenization, and baseline readings still match the audited
 * shape. Broad dictionary and frequency-driven selection intentionally remain
 * offline-only.
 */
const VERIFIED_LEXICAL_RULES: readonly VerifiedLexicalRule[] = [
  {
    lexicalSurface: "大人買い",
    tokens: [
      { surface: "大人", baselineReadingKana: "おとな", readingKana: "おとな" },
      { surface: "買い", baselineReadingKana: "かい", readingKana: "がい" },
    ],
  },
  {
    lexicalSurface: "響めく",
    tokens: [
      { surface: "響", baselineReadingKana: "ひびき", readingKana: "どよ" },
      { surface: "めく", baselineReadingKana: "めく", readingKana: "めく" },
    ],
  },
  {
    lexicalSurface: "一歩",
    tokens: [
      { surface: "一", baselineReadingKana: "いち", readingKana: "いっ" },
      { surface: "歩", baselineReadingKana: "ほ", readingKana: "ぽ" },
    ],
  },
  {
    lexicalSurface: "目蓋",
    tokens: [
      { surface: "目", baselineReadingKana: "め", readingKana: "ま" },
      { surface: "蓋", baselineReadingKana: "ふた", readingKana: "ぶた" },
    ],
  },
  {
    lexicalSurface: "変われる",
    tokens: [
      { surface: "変", baselineReadingKana: "へん", readingKana: "か" },
      { surface: "われる", baselineReadingKana: "われる", readingKana: "われる" },
    ],
  },
  {
    // canoue, "Sabaku ni sumu mamono"; exact lyric context disambiguates 金.
    lexicalSurface: "金も種も",
    preserveTokenBoundaries: true,
    tokens: [
      { surface: "金", baselineReadingKana: "きん", readingKana: "かね" },
      { surface: "も", baselineReadingKana: "も", readingKana: "も" },
      { surface: "種", baselineReadingKana: "たね", readingKana: "たね" },
      { surface: "も", baselineReadingKana: "も", readingKana: "も" },
    ],
  },
  {
    // Hiiragi Magnetite, "Tetoris"; canonical Vocaloid Lyrics Wiki reading.
    lexicalSurface: "金による",
    preserveTokenBoundaries: true,
    tokens: [
      { surface: "金", baselineReadingKana: "きむ", readingKana: "かね" },
      { surface: "による", baselineReadingKana: "による", readingKana: "による" },
    ],
  },
];

export type VerifiedLexicalReadingDecision = {
  source: "verifiedLexical";
  start: number;
  end: number;
  surface: string;
  readingKana: string;
  baselineReadingKana: string;
  tokenIndex: number;
  lexicalSurface: string;
  lexicalStart: number;
  lexicalEnd: number;
  preserveTokenBoundaries: boolean;
};

export type VerifiedLexicalReadingAbstention = {
  source: "verifiedLexical";
  lexicalSurface: string;
  lexicalStart: number;
  lexicalEnd: number;
  reason: "nameLikeContext" | "readingStateConflict";
};

export type VerifiedLexicalReadingCollection = {
  decisions: VerifiedLexicalReadingDecision[];
  abstentions: VerifiedLexicalReadingAbstention[];
};

export type VerifiedLexicalReadingAudit = {
  applied: VerifiedLexicalReadingDecision[];
  abstentions: VerifiedLexicalReadingAbstention[];
};

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

function tokensMatchVerifiedLexicalRule(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[],
  startIndex: number,
  rule: VerifiedLexicalRule
): boolean {
  const lastIndex = startIndex + rule.tokens.length - 1;
  if (lastIndex >= tokens.length) return false;

  for (let offset = 0; offset < rule.tokens.length; offset += 1) {
    const token = tokens[startIndex + offset];
    const expected = rule.tokens[offset];
    if (
      token.surface !== expected.surface ||
      token.readingKana !== expected.baselineReadingKana ||
      (offset > 0 && tokens[startIndex + offset - 1].end !== token.start)
    ) {
      return false;
    }
  }

  return text.slice(tokens[startIndex].start, tokens[lastIndex].end) === rule.lexicalSurface;
}

export function collectVerifiedLexicalReadings(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[]
): VerifiedLexicalReadingCollection {
  const decisions: VerifiedLexicalReadingDecision[] = [];
  const abstentions: VerifiedLexicalReadingAbstention[] = [];

  for (const rule of VERIFIED_LEXICAL_RULES) {
    for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
      if (!tokensMatchVerifiedLexicalRule(text, tokens, startIndex, rule)) continue;

      const lastIndex = startIndex + rule.tokens.length - 1;
      const lexicalStart = tokens[startIndex].start;
      const lexicalEnd = tokens[lastIndex].end;
      const following = tokens[lastIndex + 1];
      if (
        following &&
        following.start === lexicalEnd &&
        (following.morphologyFeatures.includes("properName") ||
          NAME_LIKE_SUFFIXES.has(following.surface))
      ) {
        abstentions.push({
          source: "verifiedLexical",
          lexicalSurface: rule.lexicalSurface,
          lexicalStart,
          lexicalEnd,
          reason: "nameLikeContext",
        });
        continue;
      }

      for (let offset = 0; offset < rule.tokens.length; offset += 1) {
        const expected = rule.tokens[offset];
        if (expected.readingKana === expected.baselineReadingKana) continue;
        const tokenIndex = startIndex + offset;
        const token = tokens[tokenIndex];
        decisions.push({
          source: "verifiedLexical",
          start: token.start,
          end: token.end,
          surface: token.surface,
          readingKana: expected.readingKana,
          baselineReadingKana: expected.baselineReadingKana,
          tokenIndex,
          lexicalSurface: rule.lexicalSurface,
          lexicalStart,
          lexicalEnd,
          preserveTokenBoundaries: rule.preserveTokenBoundaries === true,
        });
      }
    }
  }

  return { decisions, abstentions };
}

export function applyVerifiedLexicalReadings(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[],
  entries: JapaneseAnalyzerReadingState[]
): VerifiedLexicalReadingAudit {
  const collected = collectVerifiedLexicalReadings(text, tokens);
  const applied: VerifiedLexicalReadingDecision[] = [];
  const abstentions = [...collected.abstentions];

  const decisionGroups = new Map<string, VerifiedLexicalReadingDecision[]>();
  for (const decision of collected.decisions) {
    const key = `${decision.lexicalStart}:${decision.lexicalEnd}`;
    const group = decisionGroups.get(key);
    if (group) group.push(decision);
    else decisionGroups.set(key, [decision]);
  }

  for (const decisions of decisionGroups.values()) {
    const hasConflict = decisions.some((decision) => {
      const entry = entries[decision.tokenIndex];
      return (
        !entry ||
        entry.consumed ||
        entry.start !== decision.start ||
        entry.end !== decision.end ||
        entry.surface !== decision.surface ||
        entry.readingKana !== decision.baselineReadingKana
      );
    });
    if (hasConflict) {
      const first = decisions[0];
      abstentions.push({
        source: "verifiedLexical",
        lexicalSurface: first.lexicalSurface,
        lexicalStart: first.lexicalStart,
        lexicalEnd: first.lexicalEnd,
        reason: "readingStateConflict",
      });
      continue;
    }

    for (const decision of decisions) {
      entries[decision.tokenIndex].readingKana = decision.readingKana;
      applied.push(decision);
    }
    const first = decisions[0];
    if (first.preserveTokenBoundaries) continue;
    const readingGroupId =
      `verified-lexical:${first.lexicalStart}:${first.lexicalEnd}`;
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex];
      if (
        token.start >= first.lexicalStart &&
        token.end <= first.lexicalEnd
      ) {
        entries[tokenIndex].readingGroupId = readingGroupId;
      }
    }
  }

  return { applied, abstentions };
}

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
