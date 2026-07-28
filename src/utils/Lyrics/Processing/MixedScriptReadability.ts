import type { FuriganaSegment } from "../Reading/JapaneseReading.ts";
import {
  hasMixedScriptReadabilityBoundary,
} from "./BoundaryResolver.ts";
import { resolveSyllableBoundary } from "./SyllableBoundaries.ts";

export { hasMixedScriptReadabilityBoundary } from "./BoundaryResolver.ts";

export type MixedScriptReadabilityProjection = {
  text: string;
  insertedBeforeUtf16: readonly number[];
};

export function projectMixedScriptReadability(text: string): MixedScriptReadabilityProjection {
  const characters = Array.from(text || "");
  const insertedBeforeUtf16: number[] = [];
  let projected = "";
  let utf16Offset = 0;

  characters.forEach((character, index) => {
    if (
      index > 0 &&
      hasMixedScriptReadabilityBoundary(characters[index - 1], character)
    ) {
      projected += " ";
      insertedBeforeUtf16.push(utf16Offset);
    }
    projected += character;
    utf16Offset += character.length;
  });

  return { text: projected, insertedBeforeUtf16 };
}

export function projectFuriganaSegmentsForReadability(
  segments: readonly FuriganaSegment[],
  projection: MixedScriptReadabilityProjection,
): FuriganaSegment[] {
  const beforeOrAt = (offset: number): number =>
    projection.insertedBeforeUtf16.filter((position) => position <= offset).length;
  const strictlyBefore = (offset: number): number =>
    projection.insertedBeforeUtf16.filter((position) => position < offset).length;

  return segments.map((segment) => ({
    ...segment,
    start: segment.start + beforeOrAt(segment.start),
    end: segment.end + strictlyBefore(segment.end),
  }));
}

export function needsMixedScriptReadabilityGapBefore(
  units: readonly { Text?: string; IsPartOfWord?: boolean }[],
  index: number,
): boolean {
  return resolveSyllableBoundary(units, index).needsReadabilityGap;
}

type ReadingBoundary = {
  token: string;
  side: "before" | "after";
  sourceOffset: number;
};

const LatinScript = /^\p{Script=Latin}$/u;
const Letter = /^\p{Letter}$/u;

const isLatinLetter = (character: string): boolean =>
  Letter.test(character) && LatinScript.test(character);

function sourceReadingBoundaries(sourceText: string): ReadingBoundary[] {
  const characters = Array.from(sourceText || "");
  const utf16Offsets: number[] = [];
  let offset = 0;
  for (const character of characters) {
    utf16Offsets.push(offset);
    offset += character.length;
  }

  const boundaries: ReadingBoundary[] = [];
  for (let index = 1; index < characters.length; index += 1) {
    const previous = characters[index - 1];
    const current = characters[index];
    if (!hasMixedScriptReadabilityBoundary(previous, current)) continue;

    if (isLatinLetter(current)) {
      let end = index + 1;
      while (end < characters.length && isLatinLetter(characters[end])) end += 1;
      boundaries.push({
        token: characters.slice(index, end).join(""),
        side: "before",
        sourceOffset: utf16Offsets[index],
      });
    } else {
      let start = index - 1;
      while (start > 0 && isLatinLetter(characters[start - 1])) start -= 1;
      boundaries.push({
        token: characters.slice(start, index).join(""),
        side: "after",
        sourceOffset: utf16Offsets[index],
      });
    }
  }
  return boundaries;
}

export function formatMixedScriptReadingForDisplay(
  sourceText: string,
  readingText: string | undefined,
): string | undefined {
  if (!readingText) return readingText;
  const boundaries = sourceReadingBoundaries(sourceText);
  if (boundaries.length === 0) return readingText;

  const lowerReading = readingText.toLocaleLowerCase();
  const insertionOffsets = new Set<number>();
  let searchOffset = 0;

  for (const boundary of boundaries) {
    const token = boundary.token.toLocaleLowerCase();
    const matches: number[] = [];
    let match = lowerReading.indexOf(token, searchOffset);
    while (match !== -1) {
      matches.push(match);
      match = lowerReading.indexOf(token, match + Math.max(1, token.length));
    }
    if (matches.length === 0) continue;

    const expectedRatio = sourceText.length > 0
      ? boundary.sourceOffset / sourceText.length
      : 0;
    const selected = matches.reduce((best, candidate) => {
      const bestDistance = Math.abs(best / readingText.length - expectedRatio);
      const candidateDistance = Math.abs(candidate / readingText.length - expectedRatio);
      return candidateDistance < bestDistance ? candidate : best;
    });
    const insertion = boundary.side === "before"
      ? selected
      : selected + boundary.token.length;
    insertionOffsets.add(insertion);
    searchOffset = selected + boundary.token.length;
  }

  if (insertionOffsets.size === 0) return readingText;
  let result = "";
  for (let index = 0; index <= readingText.length; index += 1) {
    if (
      insertionOffsets.has(index) &&
      index > 0 &&
      index < readingText.length &&
      !/\s/u.test(readingText[index - 1]) &&
      !/\s/u.test(readingText[index])
    ) {
      result += " ";
    }
    if (index < readingText.length) result += readingText[index];
  }
  return result;
}
