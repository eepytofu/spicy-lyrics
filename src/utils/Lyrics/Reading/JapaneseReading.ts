/**
 * Context-first Japanese reading orchestration.
 *
 * Source mapping, furigana geometry, romaji construction, and timed
 * projection live in focused modules. This facade preserves the public
 * reading contract used by processors and renderers.
 */

import {
  applyPhoneticMerges,
  buildJapaneseBoundaryPlan,
} from "../Fork/JukujikunMerge.ts";
import {
  projectProviderAuthoredJapaneseReadings,
  projectProviderSourceOffset,
  type ProviderAuthoredReadingHint,
} from "../Processing/Japanese/ProviderAuthoredReading.ts";
import { romanizeJapaneseKana } from "../Processing/Japanese/JapaneseRomanizer.ts";
import {
  assertJapaneseAnalyzerTokens,
} from "../Processing/Japanese/JapaneseAnalyzer.ts";
import { kuromojiJapaneseAnalyzer } from "../Processing/Japanese/KuromojiJapaneseAnalyzer.ts";
import {
  resolveJapaneseDeinflectionReadings,
} from "../Processing/Japanese/JapaneseDeinflectionResolver.ts";
import {
  applyProductivePersonCounterReadings,
  applyVerifiedLexicalReadings,
} from "../Processing/Japanese/JapaneseReadingResolver.ts";
import {
  resolveJapaneseDictionaryCoverage,
} from "../Processing/Japanese/JapaneseReadingFallback.ts";
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
import {
  buildTextAnalysisProjection,
  mapAnalysisUtf16RangeToDisplay,
  mapDisplayUtf16RangeToAnalysis,
} from "../Processing/TextAnalysisProjection.ts";

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

export function projectJapaneseReadingToSource(
  reading: JapaneseReading,
  sourceText: string,
  options: JapaneseAnalysisOptions = {},
): JapaneseReading | undefined {
  const authoredProjection = projectProviderAuthoredJapaneseReadings(sourceText);
  const displayText = projectJapaneseText(authoredProjection.displayText, options);
  const textProjection = buildTextAnalysisProjection(displayText);
  const analysisDisplayText = reading.displayText ?? reading.sourceText;
  if (!textProjection.coordinateSafe) {
    return undefined;
  }
  let analysisOffset = 0;
  if (textProjection.analysisText !== analysisDisplayText) {
    const leadingWhitespace = textProjection.analysisText.match(/^\s*/u)?.[0] || "";
    const trailingWhitespace = textProjection.analysisText.match(/\s*$/u)?.[0] || "";
    const coreEnd = Math.max(
      leadingWhitespace.length,
      textProjection.analysisText.length - trailingWhitespace.length,
    );
    if (
      textProjection.analysisText.slice(leadingWhitespace.length, coreEnd) !== analysisDisplayText
    ) {
      return undefined;
    }
    analysisOffset = leadingWhitespace.length;
  }
  const furigana = reading.furigana.flatMap((segment) => {
    const range = mapAnalysisUtf16RangeToDisplay(textProjection, {
      start: segment.start + analysisOffset,
      end: segment.end + analysisOffset,
    });
    return range ? [{ ...segment, ...range }] : [];
  });
  return {
    sourceText,
    ...(displayText !== sourceText ? { displayText } : {}),
    romaji: reading.romaji,
    ...(reading.romajiSegments ? { romajiSegments: reading.romajiSegments } : {}),
    furigana,
  };
}

function applyExplicitReadingOverrides(
  lineText: string,
  entries: JapaneseTokenEntry[],
  hints: readonly ProviderAuthoredReadingHint[],
): FuriganaSegment[] {
  const explicitReadings: FuriganaSegment[] = hints.map((hint) => ({
    start: hint.displayRange.start,
    end: hint.displayRange.end,
    reading: hint.reading,
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
    first.entry.readingKana = kataToHira(`${prefix}${hint.reading.normalize("NFKC")}${suffix}`);
    first.entry.readingProvenance = "providerExplicit";
    for (const item of intersecting.slice(1)) item.entry.consumed = true;
  }

  return explicitReadings;
}

function applyCompleteExplicitTokenReadings(
  lineText: string,
  entries: JapaneseTokenEntry[],
  hints: readonly ProviderAuthoredReadingHint[],
): void {
  for (const entry of entries) {
    if (entry.consumed || !KanjiTextTest.test(entry.surface)) continue;
    const contained = hints
      .filter((hint) =>
        hint.displayRange.start >= entry.start && hint.displayRange.end <= entry.end
      )
      .sort((left, right) => left.displayRange.start - right.displayRange.start);
    if (contained.length === 0) continue;

    let cursor = entry.start;
    let readingKana = "";
    let complete = true;
    for (const hint of contained) {
      const gap = lineText.slice(cursor, hint.displayRange.start);
      if (KanjiTextTest.test(gap)) {
        complete = false;
        break;
      }
      readingKana += `${kataToHira(gap)}${kataToHira(hint.reading.normalize("NFKC"))}`;
      cursor = hint.displayRange.end;
    }
    const tail = lineText.slice(cursor, entry.end);
    if (KanjiTextTest.test(tail)) complete = false;
    if (!complete) continue;
    readingKana += kataToHira(tail);
    if (!readingKana) continue;
    entry.readingKana = readingKana;
    entry.furigana = kanaReadingForToken(entry.surface, readingKana);
    entry.readingProvenance = "providerExplicit";
  }
}

type KanaReduplication = {
  start: number;
  boundaries: readonly number[];
  end: number;
};

function kanaReduplications(
  text: string,
): KanaReduplication[] {
  const result: KanaReduplication[] = [];
  const KanaRun = /[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]{4,}/gu;
  for (const match of text.matchAll(KanaRun)) {
    const run = match[0];
    const runStart = match.index;
    const characters = Array.from(run);
    const offsets = [0];
    for (const character of characters) offsets.push(offsets.at(-1)! + character.length);

    for (
      let unitLength = 2;
      unitLength <= 6 && unitLength * 2 <= characters.length;
      unitLength += 1
    ) {
      const unit = characters.slice(0, unitLength).join("");
      const second = characters.slice(unitLength, unitLength * 2).join("");
      if (unit !== second) continue;
      let repeatCount = 2;
      while (
        unitLength * (repeatCount + 1) <= characters.length &&
        characters
          .slice(unitLength * repeatCount, unitLength * (repeatCount + 1))
          .join("") === unit
      ) repeatCount += 1;
      const endIndex = unitLength * repeatCount;
      result.push({
        start: runStart,
        boundaries: Array.from(
          { length: repeatCount - 1 },
          (_, index) => runStart + offsets[unitLength * (index + 1)],
        ),
        end: runStart + offsets[endIndex],
      });
      break;
    }
  }
  return result;
}

function repetitionGroupAt(
  repetitions: readonly KanaReduplication[],
  offset: number,
): string | undefined {
  const repetition = repetitions.find((candidate) =>
    offset >= candidate.start && offset < candidate.end
  );
  if (!repetition) return undefined;
  const unitIndex = repetition.boundaries.filter((boundary) => boundary <= offset).length;
  return `kana-reduplication:${repetition.start}:${repetition.end}:${unitIndex}`;
}

function particleHasNoGrammaticalLeftContext(
  text: string,
  token: JapaneseAnalyzerToken,
): boolean {
  if (token.partOfSpeech !== "particle" || !/^[はへを]$/u.test(token.surface)) return false;
  const prefix = text.slice(0, token.start).trimEnd();
  return prefix.length === 0 || /(?:\p{Ps}|\p{Pi})$/u.test(prefix);
}

function groupContextFreeParticleKana(
  text: string,
  entries: JapaneseTokenEntry[],
  tokens: readonly JapaneseAnalyzerToken[],
): void {
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (
      entries[index].consumed ||
      entries[index + 1].consumed ||
      !particleHasNoGrammaticalLeftContext(text, token) ||
      token.end !== next.start ||
      !/^[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]/u.test(next.surface)
    ) continue;
    let endIndex = index + 1;
    while (
      endIndex + 1 < tokens.length &&
      tokens[endIndex].end === tokens[endIndex + 1].start &&
      /^[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]+$/u.test(tokens[endIndex + 1].surface)
    ) endIndex += 1;
    const groupId = `context-free-particle:${token.start}:${tokens[endIndex].end}`;
    for (let groupIndex = index; groupIndex <= endIndex; groupIndex += 1) {
      entries[groupIndex].readingGroupId = groupId;
    }
  }
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
  const kanaToRomaji = options.kanaRomanizer || romanizeJapaneseKana;
  const reduplications = kanaReduplications(analysisText);
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
  applyCompleteExplicitTokenReadings(lineText, entries, explicitHints);
  if (analyzer.id === kuromojiJapaneseAnalyzer.id) {
    await resolveJapaneseDeinflectionReadings(analysisText, tokens, entries);
    await resolveJapaneseDictionaryCoverage(analysisText, tokens, entries);
  }
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].consumed) continue;
    const literalReduplicationKana = reduplications.some((reduplication) =>
      entries[index].start < reduplication.end &&
      entries[index].end > reduplication.start
    ) &&
      /^[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]+$/u.test(entries[index].surface);
    entries[index].romaji = entryRomaji(
      entries[index],
      tokens[index],
      kanaToRomaji,
      literalReduplicationKana || particleHasNoGrammaticalLeftContext(analysisText, tokens[index]),
    );
  }
  if (reduplications.length > 0) {
    for (const entry of entries) {
      if (
        entry.consumed ||
        !/^[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]+$/u.test(entry.surface)
      ) continue;
      const internalBoundaries = reduplications.flatMap((reduplication) =>
        [...reduplication.boundaries, reduplication.end]
      ).filter((boundary) => boundary > entry.start && boundary < entry.end)
        .sort((left, right) => left - right);
      if (internalBoundaries.length > 0) {
        const boundaries = [entry.start, ...internalBoundaries, entry.end];
        entry.romaji = boundaries.slice(0, -1).map((start, boundaryIndex) =>
          kanaToRomaji(analysisText.slice(start, boundaries[boundaryIndex + 1]))
        ).join(" ");
      }
      entry.readingGroupStartId = repetitionGroupAt(reduplications, entry.start);
      entry.readingGroupEndId = repetitionGroupAt(
        reduplications,
        Math.max(entry.start, entry.end - 1),
      );
    }
  }
  groupContextFreeParticleKana(analysisText, entries, tokens);
  applyPhoneticMerges(entries, tokens, kanaToRomaji);

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
  const sourceText = text || "";
  const baseProjection =
    options.authoredReadingProjection?.sourceText === sourceText
      ? options.authoredReadingProjection
      : projectProviderAuthoredJapaneseReadings(sourceText);
  const providerHints: ProviderAuthoredReadingHint[] = (options.providerReading?.furigana ?? [])
    .flatMap((segment) => {
      const start = projectProviderSourceOffset(baseProjection, segment.start);
      const end = projectProviderSourceOffset(baseProjection, segment.end);
      return end > start
        ? [{
            sourceRange: { start: segment.start, end: segment.end },
            displayRange: { start, end },
            annotationRange: { start: segment.end, end: segment.end },
            reading: segment.reading,
          }]
        : [];
    });
  const authoredProjection = providerHints.length > 0
    ? {
        ...baseProjection,
        hints: [...baseProjection.hints, ...providerHints]
          .sort((left, right) => left.displayRange.start - right.displayRange.start),
      }
    : baseProjection;
  const displayText = projectJapaneseText(authoredProjection.displayText, options);
  const textProjection = buildTextAnalysisProjection(displayText);
  const analysisText = textProjection.analysisText;
  if (!JapaneseSourceTextTest.test(analysisText)) return undefined;
  const analysisHints = authoredProjection.hints.flatMap((hint) => {
    const displayRange = mapDisplayUtf16RangeToAnalysis(textProjection, hint.displayRange);
    return displayRange ? [{ ...hint, displayRange }] : [];
  });
  const analysisOptions: JapaneseAnalysisOptions = {
    ...options,
    textProjection: undefined,
    authoredReadingProjection: undefined,
  };

  const context = await buildJapaneseTokenContext(
    analysisText,
    analysisOptions,
    analysisHints,
  );
  const romajiProjection = buildRomajiProjectionFromContext(context);
  let analysisFurigana: FuriganaSegment[] = [];
  if (KanjiTextTest.test(analysisText)) {
    await loadJitendexFuriganaGeometry();
    analysisFurigana = buildFuriganaFromContext(analysisText, context);
  }
  const furigana = analysisFurigana.flatMap((segment) => {
    const range = mapAnalysisUtf16RangeToDisplay(textProjection, segment);
    return range ? [{ ...segment, ...range }] : [];
  });

  const reading: JapaneseReading = {
    sourceText,
    ...(displayText !== sourceText ? { displayText } : {}),
    romaji: romajiProjection.romaji,
    ...(romajiProjection.segments.length > 0
      ? { romajiSegments: romajiProjection.segments }
      : {}),
    furigana,
  };
  const analysisReading: JapaneseReading = {
    sourceText: analysisText,
    romaji: romajiProjection.romaji,
    ...(romajiProjection.segments.length > 0
      ? { romajiSegments: romajiProjection.segments }
      : {}),
    furigana: analysisFurigana,
  };
  return {
    reading,
    applyToSyllables: (syllables, spans) => {
      const analysisSpans = spans?.flatMap((span) => {
        const range = mapDisplayUtf16RangeToAnalysis(textProjection, span);
        return range
          ? [{
              ...span,
              normalizedText: analysisText.slice(range.start, range.end),
              ...range,
            }]
          : [];
      });
      if (spans && analysisSpans?.length !== spans.length) return;
      applyJapaneseReadingContextToSyllables(
        analysisReading,
        context,
        syllables,
        analysisSpans,
      );
      for (const syllable of syllables) {
        if (!syllable.JapaneseReading) continue;
        const projected = projectJapaneseReadingToSource(
          syllable.JapaneseReading,
          syllable.Text || "",
          options,
        );
        if (projected) syllable.JapaneseReading = projected;
        else delete syllable.JapaneseReading;
      }
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
  const text = target.Text || "";
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
  const sourceText = lineText || "";
  const analysis = prepared?.reading.sourceText === sourceText
    ? prepared
    : await prepareJapaneseLineAnalysis(sourceText, options);
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
