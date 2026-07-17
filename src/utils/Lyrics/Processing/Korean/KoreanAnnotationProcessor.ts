import {
  normalizeKoreanDisplaySource,
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

/**
 * Romanization pieces are produced from the *normalized* display source, whose
 * whitespace can differ from the canonical text (readability splits insert
 * spaces, tokenizer rejoins remove them). Map every normalized code point back
 * to its canonical code point so per-span unit text never drifts: normalization
 * only inserts or removes whitespace, never reorders non-whitespace characters.
 */
function sourceToCanonicalIndexMap(canonicalText: string, sourceText: string): number[] {
  const canonicalChars = Array.from(canonicalText);
  const sourceChars = Array.from(sourceText);
  const map: number[] = Array.from({ length: sourceChars.length }, () => -1);
  let c = 0;
  for (let s = 0; s < sourceChars.length; s += 1) {
    while (c < canonicalChars.length && /\s/u.test(canonicalChars[c]) && canonicalChars[c] !== sourceChars[s]) c += 1;
    if (c < canonicalChars.length && canonicalChars[c] === sourceChars[s]) {
      map[s] = c;
      c += 1;
    }
  }
  return map;
}

export function annotateKoreanLine(
  canonical: CanonicalLine,
  mode: KoreanDisplayMode = "rrStandard"
): ReadingAnnotation {
  const source = normalizeKoreanDisplaySource(canonical.text);
  const pieces = romanizeKoreanDisplayPieces(canonical.text, mode);
  const display = romanizeKoreanForDisplay(canonical.text, mode).display;
  const aligned = alignPiecesToDisplay(pieces, display);
  const sourceChars = Array.from(source);
  const canonicalChars = Array.from(canonical.text);
  const sourceMap = sourceToCanonicalIndexMap(canonical.text, source);

  const spanIndexByCp: number[] = Array.from({ length: canonicalChars.length }, () => -1);
  canonical.spanMappings.forEach((mapping, index) => {
    for (let cp = mapping.canonicalRange.startCp; cp < mapping.canonicalRange.endCp; cp += 1) {
      spanIndexByCp[cp] = index;
    }
  });

  // Fall back to the legacy range slice whenever the piece stream cannot be
  // aligned 1:1 with the normalized source (defensive; should not happen).
  const mappingCoversCanonical = canonicalChars.every((char, cp) =>
    /\s/u.test(char) || sourceMap.includes(cp),
  );
  if (pieces.length !== sourceChars.length || !mappingCoversCanonical) {
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

  const unitParts: string[][] = canonical.spanMappings.map(() => []);
  let pending = "";
  for (let s = 0; s < aligned.length; s += 1) {
    const unitIndex = spanIndexByCp[sourceMap[s]] ?? -1;
    if (unitIndex < 0) {
      // Whitespace (inserted by normalization, or canonical inter-span gap):
      // attach to the next timed unit, matching the gap-prepend convention.
      pending += aligned[s];
      continue;
    }
    unitParts[unitIndex].push(pending + aligned[s]);
    pending = "";
  }
  if (pending && unitParts.length > 0) unitParts[unitParts.length - 1].push(pending);

  const units: ReadingUnit[] = canonical.spanMappings.map((mapping, index) => ({
    canonicalRange: mapping.canonicalRange,
    text: unitParts[index].join(""),
    kind: kindFor(codePointSlice(canonical.text, mapping.canonicalRange)),
    logicalGroupId: logicalGroupAt(canonical.text, mapping.canonicalRange.startCp),
    timingRefs: [mapping.spanId],
  }));
  return { processor: "Korean", mode, provenance: "local", units };
}

export const joinReadingUnits = (annotation: ReadingAnnotation): string =>
  annotation.units.map((unit) => unit.text).join("");
