import type {
  JapaneseBoundaryPlan,
  MergeableEntry,
} from "../Fork/JukujikunMerge.ts";
import type { ReadingProvenance, RenderPlan } from "../Processing/Model.ts";
import type {
  JapaneseAnalyzer,
  JapaneseAnalyzerToken,
  JapaneseKanaRomanizer,
} from "../Processing/Japanese/JapaneseAnalyzer.ts";
import type {
  ProviderAuthoredReadingProjection,
} from "../Processing/Japanese/ProviderAuthoredReading.ts";
import type { ProviderRubyReadable } from "../ProviderRuby.ts";

export type FuriganaSegment = {
  start: number;
  end: number;
  reading: string;
  /** Stable full-line code-point range and reading identity. */
  lineSegmentKey?: string;
  provenance?: ReadingProvenance;
};

export type JapaneseRomajiSegment = {
  text: string;
  provenance?: ReadingProvenance;
};

export type JapaneseReading = {
  /** Immutable provider text retained for copy and interop. */
  sourceText: string;
  /** Display-only text after a safe authored reading such as 天(そら) becomes ruby. */
  displayText?: string;
  romaji?: string;
  romajiSegments?: JapaneseRomajiSegment[];
  furigana: FuriganaSegment[];
};

export type JapaneseRomajiTimingProjection = {
  /** Stable lexical group used only by the derived reading row. */
  logicalGroupId: string;
  /** Span indexes whose combined window owns this reading unit's sweep. */
  animationSpanIndexes: number[];
  /** Exact UTF-16 source range represented by this reading unit. */
  animationStart: number;
  animationEnd: number;
};

export type JapaneseReadable = ProviderRubyReadable & {
  Text?: string;
  TransliteratedText?: string;
  RomanizedText?: string;
  ProviderTranslatedText?: string;
  ProviderTranslationLanguage?: string;
  JapaneseReading?: JapaneseReading;
  RomajiSpaceBefore?: boolean;
  JapaneseRomajiTiming?: JapaneseRomajiTimingProjection;
  ReadingRenderPlan?: RenderPlan;
  ReadingPrimaryScript?: "Japanese" | "Chinese";
};

export type JapaneseTextProjection = {
  readonly kind: string;
  project(text: string): string;
};

export type JapaneseAnalysisOptions = {
  /**
   * Explicit pre-analysis and display projection. The reading pipeline does
   * not infer provider identity or mutate immutable source evidence.
   */
  textProjection?: JapaneseTextProjection;
  authoredReadingProjection?: ProviderAuthoredReadingProjection;
  /** Explicit analyzer seam for tests and isolated experiments. */
  analyzer?: JapaneseAnalyzer;
  /** Optional replacement for Kuroshiro's deterministic kana-to-romaji utility. */
  kanaRomanizer?: JapaneseKanaRomanizer;
};

export type ProcessedTextEntry = JapaneseReadable & {
  Text: string;
  TranslatedText?: string;
};

export type TimedTextEntry = ProcessedTextEntry & {
  StartTime: number;
  EndTime: number;
  OppositeAligned?: boolean;
};

export type TimedSyllableEntry = JapaneseReadable & {
  Text: string;
  StartTime: number;
  EndTime: number;
  IsPartOfWord?: boolean;
};

export type TimedSyllableGroup = JapaneseReadable & {
  StartTime: number;
  EndTime: number;
  Syllables: TimedSyllableEntry[];
  TranslatedText?: string;
};

export type JapaneseTimedTextSpan = {
  index: number;
  rawText: string;
  normalizedText: string;
  start: number;
  end: number;
};

export type JapaneseLineTextMap = {
  sourceText: string;
  lineText: string;
  spans: JapaneseTimedTextSpan[];
};

export const JapaneseSourceTextTest = /[぀-ヿ一-鿿々]/;
export const JapaneseKanaTextTest = /[ぁ-んァ-ン]/;
export const KanjiTextTest = /[一-鿿々]/;
export const KanjiLikeCharTest = /[一-鿿々]/;
export const KanaCharTest = /[ぁ-んァ-ンー]/;

export type TokenFuriganaReading = {
  text: string;
  targetStart: number;
  targetEnd: number;
};

export type JapaneseTokenEntry = MergeableEntry & {
  start: number;
  end: number;
  surface: string;
  readingKana: string;
  furigana?: TokenFuriganaReading;
  /** Exact dictionary geometry proven for this final surface and reading. */
  provenFurigana?: readonly TokenFuriganaReading[];
  readingProvenance?: ReadingProvenance;
};

export type JapaneseTokenContext = {
  analyzer: JapaneseAnalyzer;
  tokens: readonly JapaneseAnalyzerToken[];
  entries: JapaneseTokenEntry[];
  boundaryPlan: JapaneseBoundaryPlan;
  explicitReadings: FuriganaSegment[];
  kanaToRomaji: JapaneseKanaRomanizer;
};

/**
 * One processing-local Japanese analysis. Callers may project the same result
 * onto more than one equivalent span layout without parsing the line again.
 */
export type PreparedJapaneseLineAnalysis = {
  readonly reading: JapaneseReading;
  applyToSyllables(syllables: JapaneseReadable[], spans?: JapaneseTimedTextSpan[]): void;
};

export function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA;
}
