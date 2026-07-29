import { utf16FuriganaSegmentKey } from "../Processing/Japanese/FuriganaIdentity.ts";
import { japaneseTokenJoinsPrevious } from "../Fork/JukujikunMerge.ts";
import { kataToHira } from "./JapaneseFurigana.ts";
import {
  KanaCharTest,
  KanjiLikeCharTest,
  rangesOverlap,
  type JapaneseReadable,
  type JapaneseReading,
  type JapaneseRomajiSegment,
  type JapaneseTimedTextSpan,
  type JapaneseTokenContext,
  type JapaneseTokenEntry,
} from "./JapaneseReadingModel.ts";
import { normalizeJapaneseTimedText } from "./JapaneseSourceMapping.ts";

type ProjectedEntryPart = {
  entryIndex: number;
  logicalGroupIndex: number;
  text: string;
  animationSpanIndexes: number[];
  animationStart: number;
  animationEnd: number;
};

function normalizedRomajiComparison(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}

/**
 * Projects a token reading onto provider timing spans only when furigana
 * geometry and literal Kana prove an exact split.
 */
function projectEntryRomajiChunks(
  reading: JapaneseReading,
  context: JapaneseTokenContext,
  entry: JapaneseTokenEntry,
  overlappingSpans: readonly JapaneseTimedTextSpan[],
): string[] | undefined {
  if (overlappingSpans.length < 2 || entry.surface.length !== entry.end - entry.start) {
    return undefined;
  }

  type ReadingPiece = { start: number; end: number; text: string };
  const pieces: ReadingPiece[] = [];
  const furigana = reading.furigana
    .filter((segment) => rangesOverlap(entry.start, entry.end, segment.start, segment.end))
    .sort((left, right) => left.start - right.start || left.end - right.end);

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

  pieces.sort((left, right) => left.start - right.start || left.end - right.end);
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
  effectiveSpans: readonly JapaneseTimedTextSpan[],
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
      !japaneseTokenJoinsPrevious(context.boundaryPlan, entryIndex)
    ) {
      logicalGroupIndex = entryIndex;
    }
    previousActiveEntryIndex = entryIndex;

    const overlappingSpans = effectiveSpans
      .filter((span) => rangesOverlap(entry.start, entry.end, span.start, span.end))
      .sort((left, right) => left.start - right.start || left.index - right.index);
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
      const groupSpans = [
        ...new Map(
          group
            .flatMap((projection) => projection.spans)
            .map((span) => [span.index, span]),
        ).values(),
      ].sort((left, right) => left.start - right.start || left.index - right.index);
      const groupText = group
        .map((projection) => context.entries[projection.entryIndex].romaji)
        .join("");
      const groupSpanIndexes = groupSpans.map((span) => span.index);
      const animationStart = Math.min(
        ...group.map((projection) => context.entries[projection.entryIndex].start),
      );
      const animationEnd = Math.max(
        ...group.map((projection) => context.entries[projection.entryIndex].end),
      );
      for (let index = 0; index < groupSpans.length; index += 1) {
        append(groupSpans[index].index, {
          entryIndex: group[0].entryIndex,
          logicalGroupIndex: groupIndex,
          text: index === 0 ? groupText : "",
          animationSpanIndexes:
            index === 0 ? groupSpanIndexes : [groupSpans[index].index],
          animationStart:
            index === 0 ? animationStart : groupSpans[index].start,
          animationEnd:
            index === 0 ? animationEnd : groupSpans[index].end,
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
          animationStart: Math.max(
            context.entries[projection.entryIndex].start,
            projection.spans[index].start,
          ),
          animationEnd: Math.min(
            context.entries[projection.entryIndex].end,
            projection.spans[index].end,
          ),
        });
      }
    }
  }

  return bySpan;
}

export function applyJapaneseReadingContextToSyllables(
  reading: JapaneseReading,
  context: JapaneseTokenContext,
  syllables: JapaneseReadable[],
  spans?: JapaneseTimedTextSpan[],
): void {
  const analysisText = reading.displayText || reading.sourceText;
  let syllablePosition = 0;
  let previousLastEntryIndex = -1;
  const effectiveSpans =
    spans && spans.length > 0
      ? spans
      : syllables.map((syllable, index) => {
          const text = normalizeJapaneseTimedText(syllable.Text || "").trim();
          while (
            syllablePosition < analysisText.length &&
            /\s/.test(analysisText[syllablePosition])
          ) {
            syllablePosition += 1;
          }
          const start = syllablePosition;
          const end = start + text.length;
          syllablePosition = end;
          return {
            index,
            rawText: syllable.Text || "",
            normalizedText: text,
            start,
            end,
          };
        });
  const projectedEntries = buildEntryRomajiProjection(reading, context, effectiveSpans);
  const assignedFuriganaKeys = new Set<string>();

  for (let syllableIndex = 0; syllableIndex < syllables.length; syllableIndex += 1) {
    const syllable = syllables[syllableIndex];
    const text = normalizeJapaneseTimedText(syllable.Text || "").trim();
    const span = effectiveSpans.find((candidate) => candidate.index === syllableIndex);
    const syllableStart = span?.start ?? 0;
    const syllableEnd = span?.end ?? syllableStart;

    delete syllable.JapaneseReading;
    delete syllable.RomanizedText;
    delete syllable.TransliteratedText;
    delete syllable.RomajiSpaceBefore;
    delete syllable.JapaneseRomajiTiming;

    const romajiParts: string[] = [];
    let firstEntryIndex = -1;
    let lastEntryIndex = -1;
    const entryParts = (projectedEntries.get(syllableIndex) || []).sort(
      (left, right) => left.entryIndex - right.entryIndex,
    );

    for (const part of entryParts) {
      if (!part.text) continue;
      if (
        romajiParts.length > 0 &&
        !japaneseTokenJoinsPrevious(context.boundaryPlan, part.entryIndex)
      ) {
        romajiParts.push(" ");
      }
      romajiParts.push(part.text);
      if (firstEntryIndex === -1) firstEntryIndex = part.entryIndex;
      lastEntryIndex = part.entryIndex;
    }

    const hasSourceSpaceBefore =
      syllableStart > 0 && /\s/.test(analysisText[syllableStart - 1] || "");
    if (
      syllableIndex > 0 &&
      firstEntryIndex !== -1 &&
      (hasSourceSpaceBefore ||
        (firstEntryIndex !== previousLastEntryIndex &&
          !japaneseTokenJoinsPrevious(context.boundaryPlan, firstEntryIndex)))
    ) {
      syllable.RomajiSpaceBefore = true;
    }
    if (lastEntryIndex !== -1) previousLastEntryIndex = lastEntryIndex;

    const syllableRomaji = romajiParts.length > 0 ? romajiParts.join("") : undefined;
    const syllableRomajiSegments: JapaneseRomajiSegment[] = [];
    for (const part of entryParts) {
      if (!part.text) continue;
      const entry = context.entries[part.entryIndex];
      const prefix =
        syllableRomajiSegments.length > 0 &&
        !japaneseTokenJoinsPrevious(context.boundaryPlan, part.entryIndex)
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
      const animatedParts = entryParts.filter((part) => part.text);
      const rangeParts = animatedParts.length > 0 ? animatedParts : entryParts;
      const animationStart = Math.min(
        ...rangeParts.map((part) => part.animationStart),
      );
      const animationEnd = Math.max(
        ...rangeParts.map((part) => part.animationEnd),
      );
      syllable.JapaneseRomajiTiming = {
        logicalGroupId:
          logicalGroupIndexes.length === 1
            ? `jp-token-${logicalGroupIndexes[0]}`
            : `jp-span-${syllableIndex}`,
        animationSpanIndexes,
        animationStart,
        animationEnd,
      };
    }

    const localFurigana = reading.furigana
      .map((segment) => ({
        segment,
        lineSegmentKey: utf16FuriganaSegmentKey(
          analysisText,
          segment.start,
          segment.end,
          segment.reading,
        ),
      }))
      .filter(({ segment }) => {
        const key = `${segment.start}:${segment.end}:${segment.reading}`;
        if (assignedFuriganaKeys.has(key)) return false;
        if (!rangesOverlap(segment.start, segment.end, syllableStart, syllableEnd)) {
          return false;
        }
        assignedFuriganaKeys.add(key);
        return true;
      })
      .map(({ segment, lineSegmentKey }) => ({
        start: Math.max(0, segment.start - syllableStart),
        end: Math.max(
          Math.min(syllableEnd, segment.end) - syllableStart,
          Math.max(0, segment.start - syllableStart) + 1,
        ),
        reading: segment.reading,
        lineSegmentKey,
        ...(segment.provenance ? { provenance: segment.provenance } : {}),
      }));

    const syllableDisplayText = span
      ? analysisText.slice(span.start, span.end)
      : text;
    if (localFurigana.length > 0 || syllableRomaji || syllableDisplayText !== text) {
      syllable.JapaneseReading = {
        sourceText: text,
        ...(syllableDisplayText !== text ? { displayText: syllableDisplayText } : {}),
        romaji: syllableRomaji,
        ...(syllableRomajiSegments.length > 0
          ? { romajiSegments: syllableRomajiSegments }
          : {}),
        furigana: localFurigana,
      };
    }
  }
}
