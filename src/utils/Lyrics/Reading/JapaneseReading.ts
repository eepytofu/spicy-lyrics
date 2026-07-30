/**
 * Context-first Japanese reading orchestration.
 *
 * Source mapping, furigana geometry, romaji construction, and timed
 * projection live in focused modules. This facade preserves the public
 * reading contract used by processors and renderers.
 */

import Kuroshiro from "kuroshiro";
import {
  applyPhoneticMerges,
  buildJapaneseBoundaryPlan,
} from "../Fork/JukujikunMerge.ts";
import {
  projectProviderAuthoredJapaneseReadings,
  type ProviderAuthoredReadingHint,
} from "../Processing/Japanese/ProviderAuthoredReading.ts";
import {
  assertJapaneseAnalyzerTokens,
} from "../Processing/Japanese/JapaneseAnalyzer.ts";
import { kuromojiJapaneseAnalyzer } from "../Processing/Japanese/KuromojiJapaneseAnalyzer.ts";
import {
  applyProductivePersonCounterReadings,
  applyVerifiedLexicalReadings,
} from "../Processing/Japanese/JapaneseReadingResolver.ts";
import { loadJitendexFuriganaGeometry } from "../Processing/Japanese/JitendexFuriganaGeometry.ts";
import {
  buildFuriganaFromContext,
  kanaReadingForToken,
  kataToHira,
} from "./JapaneseFurigana.ts";
import {
  JapaneseSourceTextTest,
  KanjiTextTest,
  rangesOverlap,
  type FuriganaSegment,
  type JapaneseAnalysisOptions,
  type JapaneseReadable,
  type JapaneseReading,
  type JapaneseTimedTextSpan,
  type JapaneseTokenContext,
  type JapaneseTokenEntry,
  type PreparedJapaneseLineAnalysis,
} from "./JapaneseReadingModel.ts";
import {
  buildRomajiProjectionFromContext,
  entryRomaji,
} from "./JapaneseRomaji.ts";
import { applyJapaneseReadingContextToSyllables } from "./JapaneseTimedProjection.ts";

export {
  JapaneseKanaTextTest,
  JapaneseSourceTextTest,
  KanjiTextTest,
} from "./JapaneseReadingModel.ts";
export type {
  FuriganaSegment,
  JapaneseAnalysisOptions,
  JapaneseLineTextMap,
  JapaneseReadable,
  JapaneseReading,
  JapaneseRomajiSegment,
  JapaneseRomajiTimingProjection,
  JapaneseTimedTextSpan,
  PreparedJapaneseLineAnalysis,
  ProcessedTextEntry,
  TimedSyllableEntry,
  TimedSyllableGroup,
  TimedTextEntry,
} from "./JapaneseReadingModel.ts";
export {
  okuriganaAnchoredKanjiRunReading,
  resolveJapaneseTokenKanaReading,
} from "./JapaneseFurigana.ts";
export { buildJapaneseLineTextMap } from "./JapaneseSourceMapping.ts";

function projectJapaneseText(
  text: string,
  options: JapaneseAnalysisOptions,
): string {
  const projected = options.textProjection?.project(text) ?? text;
  if (projected.length !== text.length) {
    throw new Error(
      `Japanese text projection ${options.textProjection?.kind ?? "unknown"} changed UTF-16 length`,
    );
  }
  return projected;
}

function applyExplicitReadingOverrides(
  lineText: string,
  entries: JapaneseTokenEntry[],
  hints: readonly ProviderAuthoredReadingHint[],
): FuriganaSegment[] {
  const explicitReadings: FuriganaSegment[] = hints.map((hint) => ({
    start: hint.displayRange.start,
    end: hint.displayRange.end,
    reading: kataToHira(hint.reading),
    provenance: "providerExplicit",
  }));
  const KanaOnly = /^[ぁ-んァ-ンー]*$/u;

  for (const hint of hints) {
    const intersecting = entries
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          !entry.consumed &&
          rangesOverlap(
            entry.start,
            entry.end,
            hint.displayRange.start,
            hint.displayRange.end,
          ),
      );
    if (intersecting.length === 0) continue;

    const first = intersecting[0];
    const last = intersecting[intersecting.length - 1];
    const prefix = lineText.slice(first.entry.start, hint.displayRange.start);
    const suffix = lineText.slice(hint.displayRange.end, last.entry.end);
    if (!KanaOnly.test(prefix) || !KanaOnly.test(suffix)) continue;

    first.entry.surface = lineText.slice(first.entry.start, last.entry.end);
    first.entry.end = last.entry.end;
    first.entry.readingKana = kataToHira(`${prefix}${hint.reading}${suffix}`);
    first.entry.readingProvenance = "providerExplicit";
    for (const item of intersecting.slice(1)) item.entry.consumed = true;
  }

  return explicitReadings;
}

async function buildJapaneseTokenContext(
  lineText: string,
  options: JapaneseAnalysisOptions = {},
  explicitHints: readonly ProviderAuthoredReadingHint[] = [],
): Promise<JapaneseTokenContext> {
  const analysisText = projectJapaneseText(lineText, options);
  const analyzer = options.analyzer || kuromojiJapaneseAnalyzer;
  const tokens = [...(await analyzer.analyze(analysisText))];
  assertJapaneseAnalyzerTokens(analysisText, tokens);
  const kanaToRomaji =
    options.kanaRomanizer ||
    ((kana: string) => (Kuroshiro as any).Util.kanaToRomaji(kana));
  const entries: JapaneseTokenEntry[] = [];

  for (const token of tokens) {
    const surface = token.surface;
    const hasJapaneseScript = JapaneseSourceTextTest.test(surface);
    const readingKana = hasJapaneseScript ? token.readingKana : "";
    const entry: JapaneseTokenEntry = {
      start: token.start,
      end: token.end,
      romaji: surface,
      surface,
      readingKana,
      furigana: hasJapaneseScript
        ? kanaReadingForToken(surface, readingKana)
        : undefined,
      consumed: false,
    };
    entry.romaji = entryRomaji(entry, token, kanaToRomaji);
    entries.push(entry);
  }

  analyzer.applyReadingOverrides?.(entries, tokens);
  applyVerifiedLexicalReadings(analysisText, tokens, entries);
  applyProductivePersonCounterReadings(analysisText, tokens, entries);
  const explicitReadings = applyExplicitReadingOverrides(
    lineText,
    entries,
    explicitHints,
  );
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].consumed) continue;
    entries[index].romaji = entryRomaji(entries[index], tokens[index], kanaToRomaji);
  }
  applyPhoneticMerges(entries, tokens);

  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].consumed) continue;
    for (
      let followerIndex = index + 1;
      followerIndex < entries.length && entries[followerIndex].consumed;
      followerIndex += 1
    ) {
      entries[index].end = entries[followerIndex].end;
      if (!entries[index].furigana && entries[followerIndex].furigana) {
        entries[index].furigana = entries[followerIndex].furigana;
      }
    }
  }

  return {
    analyzer,
    tokens,
    entries,
    boundaryPlan: buildJapaneseBoundaryPlan(entries, tokens, analysisText),
    explicitReadings,
    kanaToRomaji,
  };
}

export async function prepareJapaneseLineAnalysis(
  text: string,
  options: JapaneseAnalysisOptions = {},
): Promise<PreparedJapaneseLineAnalysis | undefined> {
  const sourceText = (text || "").normalize("NFKC");
  if (!JapaneseSourceTextTest.test(sourceText)) return undefined;
  const projection =
    options.authoredReadingProjection?.sourceText === sourceText
      ? options.authoredReadingProjection
      : projectProviderAuthoredJapaneseReadings(sourceText);
  const displayText = projectJapaneseText(projection.displayText, options);

  const context = await buildJapaneseTokenContext(
    displayText,
    options,
    projection.hints,
  );
  const romajiProjection = buildRomajiProjectionFromContext(context);
  let furigana: FuriganaSegment[] = [];
  if (KanjiTextTest.test(displayText)) {
    await loadJitendexFuriganaGeometry();
    furigana = buildFuriganaFromContext(displayText, context);
  }

  const reading: JapaneseReading = {
    sourceText,
    ...(displayText !== sourceText ? { displayText } : {}),
    romaji: romajiProjection.romaji,
    ...(romajiProjection.segments.length > 0
      ? { romajiSegments: romajiProjection.segments }
      : {}),
    furigana,
  };
  return {
    reading,
    applyToSyllables: (syllables, spans) => {
      applyJapaneseReadingContextToSyllables(reading, context, syllables, spans);
    },
  };
}

export async function analyzeJapaneseLine(
  text: string,
  options: JapaneseAnalysisOptions = {},
): Promise<JapaneseReading | undefined> {
  return (await prepareJapaneseLineAnalysis(text, options))?.reading;
}

export function assignJapaneseReading(
  target: JapaneseReadable,
  reading: JapaneseReading | undefined,
): void {
  if (reading && (reading.romaji || reading.furigana.length > 0)) {
    target.JapaneseReading = reading;
  } else {
    delete target.JapaneseReading;
  }
}

export async function annotateJapaneseTextTarget(
  target: JapaneseReadable,
  options: JapaneseAnalysisOptions = {},
): Promise<JapaneseReading | undefined> {
  const text = target.Text?.normalize("NFKC") || "";
  if (target.Text) target.Text = text;
  const reading = await analyzeJapaneseLine(text, options);
  assignJapaneseReading(target, reading);
  return reading;
}

export async function applyJapaneseReadingToSyllables(
  lineText: string,
  syllables: JapaneseReadable[],
  spans?: JapaneseTimedTextSpan[],
  options: JapaneseAnalysisOptions = {},
  prepared?: PreparedJapaneseLineAnalysis,
): Promise<JapaneseReading | undefined> {
  const normalizedLineText = (lineText || "").normalize("NFKC");
  const authoredDisplayText =
    options.authoredReadingProjection?.sourceText === normalizedLineText
      ? options.authoredReadingProjection.displayText
      : projectProviderAuthoredJapaneseReadings(normalizedLineText).displayText;
  const expectedDisplayText = projectJapaneseText(authoredDisplayText, options);
  const analysis =
    (prepared?.reading.displayText || prepared?.reading.sourceText) ===
    expectedDisplayText
      ? prepared
      : await prepareJapaneseLineAnalysis(normalizedLineText, options);
  if (!analysis) {
    for (const syllable of syllables) {
      delete syllable.JapaneseReading;
      delete syllable.RomanizedText;
      delete syllable.TransliteratedText;
      delete syllable.RomajiSpaceBefore;
      delete syllable.JapaneseRomajiTiming;
    }
    return undefined;
  }

  analysis.applyToSyllables(syllables, spans);
  return analysis.reading;
}
