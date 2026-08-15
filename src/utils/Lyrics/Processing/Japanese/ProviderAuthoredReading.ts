import type { ProviderRubyReadable } from "../../ProviderRuby.ts";

export type ProviderAuthoredReadingHint = {
  /** UTF-16 range of the written kanji in the immutable source text. */
  readonly sourceRange: { readonly start: number; readonly end: number };
  /** UTF-16 range of the written kanji after the parenthetical is hidden. */
  readonly displayRange: { readonly start: number; readonly end: number };
  /** UTF-16 range of the parenthetical syntax removed only from display. */
  readonly annotationRange: { readonly start: number; readonly end: number };
  readonly reading: string;
};

export type ProviderAuthoredReadingProjection = {
  readonly sourceText: string;
  readonly displayText: string;
  readonly hints: readonly ProviderAuthoredReadingHint[];
};

export type ProviderTextSpan = {
  readonly start: number;
  readonly end: number;
};

export type StructuredProviderRubySpan = ProviderTextSpan & ProviderRubyReadable;

const ParentheticalReading = /([\p{Script=Han}々〆ヵヶ]{1,12})[（(]([\p{Script=Hiragana}\p{Script=Katakana}ーｰ]{1,24})[）)]/gu;
const TrailingDecorationOnly = /^[\s\p{P}\p{S}]*$/u;

function annotationFitsVisibleSpan(
  source: string,
  annotationStart: number,
  annotationEnd: number,
  spans: readonly ProviderTextSpan[] | undefined,
): boolean {
  if (!spans?.length) return true;
  const owner = spans.find((span) => span.start <= annotationStart && span.end >= annotationEnd);
  if (!owner) return false;
  return `${source.slice(owner.start, annotationStart)}${source.slice(annotationEnd, owner.end)}`.trim().length > 0;
}

/**
 * Recognize compact Japanese reading notation such as 天(そら) or 天（そら）.
 * The result is display-only: callers retain sourceText for copy, timing, and
 * interop, while displayText is safe to send through the local reading stack.
 */
export function projectProviderAuthoredJapaneseReadings(
  text: string,
  spans?: readonly ProviderTextSpan[],
): ProviderAuthoredReadingProjection {
  const sourceText = text || "";
  const hints: ProviderAuthoredReadingHint[] = [];
  let displayText = "";
  let sourceCursor = 0;
  let match: RegExpExecArray | null;
  ParentheticalReading.lastIndex = 0;

  while ((match = ParentheticalReading.exec(sourceText)) !== null) {
    const surface = match[1];
    const reading = match[2];
    const sourceStart = match.index;
    const annotationStart = sourceStart + surface.length;
    const sourceEnd = sourceStart + match[0].length;
    // Parenthetical kana at the end of a lyric line is commonly a backing
    // chant or spoken response, not a reading for the preceding kanji.
    if (TrailingDecorationOnly.test(sourceText.slice(sourceEnd))) continue;
    if (!annotationFitsVisibleSpan(sourceText, annotationStart, sourceEnd, spans)) continue;

    displayText += sourceText.slice(sourceCursor, annotationStart);
    const displayEnd = displayText.length;
    hints.push({
      sourceRange: { start: sourceStart, end: annotationStart },
      displayRange: { start: displayEnd - surface.length, end: displayEnd },
      annotationRange: { start: annotationStart, end: sourceEnd },
      reading,
    });
    sourceCursor = sourceEnd;
  }

  if (hints.length === 0) return { sourceText, displayText: sourceText, hints };
  displayText += sourceText.slice(sourceCursor);
  return { sourceText, displayText, hints };
}

const StructuredReading = /^[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]+$/u;
const StructuredBase = /[\p{Script=Han}々〆ヵヶ]/u;

export function addStructuredProviderRubyReadings(
  projection: ProviderAuthoredReadingProjection,
  spans: readonly StructuredProviderRubySpan[],
): ProviderAuthoredReadingProjection {
  let hints = [...projection.hints];
  for (const span of spans) {
    const tags = span.ProviderRuby;
    if (tags?.length !== 1) continue;
    const reading = tags[0].Text;
    const surface = projection.sourceText.slice(span.start, span.end);
    if (!StructuredBase.test(surface) || !StructuredReading.test(reading)) continue;
    const displayStart = projectProviderSourceOffset(projection, span.start);
    const displayEnd = projectProviderSourceOffset(projection, span.end);
    if (displayEnd <= displayStart) continue;
    hints = hints.filter((hint) =>
      !(hint.displayRange.start < displayEnd && displayStart < hint.displayRange.end)
    );
    hints.push({
      sourceRange: { start: span.start, end: span.end },
      displayRange: { start: displayStart, end: displayEnd },
      annotationRange: { start: span.end, end: span.end },
      reading,
    });
  }
  hints.sort((left, right) => left.displayRange.start - right.displayRange.start);
  return { ...projection, hints };
}

export function projectProviderSourceOffset(
  projection: ProviderAuthoredReadingProjection,
  sourceOffset: number,
): number {
  const safeOffset = Math.max(0, Math.min(projection.sourceText.length, sourceOffset));
  let removed = 0;
  for (const hint of projection.hints) {
    const { start, end } = hint.annotationRange;
    removed += Math.max(0, Math.min(safeOffset, end) - Math.min(safeOffset, start));
  }
  return safeOffset - removed;
}
