import {
  romanizeKoreanDisplayPieces,
  romanizeKoreanForDisplay,
  type KoreanDisplayMode,
} from "../../Fork/Romanization.ts";
import { codePointSlice } from "../CodePoint.ts";
import type {
  CanonicalLine,
  ReadingAnnotation,
  ReadingUnit,
  ReadingUnitKind,
} from "../Model.ts";

function alignPiecesToDisplay(pieces: readonly string[], display: string): string[] {
  const aligned: string[] = [];
  let cursor = 0;
  for (const piece of pieces) {
    const found = piece ? display.indexOf(piece, cursor) : cursor;
    if (found < 0) return [...pieces];
    aligned.push(`${display.slice(cursor, found)}${piece}`);
    cursor = found + piece.length;
  }
  if (cursor < display.length && aligned.length > 0) aligned[aligned.length - 1] += display.slice(cursor);
  return aligned;
}

function kindFor(source: string): ReadingUnitKind {
  if (/\p{Script=Hangul}/u.test(source)) return "transformed";
  if (/^[\p{Punctuation}\p{Symbol}]+$/u.test(source)) return "punctuation";
  return "passthrough";
}

function logicalGroupAt(text: string, startCp: number): string {
  const before = Array.from(text).slice(0, startCp).join("");
  const groups = before.trimStart() ? before.trimStart().split(/\s+/u).length - (/\s$/u.test(before) ? 0 : 1) : 0;
  return `group-${groups}`;
}

export function annotateKoreanLine(
  canonical: CanonicalLine,
  mode: KoreanDisplayMode = "rrStandard"
): ReadingAnnotation {
  const pieces = romanizeKoreanDisplayPieces(canonical.text, mode);
  const display = romanizeKoreanForDisplay(canonical.text, mode).display;
  const aligned = alignPiecesToDisplay(pieces, display);
  const units: ReadingUnit[] = canonical.spanMappings.map((mapping, index) => {
    const previousEnd = index > 0 ? canonical.spanMappings[index - 1].canonicalRange.endCp : 0;
    return {
      canonicalRange: mapping.canonicalRange,
      text: aligned.slice(previousEnd, mapping.canonicalRange.endCp).join(""),
      kind: kindFor(codePointSlice(canonical.text, mapping.canonicalRange)),
      logicalGroupId: logicalGroupAt(canonical.text, mapping.canonicalRange.startCp),
      timingRefs: [mapping.spanId],
    };
  });
  return { processor: "Korean", mode, provenance: "local", units };
}

export const joinReadingUnits = (annotation: ReadingAnnotation): string =>
  annotation.units.map((unit) => unit.text).join("");
