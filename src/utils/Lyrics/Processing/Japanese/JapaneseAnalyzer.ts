export type JapaneseAnalyzerTokenRangeSource = "native" | "surfaceAligned";
export type JapanesePartOfSpeech =
  | "noun"
  | "pronoun"
  | "verb"
  | "auxiliaryVerb"
  | "particle"
  | "suffix"
  | "other";
export type JapaneseMorphologyFeature =
  | "conjunctiveParticle"
  | "nonIndependent"
  | "suffix"
  | "numeric"
  | "counter"
  | "properName";

export type JapaneseAnalyzerTokenProvenance = {
  analyzerId: string;
  analyzerVersion?: string;
  dictionaryId?: string;
  rangeSource: JapaneseAnalyzerTokenRangeSource;
  nativeWordId?: number;
  nativeWordType?: string;
  nativeWordPosition?: number;
  rawPartOfSpeech?: string;
  rawPartOfSpeechDetail1?: string;
  rawPartOfSpeechDetail2?: string;
};

/**
 * Analyzer-neutral Japanese morphology. Offsets are UTF-16 string indexes so
 * they can be projected directly onto the existing lyric and DOM contracts.
 */
export type JapaneseAnalyzerToken = {
  surface: string;
  start: number;
  end: number;
  readingKana: string;
  pronunciationKana: string;
  partOfSpeech: JapanesePartOfSpeech;
  morphologyFeatures: readonly JapaneseMorphologyFeature[];
  baseForm: string;
  conjugationType: string;
  conjugationForm: string;
  provenance: JapaneseAnalyzerTokenProvenance;
};

export type JapaneseAnalyzerReadingState = {
  romaji: string;
  consumed: boolean;
  /** Stable derived lexical group used by the reading boundary planner. */
  readingGroupId?: string;
  surface?: string;
  readingKana?: string;
  start?: number;
  end?: number;
};

export interface JapaneseAnalyzer {
  readonly id: string;
  analyze(text: string): Promise<readonly JapaneseAnalyzerToken[]>;
  /**
   * Optional analyzer-specific compatibility policy. Shared furigana and
   * timing projection never applies another analyzer's corrective heuristics.
   */
  applyReadingOverrides?(
    entries: JapaneseAnalyzerReadingState[],
    tokens: readonly JapaneseAnalyzerToken[]
  ): void;
}

export type JapaneseKanaRomanizer = (kana: string) => string;

/**
 * Analyzer adapters must fail closed when a token cannot be mapped back to the
 * exact analyzed text. An experiment may use different linguistic boundaries,
 * but it may not invent or reorder source ranges.
 */
export function assertJapaneseAnalyzerTokens(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[]
): void {
  let previousEnd = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!Number.isInteger(token.start) || !Number.isInteger(token.end)) {
      throw new Error(`Japanese analyzer token ${index} has a non-integer range`);
    }
    if (token.start < previousEnd || token.end < token.start || token.end > text.length) {
      throw new Error(`Japanese analyzer token ${index} has an invalid or overlapping range`);
    }
    if (text.slice(token.start, token.end) !== token.surface) {
      throw new Error(`Japanese analyzer token ${index} does not match its source range`);
    }
    previousEnd = token.end;
  }
}
