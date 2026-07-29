/**
 * Context-first Japanese readings.
 *
 * This module owns Japanese token analysis and emits plain data only. Renderers
 * decide how to display it; no ruby/HTML strings leave this file.
 */

import Kuroshiro from "kuroshiro";
import {
  applyPhoneticMerges,
  computeNoSpaceBefore,
  type MergeableEntry,
} from "../Fork/JukujikunMerge.ts";
import { cleanInvisiblesPreserveEdges } from "../Fork/TextDetection.ts";
import { normalizeChineseProviderJapaneseText } from "../ChineseCharacterConversion.ts";
import type { ReadingProvenance, RenderPlan } from "../Processing/Model.ts";
import { utf16FuriganaSegmentKey } from "../Processing/Japanese/FuriganaIdentity.ts";
import {
  projectProviderAuthoredJapaneseReadings,
  type ProviderAuthoredReadingHint,
  type ProviderAuthoredReadingProjection,
} from "../Processing/Japanese/ProviderAuthoredReading.ts";
import { needsSyllableSpaceBefore } from "../Processing/SyllableBoundaries.ts";
import {
  assertJapaneseAnalyzerTokens,
  type JapaneseAnalyzer,
  type JapaneseAnalyzerToken,
  type JapaneseKanaRomanizer,
} from "../Processing/Japanese/JapaneseAnalyzer.ts";
import {
  kuromojiJapaneseAnalyzer,
  normalizeJapaneseKana,
} from "../Processing/Japanese/KuromojiJapaneseAnalyzer.ts";
import { applyProductivePersonCounterReadings } from "../Processing/Japanese/JapaneseReadingResolver.ts";
import { lookupJitendexFuriganaGeometry } from "../Processing/Japanese/JitendexFuriganaGeometry.ts";

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
};

export type JapaneseReadable = {
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

export type JapaneseAnalysisOptions = {
  normalizeChineseProviderKanji?: boolean;
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
  lineText: string;
  spans: JapaneseTimedTextSpan[];
};

export const JapaneseSourceTextTest = /[぀-ヿ一-鿿]/;
export const JapaneseKanaTextTest = /[ぁ-んァ-ン]/;
export const KanjiTextTest = /[一-鿿々]/;
const KanjiLikeCharTest = /[一-鿿々]/;
const KanjiLikeSequenceTest = /^[一-鿿々]+$/;
const KanaCharTest = /[ぁ-んァ-ンー]/;
const KanaOnlySequenceTest = /^[ぁ-んァ-ンー・]+$/u;
const LatinWordTextTest = /[A-Za-zÀ-ÖØ-öø-ÿĀ-žƀ-ɏ]/;

type TokenFuriganaReading = {
  text: string;
  targetStart: number;
  targetEnd: number;
};

type JapaneseTokenEntry = MergeableEntry & {
  start: number;
  end: number;
  surface: string;
  readingKana: string;
  furigana?: TokenFuriganaReading;
  readingProvenance?: ReadingProvenance;
};

type JapaneseTokenContext = {
  analyzer: JapaneseAnalyzer;
  tokens: readonly JapaneseAnalyzerToken[];
  entries: JapaneseTokenEntry[];
  noSpaceBefore: boolean[];
  explicitReadings: FuriganaSegment[];
  kanaToRomaji: JapaneseKanaRomanizer;
};

/**
 * One processing-local Japanese analysis. The token context stays private to
 * this module, while callers may project the same result onto more than one
 * equivalent span layout without asking Kuromoji to parse the line again.
 */
export type PreparedJapaneseLineAnalysis = {
  readonly reading: JapaneseReading;
  applyToSyllables(syllables: JapaneseReadable[], spans?: JapaneseTimedTextSpan[]): void;
};

function normalizeJapaneseTimedText(text: string): string {
  return cleanInvisiblesPreserveEdges((text || "").normalize("NFKC"));
}

function appendLineSpaceIfNeeded(lineText: string): string {
  return lineText && !/\s$/.test(lineText) ? `${lineText} ` : lineText;
}

export function buildJapaneseLineTextMap(syllables: JapaneseReadable[]): JapaneseLineTextMap {
  let lineText = "";
  const spans: JapaneseTimedTextSpan[] = [];

  for (let index = 0; index < syllables.length; index += 1) {
    const rawText = syllables[index]?.Text || "";
    const normalizedRaw = normalizeJapaneseTimedText(rawText);
    const normalizedText = normalizedRaw.trim();
    if (!normalizedRaw && !normalizedText) continue;

    const leading = normalizedRaw.match(/^\s+/)?.[0] || "";
    const trailing = normalizedRaw.match(/\s+$/)?.[0] || "";
    if (leading) lineText = appendLineSpaceIfNeeded(lineText);

    const previousRaw = syllables[index - 1]?.Text || "";
    const nextNeedsLatinSpace =
      !leading &&
      lineText &&
      needsSyllableSpaceBefore(syllables, index) &&
      (LatinWordTextTest.test(previousRaw) || LatinWordTextTest.test(normalizedText));
    if (nextNeedsLatinSpace) lineText = appendLineSpaceIfNeeded(lineText);

    const start = lineText.length;
    lineText += normalizedText;
    const end = lineText.length;
    if (normalizedText) {
      spans.push({ index, rawText, normalizedText, start, end });
    }

    if (trailing) lineText = appendLineSpaceIfNeeded(lineText);
  }

  return { lineText: lineText.replace(/\s+$/g, ""), spans };
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function kataToHira(text: string): string {
  return normalizeJapaneseKana(text);
}

export function resolveJapaneseTokenKanaReading(surface: string, reading: string): string {
  const candidate =
    reading && reading !== "*" ? reading : KanaOnlySequenceTest.test(surface) ? surface : "";
  return kataToHira(candidate);
}

export function okuriganaAnchoredKanjiRunReading(
  kana: string,
  kanaCursor: number,
  trailingOkurigana: string
): string {
  const normalizedKana = kataToHira(kana);
  const normalizedOkurigana = kataToHira(trailingOkurigana);
  if (!normalizedKana || !normalizedOkurigana) return "";

  const safeCursor = Math.max(0, Math.min(kanaCursor, normalizedKana.length));
  const remaining = normalizedKana.slice(safeCursor);
  if (remaining.endsWith(normalizedOkurigana)) {
    return normalizedKana.slice(safeCursor, normalizedKana.length - normalizedOkurigana.length);
  }

  const fallback = normalizedKana.lastIndexOf(
    normalizedOkurigana,
    normalizedKana.length - normalizedOkurigana.length
  );
  return fallback >= safeCursor
    ? normalizedKana.slice(safeCursor, fallback)
    : normalizedKana.slice(safeCursor);
}

function multiRunKanaReadingSegments(
  chars: readonly string[],
  utf16Offsets: readonly number[],
  kana: string
): TokenFuriganaReading[] | undefined {
  type SurfacePart =
    | { kind: "kanji"; start: number; end: number }
    | { kind: "kana"; text: string };

  const parts: SurfacePart[] = [];
  for (let index = 0; index < chars.length; ) {
    const start = index;
    const kind = KanjiLikeCharTest.test(chars[index])
      ? "kanji"
      : KanaCharTest.test(chars[index])
        ? "kana"
        : undefined;
    if (!kind) return undefined;

    while (
      index < chars.length &&
      (kind === "kanji"
        ? KanjiLikeCharTest.test(chars[index])
        : KanaCharTest.test(chars[index]))
    ) {
      index += 1;
    }

    parts.push(
      kind === "kanji"
        ? { kind, start, end: index }
        : { kind, text: chars.slice(start, index).join("") }
    );
  }

  const memo = new Map<string, TokenFuriganaReading[] | null>();
  const align = (
    partIndex: number,
    readingCursor: number
  ): TokenFuriganaReading[] | undefined => {
    const memoKey = `${partIndex}:${readingCursor}`;
    if (memo.has(memoKey)) return memo.get(memoKey) || undefined;

    if (partIndex >= parts.length) {
      const result = readingCursor === kana.length ? [] : undefined;
      memo.set(memoKey, result || null);
      return result;
    }

    const part = parts[partIndex];
    if (part.kind === "kana") {
      const result = kana.startsWith(part.text, readingCursor)
        ? align(partIndex + 1, readingCursor + part.text.length)
        : undefined;
      memo.set(memoKey, result || null);
      return result;
    }

    const next = parts[partIndex + 1];
    if (!next) {
      const text = kana.slice(readingCursor);
      const result = text
        ? [
            {
              text,
              targetStart: utf16Offsets[part.start],
              targetEnd: utf16Offsets[part.end],
            },
          ]
        : undefined;
      memo.set(memoKey, result || null);
      return result;
    }
    if (next.kind !== "kana") {
      memo.set(memoKey, null);
      return undefined;
    }

    // Try Kana anchors from left to right, but accept one only when every
    // remaining anchor can still be aligned. This prevents a final repeated
    // anchor from swallowing earlier runs, as in 離れ離れ[はなればなれ].
    let anchorStart = kana.indexOf(next.text, readingCursor + 1);
    while (anchorStart >= 0) {
      const remaining = align(partIndex + 2, anchorStart + next.text.length);
      if (remaining) {
        const result = [
          {
            text: kana.slice(readingCursor, anchorStart),
            targetStart: utf16Offsets[part.start],
            targetEnd: utf16Offsets[part.end],
          },
          ...remaining,
        ];
        memo.set(memoKey, result);
        return result;
      }
      anchorStart = kana.indexOf(next.text, anchorStart + 1);
    }

    memo.set(memoKey, null);
    return undefined;
  };

  return align(0, 0);
}

function kanaReadingSegments(surface: string, reading: string): TokenFuriganaReading[] {
  const kana = resolveJapaneseTokenKanaReading(surface, reading);
  if (!kana || kana === "*") return [];

  const normalizedSurface = kataToHira(surface);
  const chars = Array.from(normalizedSurface);
  // targetStart/targetEnd are added to entry.start (a UTF-16 index from
  // String.prototype.indexOf), so they must be UTF-16 offsets, not code
  // points — otherwise furigana drifts on non-BMP kanji (e.g. 𠮷).
  const utf16Offsets: number[] = [];
  {
    let offset = 0;
    for (const char of chars) {
      utf16Offsets.push(offset);
      offset += char.length;
    }
    utf16Offsets.push(offset);
  }

  if (normalizedSurface.includes("々") && KanjiLikeSequenceTest.test(normalizedSurface)) {
    return [{ text: kana, targetStart: 0, targetEnd: normalizedSurface.length }];
  }

  if (KanjiLikeSequenceTest.test(normalizedSurface) && chars.length > 1) {
    return [{ text: kana, targetStart: 0, targetEnd: normalizedSurface.length }];
  }

  const kanjiRunCount = chars.reduce(
    (count, char, index) =>
      KanjiLikeCharTest.test(char) && !KanjiLikeCharTest.test(chars[index - 1] || "")
        ? count + 1
        : count,
    0
  );
  if (kanjiRunCount > 1) {
    // Multi-run words need all Kana anchors to agree. If they do not, return
    // no detailed split so the caller uses its conservative whole-token ruby.
    return multiRunKanaReadingSegments(chars, utf16Offsets, kana) || [];
  }

  const segments: TokenFuriganaReading[] = [];
  let kanaCursor = 0;
  let charIndex = 0;
  let coveredRunCount = 0;

  while (charIndex < chars.length) {
    const char = chars[charIndex];

    if (KanaCharTest.test(char)) {
      if (kana[kanaCursor] === char) kanaCursor += 1;
      charIndex += 1;
      continue;
    }

    if (!KanjiLikeCharTest.test(char)) {
      charIndex += 1;
      continue;
    }

    const start = charIndex;
    while (charIndex < chars.length && KanjiLikeCharTest.test(chars[charIndex])) charIndex += 1;
    const end = charIndex;
    const followingKana: string[] = [];
    for (let i = charIndex; i < chars.length && KanaCharTest.test(chars[i]); i += 1) {
      followingKana.push(chars[i]);
    }
    const readingStart = kanaCursor;

    if (followingKana.length > 0) {
      const text = okuriganaAnchoredKanjiRunReading(kana, kanaCursor, followingKana.join(""));
      kanaCursor = Math.min(kana.length, kanaCursor + text.length);
    } else {
      kanaCursor = kana.length;
    }

    const text = kana.slice(readingStart, kanaCursor);
    if (!text) continue;

    coveredRunCount += 1;
    segments.push({ text, targetStart: utf16Offsets[start], targetEnd: utf16Offsets[end] });
  }

  // When a token has several separate kanji runs but only some of them
  // received a reading, the per-run split is unreliable (e.g. 手伝う dumps the
  // whole reading onto 手). Bail out so the caller falls back to one
  // whole-token ruby segment, which is how publishers typeset such words.
  if (kanjiRunCount > 1 && coveredRunCount < kanjiRunCount) return [];

  return segments;
}

function kanaReadingForToken(surface: string, reading: string): TokenFuriganaReading | undefined {
  let kana = resolveJapaneseTokenKanaReading(surface, reading);
  if (!kana || kana === "*") return undefined;

  let normalizedSurface = kataToHira(surface);
  let targetStart = 0;
  let targetEnd = normalizedSurface.length;

  while (normalizedSurface.length > 0 && kana.length > 0) {
    const last = normalizedSurface[normalizedSurface.length - 1];
    if (!/[ぁ-んー]/.test(last) || !kana.endsWith(last)) break;
    normalizedSurface = normalizedSurface.slice(0, -1);
    kana = kana.slice(0, -1);
    targetEnd -= 1;
  }

  while (normalizedSurface.length > 0 && kana.length > 0) {
    const first = normalizedSurface[0];
    if (!/[ぁ-んー]/.test(first) || !kana.startsWith(first)) break;
    normalizedSurface = normalizedSurface.slice(1);
    kana = kana.slice(1);
    targetStart += 1;
  }

  return KanjiLikeCharTest.test(normalizedSurface) && kana
    ? { text: kana, targetStart, targetEnd }
    : undefined;
}

function entryRomaji(
  entry: JapaneseTokenEntry,
  token: JapaneseAnalyzerToken,
  kanaToRomaji: JapaneseKanaRomanizer
): string {
  if (token.partOfSpeech === "particle") {
    if (entry.surface === "は") return "wa";
    if (entry.surface === "へ") return "e";
    if (entry.surface === "を") return "wo";
  }
  if (!entry.readingKana) return entry.surface;
  const romaji = kanaToRomaji(entry.readingKana);
  return romaji || entry.surface;
}

function furiganaSegmentAt(
  furigana: FuriganaSegment[],
  index: number
): FuriganaSegment | undefined {
  return furigana.find(
    (segment) => segment.end > segment.start && index >= segment.start && index < segment.end
  );
}

function readingFromProviderFurigana(
  sourceText: string,
  start: number,
  end: number,
  furigana: FuriganaSegment[]
): string | undefined {
  let reading = "";
  let usedProvider = false;
  let pos = start;
  while (pos < end) {
    const char = sourceText[pos];
    const segment = furiganaSegmentAt(furigana, pos);
    if (KanjiLikeCharTest.test(char) && segment && segment.start <= pos && segment.end > pos) {
      if (pos === segment.start) {
        reading += kataToHira(segment.reading);
        usedProvider = true;
      }
      pos = Math.min(end, segment.end);
      continue;
    }
    if (/[ぁ-んァ-ンー]/.test(char)) reading += kataToHira(char);
    pos += 1;
  }
  return usedProvider ? reading : undefined;
}

function applyProviderFuriganaOverrides(
  sourceText: string,
  entries: JapaneseTokenEntry[],
  furigana: FuriganaSegment[]
): void {
  const sorted = [...furigana].sort((a, b) => a.start - b.start);
  for (const entry of entries) {
    const reading = readingFromProviderFurigana(sourceText, entry.start, entry.end, sorted);
    if (reading) entry.readingKana = reading;
  }
}

function applyExplicitReadingOverrides(
  lineText: string,
  entries: JapaneseTokenEntry[],
  hints: readonly ProviderAuthoredReadingHint[]
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
          rangesOverlap(entry.start, entry.end, hint.displayRange.start, hint.displayRange.end)
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
  _fullSpacedRomaji?: string,
  options: JapaneseAnalysisOptions = {},
  explicitHints: readonly ProviderAuthoredReadingHint[] = []
): Promise<JapaneseTokenContext> {
  const analysisText = options.normalizeChineseProviderKanji
    ? normalizeChineseProviderJapaneseText(lineText)
    : lineText;
  const analyzer = options.analyzer || kuromojiJapaneseAnalyzer;
  const tokens = [...(await analyzer.analyze(analysisText))];
  assertJapaneseAnalyzerTokens(analysisText, tokens);
  const kanaToRomaji =
    options.kanaRomanizer || ((kana: string) => (Kuroshiro as any).Util.kanaToRomaji(kana));
  const entries: JapaneseTokenEntry[] = [];

  for (let ti = 0; ti < tokens.length; ti += 1) {
    const token = tokens[ti];
    const surface = token.surface;
    const hasJapaneseScript = JapaneseSourceTextTest.test(surface);
    const readingKana = hasJapaneseScript ? token.readingKana : "";
    const entry: JapaneseTokenEntry = {
      start: token.start,
      end: token.end,
      romaji: surface,
      surface,
      readingKana,
      furigana: hasJapaneseScript ? kanaReadingForToken(surface, readingKana) : undefined,
      consumed: false,
    };
    entry.romaji = entryRomaji(entry, token, kanaToRomaji);
    entries.push(entry);
  }

  analyzer.applyReadingOverrides?.(entries, tokens);
  applyProductivePersonCounterReadings(analysisText, tokens, entries);
  const explicitReadings = applyExplicitReadingOverrides(lineText, entries, explicitHints);
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].consumed) continue;
    entries[index].romaji = entryRomaji(entries[index], tokens[index], kanaToRomaji);
  }
  applyPhoneticMerges(entries, tokens);

  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].consumed) continue;
    for (let j = i + 1; j < entries.length && entries[j].consumed; j += 1) {
      entries[i].end = entries[j].end;
      if (!entries[i].furigana && entries[j].furigana) entries[i].furigana = entries[j].furigana;
    }
  }

  return {
    analyzer,
    tokens,
    entries,
    noSpaceBefore: computeNoSpaceBefore(entries, tokens),
    explicitReadings,
    kanaToRomaji,
  };
}

export async function romanizeJapaneseFromFurigana(
  text: string,
  furigana: FuriganaSegment[],
  romajiPromise?: Promise<void>,
  options: JapaneseAnalysisOptions = {}
): Promise<string | undefined> {
  const sourceText = (text || "").normalize("NFKC");
  if (!JapaneseSourceTextTest.test(sourceText) || furigana.length === 0) return undefined;

  await romajiPromise;
  const context = await buildJapaneseTokenContext(sourceText, undefined, options);
  const kanaToRomaji =
    options.kanaRomanizer || ((kana: string) => (Kuroshiro as any).Util.kanaToRomaji(kana));
  applyProviderFuriganaOverrides(sourceText, context.entries, furigana);
  context.analyzer.applyReadingOverrides?.(context.entries, context.tokens);
  for (let i = 0; i < context.entries.length; i += 1) {
    context.entries[i].romaji = entryRomaji(context.entries[i], context.tokens[i], kanaToRomaji);
  }
  applyPhoneticMerges(context.entries, context.tokens);
  return buildRomajiFromContext(context);
}

function buildRomajiProjectionFromContext(context: JapaneseTokenContext): {
  romaji?: string;
  segments: JapaneseRomajiSegment[];
} {
  const segments: JapaneseRomajiSegment[] = [];
  for (let i = 0; i < context.entries.length; i += 1) {
    const entry = context.entries[i];
    if (entry.consumed || !entry.romaji) continue;
    const prefix = segments.length > 0 && !context.noSpaceBefore[i] ? " " : "";
    segments.push({
      text: `${prefix}${entry.romaji}`,
      ...(entry.readingProvenance ? { provenance: entry.readingProvenance } : {}),
    });
  }
  const normalizedSegments: JapaneseRomajiSegment[] = [];
  for (const segment of segments) {
    let text = segment.text.replace(/\s+/gu, " ");
    if (normalizedSegments.length === 0) text = text.trimStart();
    else if (normalizedSegments.at(-1)?.text.endsWith(" ")) text = text.trimStart();
    if (text) normalizedSegments.push({ ...segment, text });
  }
  while (normalizedSegments.length > 0) {
    const last = normalizedSegments.at(-1)!;
    const text = last.text.trimEnd();
    if (text) {
      normalizedSegments[normalizedSegments.length - 1] = { ...last, text };
      break;
    }
    normalizedSegments.pop();
  }
  const romaji = normalizedSegments.map((segment) => segment.text).join("");
  return { romaji: romaji || undefined, segments: normalizedSegments };
}

function buildRomajiFromContext(context: JapaneseTokenContext): string | undefined {
  return buildRomajiProjectionFromContext(context).romaji;
}

function buildFuriganaFromContext(
  lineText: string,
  context: JapaneseTokenContext
): FuriganaSegment[] {
  const segments: FuriganaSegment[] = [];
  const seen = new Set<string>();

  for (const entry of context.entries) {
    if (entry.consumed) continue;
    const provenGeometry =
      entry.readingProvenance === "providerExplicit"
        ? undefined
        : lookupJitendexFuriganaGeometry(entry.surface, entry.readingKana);
    const tokenSegments = provenGeometry
      ? provenGeometry.map((segment) => ({
          text: segment.reading,
          targetStart: segment.start,
          targetEnd: segment.end,
        }))
      : kanaReadingSegments(entry.surface, entry.readingKana);
    const fallbackSegments =
      tokenSegments.length > 0 ? tokenSegments : entry.furigana ? [entry.furigana] : [];

    for (const segment of fallbackSegments) {
      const start = Math.max(0, Math.min(lineText.length, entry.start + segment.targetStart));
      const end = Math.max(start + 1, Math.min(lineText.length, entry.start + segment.targetEnd));
      const key = `${start}:${end}:${segment.text}`;
      if (!segment.text || seen.has(key)) continue;
      seen.add(key);
      segments.push({ start, end, reading: segment.text });
    }
  }

  const local = segments.filter(
    (segment) =>
      !context.explicitReadings.some((explicit) =>
        rangesOverlap(segment.start, segment.end, explicit.start, explicit.end)
      )
  );
  return [...local, ...context.explicitReadings].sort((a, b) => a.start - b.start || a.end - b.end);
}

export async function prepareJapaneseLineAnalysis(
  text: string,
  fullSpacedRomaji?: string,
  romajiPromise?: Promise<void>,
  options: JapaneseAnalysisOptions = {}
): Promise<PreparedJapaneseLineAnalysis | undefined> {
  const sourceText = (text || "").normalize("NFKC");
  if (!JapaneseSourceTextTest.test(sourceText)) return undefined;
  const projection =
    options.authoredReadingProjection?.sourceText === sourceText
      ? options.authoredReadingProjection
      : projectProviderAuthoredJapaneseReadings(sourceText);
  const displayText = options.normalizeChineseProviderKanji
    ? normalizeChineseProviderJapaneseText(projection.displayText)
    : projection.displayText;

  await romajiPromise;
  const context = await buildJapaneseTokenContext(
    displayText,
    fullSpacedRomaji,
    options,
    projection.hints
  );
  const romajiProjection = buildRomajiProjectionFromContext(context);
  const romaji = romajiProjection.romaji || fullSpacedRomaji;
  const furigana = KanjiTextTest.test(displayText)
    ? buildFuriganaFromContext(displayText, context)
    : [];

  const reading: JapaneseReading = {
    sourceText,
    ...(displayText !== sourceText ? { displayText } : {}),
    romaji,
    ...(romajiProjection.segments.length > 0 ? { romajiSegments: romajiProjection.segments } : {}),
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
  fullSpacedRomaji?: string,
  romajiPromise?: Promise<void>,
  options: JapaneseAnalysisOptions = {}
): Promise<JapaneseReading | undefined> {
  return (await prepareJapaneseLineAnalysis(text, fullSpacedRomaji, romajiPromise, options))
    ?.reading;
}

export function assignJapaneseReading(
  target: JapaneseReadable,
  reading: JapaneseReading | undefined
): void {
  if (reading && (reading.romaji || reading.furigana.length > 0)) {
    target.JapaneseReading = reading;
  } else {
    delete target.JapaneseReading;
  }
}

export async function annotateJapaneseTextTarget(
  target: JapaneseReadable,
  fullSpacedRomaji?: string,
  romajiPromise?: Promise<void>,
  options: JapaneseAnalysisOptions = {}
): Promise<JapaneseReading | undefined> {
  const text = target.Text?.normalize("NFKC") || "";
  if (target.Text) target.Text = text;
  const reading = await analyzeJapaneseLine(text, fullSpacedRomaji, romajiPromise, options);
  assignJapaneseReading(target, reading);
  return reading;
}

export async function applyJapaneseReadingToSyllables(
  lineText: string,
  fullSpacedRomaji: string | undefined,
  syllables: JapaneseReadable[],
  romajiPromise?: Promise<void>,
  spans?: JapaneseTimedTextSpan[],
  options: JapaneseAnalysisOptions = {},
  prepared?: PreparedJapaneseLineAnalysis
): Promise<JapaneseReading | undefined> {
  const normalizedLineText = (lineText || "").normalize("NFKC");
  const authoredDisplayText =
    options.authoredReadingProjection?.sourceText === normalizedLineText
      ? options.authoredReadingProjection.displayText
      : projectProviderAuthoredJapaneseReadings(normalizedLineText).displayText;
  const expectedDisplayText = options.normalizeChineseProviderKanji
    ? normalizeChineseProviderJapaneseText(authoredDisplayText)
    : authoredDisplayText;
  const analysis =
    (prepared?.reading.displayText || prepared?.reading.sourceText) === expectedDisplayText
      ? prepared
      : await prepareJapaneseLineAnalysis(
          normalizedLineText,
          fullSpacedRomaji,
          romajiPromise,
          options
        );
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

type ProjectedEntryPart = {
  entryIndex: number;
  logicalGroupIndex: number;
  text: string;
  animationSpanIndexes: number[];
};

function normalizedRomajiComparison(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}

/**
 * Projects a token reading onto provider timing spans only when its furigana
 * geometry and literal Kana prove an exact split. The final romaji equality
 * check rejects context-sensitive boundaries such as a standalone small っ.
 */
function projectEntryRomajiChunks(
  reading: JapaneseReading,
  context: JapaneseTokenContext,
  entry: JapaneseTokenEntry,
  overlappingSpans: readonly JapaneseTimedTextSpan[]
): string[] | undefined {
  if (
    overlappingSpans.length < 2 ||
    entry.surface.length !== entry.end - entry.start
  ) {
    return undefined;
  }

  type ReadingPiece = { start: number; end: number; text: string };
  const pieces: ReadingPiece[] = [];
  const furigana = reading.furigana
    .filter((segment) => rangesOverlap(entry.start, entry.end, segment.start, segment.end))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let previousFuriganaEnd = entry.start;
  for (const segment of furigana) {
    if (
      segment.start < entry.start ||
      segment.end > entry.end ||
      segment.start < previousFuriganaEnd
    ) {
      return undefined;
    }
    pieces.push({
      start: segment.start,
      end: segment.end,
      text: kataToHira(segment.reading),
    });
    previousFuriganaEnd = segment.end;
  }

  let offset = 0;
  for (const character of Array.from(entry.surface)) {
    const start = entry.start + offset;
    const end = start + character.length;
    offset += character.length;
    if (pieces.some((piece) => rangesOverlap(piece.start, piece.end, start, end))) continue;
    if (KanjiLikeCharTest.test(character)) return undefined;
    pieces.push({
      start,
      end,
      text: KanaCharTest.test(character) ? kataToHira(character) : character,
    });
  }

  pieces.sort((a, b) => a.start - b.start || a.end - b.end);
  const kanaChunks = overlappingSpans.map(() => "");
  for (const piece of pieces) {
    const owners = overlappingSpans
      .map((span, index) => ({ span, index }))
      .filter(({ span }) => rangesOverlap(piece.start, piece.end, span.start, span.end));
    if (owners.length !== 1) return undefined;
    kanaChunks[owners[0].index] += piece.text;
  }

  const romajiChunks = kanaChunks.map((chunk) =>
    chunk ? context.kanaToRomaji(chunk) : ""
  );
  if (
    !romajiChunks.every((chunk) => typeof chunk === "string") ||
    normalizedRomajiComparison(romajiChunks.join("")) !==
      normalizedRomajiComparison(entry.romaji)
  ) {
    return undefined;
  }
  return romajiChunks;
}

function buildEntryRomajiProjection(
  reading: JapaneseReading,
  context: JapaneseTokenContext,
  effectiveSpans: readonly JapaneseTimedTextSpan[]
): Map<number, ProjectedEntryPart[]> {
  type PendingEntryProjection = {
    entryIndex: number;
    logicalGroupIndex: number;
    spans: JapaneseTimedTextSpan[];
    split?: string[];
    needsOpaqueFallback: boolean;
  };

  const bySpan = new Map<number, ProjectedEntryPart[]>();
  const append = (spanIndex: number, part: ProjectedEntryPart) => {
    const parts = bySpan.get(spanIndex) || [];
    parts.push(part);
    bySpan.set(spanIndex, parts);
  };
  const pending: PendingEntryProjection[] = [];
  let previousActiveEntryIndex = -1;
  let logicalGroupIndex = -1;

  for (let entryIndex = 0; entryIndex < context.entries.length; entryIndex += 1) {
    const entry = context.entries[entryIndex];
    if (entry.consumed || !entry.romaji) continue;
    if (
      previousActiveEntryIndex < 0 ||
      !context.noSpaceBefore[entryIndex]
    ) {
      logicalGroupIndex = entryIndex;
    }
    previousActiveEntryIndex = entryIndex;

    const overlappingSpans = effectiveSpans
      .filter((span) => rangesOverlap(entry.start, entry.end, span.start, span.end))
      .sort((a, b) => a.start - b.start || a.index - b.index);
    if (overlappingSpans.length === 0) continue;

    const split =
      overlappingSpans.length > 1
        ? projectEntryRomajiChunks(reading, context, entry, overlappingSpans)
        : [entry.romaji];
    pending.push({
      entryIndex,
      logicalGroupIndex,
      spans: overlappingSpans,
      split,
      needsOpaqueFallback: overlappingSpans.length > 1 && !split,
    });
  }

  const grouped = new Map<number, PendingEntryProjection[]>();
  for (const projection of pending) {
    const group = grouped.get(projection.logicalGroupIndex) || [];
    group.push(projection);
    grouped.set(projection.logicalGroupIndex, group);
  }

  for (const [groupIndex, group] of grouped) {
    if (group.some((projection) => projection.needsOpaqueFallback)) {
      const groupSpans = [...new Map(
        group
          .flatMap((projection) => projection.spans)
          .map((span) => [span.index, span]),
      ).values()].sort((a, b) => a.start - b.start || a.index - b.index);
      const groupText = group
        .map((projection) => context.entries[projection.entryIndex].romaji)
        .join("");
      const groupSpanIndexes = groupSpans.map((span) => span.index);
      for (let index = 0; index < groupSpans.length; index += 1) {
        append(groupSpans[index].index, {
          entryIndex: group[0].entryIndex,
          logicalGroupIndex: groupIndex,
          text: index === 0 ? groupText : "",
          animationSpanIndexes:
            index === 0 ? groupSpanIndexes : [groupSpans[index].index],
        });
      }
      continue;
    }

    for (const projection of group) {
      for (let index = 0; index < projection.spans.length; index += 1) {
        append(projection.spans[index].index, {
          entryIndex: projection.entryIndex,
          logicalGroupIndex: groupIndex,
          text: projection.split![index],
          animationSpanIndexes: [projection.spans[index].index],
        });
      }
    }
  }

  return bySpan;
}

function applyJapaneseReadingContextToSyllables(
  reading: JapaneseReading,
  context: JapaneseTokenContext,
  syllables: JapaneseReadable[],
  spans?: JapaneseTimedTextSpan[]
): void {
  const analysisText = reading.displayText || reading.sourceText;
  let syllPos = 0;
  let prevLastIdx = -1;
  const effectiveSpans =
    spans && spans.length > 0
      ? spans
      : syllables.map((syllable, index) => {
          const text = normalizeJapaneseTimedText(syllable.Text || "").trim();
          while (syllPos < analysisText.length && /\s/.test(analysisText[syllPos])) syllPos += 1;
          const start = syllPos;
          const end = start + text.length;
          syllPos = end;
          return { index, rawText: syllable.Text || "", normalizedText: text, start, end };
        });
  const projectedEntries = buildEntryRomajiProjection(reading, context, effectiveSpans);
  const assignedFuriganaKeys = new Set<string>();

  for (let si = 0; si < syllables.length; si += 1) {
    const syllable = syllables[si];
    const text = normalizeJapaneseTimedText(syllable.Text || "").trim();
    const span = effectiveSpans.find((candidate) => candidate.index === si);
    const syllStart = span?.start ?? 0;
    const syllEnd = span?.end ?? syllStart;

    delete syllable.JapaneseReading;
    delete syllable.RomanizedText;
    delete syllable.TransliteratedText;
    delete syllable.RomajiSpaceBefore;
    delete syllable.JapaneseRomajiTiming;

    const romajiParts: string[] = [];
    let firstIdx = -1;
    let lastIdx = -1;
    const entryParts = (projectedEntries.get(si) || [])
      .sort((a, b) => a.entryIndex - b.entryIndex);

    for (const part of entryParts) {
      if (!part.text) continue;
      if (romajiParts.length > 0 && !context.noSpaceBefore[part.entryIndex]) {
        romajiParts.push(" ");
      }
      romajiParts.push(part.text);
      if (firstIdx === -1) firstIdx = part.entryIndex;
      lastIdx = part.entryIndex;
    }

    const hasSourceSpaceBefore = syllStart > 0 && /\s/.test(analysisText[syllStart - 1] || "");
    if (
      si > 0 &&
      firstIdx !== -1 &&
      (hasSourceSpaceBefore || (firstIdx !== prevLastIdx && !context.noSpaceBefore[firstIdx]))
    ) {
      syllable.RomajiSpaceBefore = true;
    }
    if (lastIdx !== -1) prevLastIdx = lastIdx;

    const syllableRomaji = romajiParts.length > 0 ? romajiParts.join("") : undefined;
    const syllableRomajiSegments: JapaneseRomajiSegment[] = [];
    for (const part of entryParts) {
      if (!part.text) continue;
      const entry = context.entries[part.entryIndex];
      const prefix =
        syllableRomajiSegments.length > 0 && !context.noSpaceBefore[part.entryIndex]
          ? " "
          : "";
      syllableRomajiSegments.push({
        text: `${prefix}${part.text}`,
        ...(entry.readingProvenance ? { provenance: entry.readingProvenance } : {}),
      });
    }
    if (syllableRomaji) {
      syllable.RomanizedText = syllableRomaji;
      syllable.TransliteratedText = syllableRomaji;
    }
    if (entryParts.length > 0) {
      const logicalGroupIndexes = [
        ...new Set(entryParts.map((part) => part.logicalGroupIndex)),
      ];
      const animationSpanIndexes = [
        ...new Set(entryParts.flatMap((part) => part.animationSpanIndexes)),
      ];
      syllable.JapaneseRomajiTiming = {
        logicalGroupId:
          logicalGroupIndexes.length === 1
            ? `jp-token-${logicalGroupIndexes[0]}`
            : `jp-span-${si}`,
        animationSpanIndexes,
      };
    }

    const localFurigana = reading.furigana
      .map((segment) => ({
        segment,
        lineSegmentKey: utf16FuriganaSegmentKey(
          analysisText,
          segment.start,
          segment.end,
          segment.reading
        ),
      }))
      .filter(({ segment }) => {
        const key = `${segment.start}:${segment.end}:${segment.reading}`;
        if (assignedFuriganaKeys.has(key)) return false;
        if (!rangesOverlap(segment.start, segment.end, syllStart, syllEnd)) return false;
        assignedFuriganaKeys.add(key);
        return true;
      })
      .map(({ segment, lineSegmentKey }) => ({
        start: Math.max(0, segment.start - syllStart),
        end: Math.max(
          Math.min(syllEnd, segment.end) - syllStart,
          Math.max(0, segment.start - syllStart) + 1
        ),
        reading: segment.reading,
        lineSegmentKey,
        ...(segment.provenance ? { provenance: segment.provenance } : {}),
      }));

    const syllableDisplayText = span ? analysisText.slice(span.start, span.end) : text;
    if (localFurigana.length > 0 || syllableRomaji || syllableDisplayText !== text) {
      syllable.JapaneseReading = {
        sourceText: text,
        ...(syllableDisplayText !== text ? { displayText: syllableDisplayText } : {}),
        romaji: syllableRomaji,
        ...(syllableRomajiSegments.length > 0 ? { romajiSegments: syllableRomajiSegments } : {}),
        furigana: localFurigana,
      };
    }
  }
}
