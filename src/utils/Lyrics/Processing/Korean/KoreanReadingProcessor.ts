import {
  buildKoreanLineTextFromSyllables,
  normalizeKoreanDisplaySource,
  romanizeKoreanDisplayPieces,
  romanizeKoreanForDisplay,
  type KoreanDisplayMode,
  type KoreanSyllableLike,
} from "../../Fork/Romanization.ts";
import { cleanInvisibles } from "../../Fork/TextDetection.ts";
import type {
  NormalizedBoundary,
  NormalizedLine,
  NormalizedSpanRef,
  ReadingGroup,
  ReadingPlan,
  SpanReading,
  TextRange,
} from "../Model.ts";

function normalizeSpanText(text: string): string {
  return cleanInvisibles((text || "").normalize("NFKC")).replace(/\s+/g, " ");
}

function findCodePointSequence(source: string[], target: string[], from: number): number {
  if (target.length === 0 || target.length > source.length) return -1;
  for (let start = Math.max(0, from); start <= source.length - target.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < target.length; offset += 1) {
      if (source[start + offset] !== target[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return start;
  }
  return -1;
}

function rangesOverlap(left: TextRange, right: TextRange): boolean {
  return left.startCp < right.endCp && right.startCp < left.endCp;
}

export function buildKoreanNormalizedLine(syllables: KoreanSyllableLike[]): NormalizedLine {
  const normalizedSyllables = syllables.map((syllable) => ({
    Text: normalizeSpanText(syllable?.Text || ""),
    IsPartOfWord: syllable?.IsPartOfWord,
  }));
  const text = normalizeKoreanDisplaySource(buildKoreanLineTextFromSyllables(normalizedSyllables));
  const sourceCodePoints = Array.from(text);
  const spans: NormalizedSpanRef[] = [];
  let searchFrom = 0;

  normalizedSyllables.forEach((syllable, spanId) => {
    const spanCodePoints = Array.from((syllable.Text || "").trim());
    if (spanCodePoints.length === 0) return;

    let startCp = findCodePointSequence(sourceCodePoints, spanCodePoints, searchFrom);
    if (startCp < 0) startCp = findCodePointSequence(sourceCodePoints, spanCodePoints, 0);
    if (startCp < 0) return;

    const endCp = startCp + spanCodePoints.length;
    spans.push({ spanId, source: { startCp, endCp } });
    searchFrom = endCp;
  });

  const boundaries: NormalizedBoundary[] = [];
  sourceCodePoints.forEach((char, offsetCp) => {
    if (/\s/.test(char)) boundaries.push({ offsetCp, kind: "whitespace" });
  });

  return { text, spans, boundaries };
}

function readingForRange(pieces: string[], range: TextRange): string {
  return pieces.slice(range.startCp, range.endCp).join("");
}

function hasSpaceBefore(sourceCodePoints: string[], startCp: number): boolean {
  return startCp > 0 && /\s/.test(sourceCodePoints[startCp - 1] || "");
}

function buildReadingGroups(
  normalized: NormalizedLine,
  pieces: string[]
): ReadingGroup[] {
  const sourceCodePoints = Array.from(normalized.text);
  const groups: ReadingGroup[] = [];
  let cursor = 0;

  while (cursor < sourceCodePoints.length) {
    while (cursor < sourceCodePoints.length && /\s/.test(sourceCodePoints[cursor])) cursor += 1;
    if (cursor >= sourceCodePoints.length) break;

    const startCp = cursor;
    while (cursor < sourceCodePoints.length && !/\s/.test(sourceCodePoints[cursor])) cursor += 1;
    const source = { startCp, endCp: cursor };
    const spanIds = normalized.spans
      .filter((span) => rangesOverlap(span.source, source))
      .map((span) => span.spanId);

    groups.push({
      source,
      spanIds,
      text: readingForRange(pieces, source),
      spaceBefore: hasSpaceBefore(sourceCodePoints, startCp),
    });
  }

  return groups;
}

export function buildKoreanReadingPlan(
  syllables: KoreanSyllableLike[],
  mode: KoreanDisplayMode = "rrStandard"
): ReadingPlan {
  const normalized = buildKoreanNormalizedLine(syllables);
  const pieces = romanizeKoreanDisplayPieces(normalized.text, mode);
  const sourceCodePoints = Array.from(normalized.text);
  const spanReadings: SpanReading[] = normalized.spans.map((span) => ({
    spanId: span.spanId,
    source: span.source,
    text: readingForRange(pieces, span.source),
    spaceBefore: hasSpaceBefore(sourceCodePoints, span.source.startCp),
  }));

  return {
    processor: "Korean",
    mode,
    normalized,
    displayText: romanizeKoreanForDisplay(normalized.text, mode).display,
    groups: buildReadingGroups(normalized, pieces),
    spanReadings,
  };
}
