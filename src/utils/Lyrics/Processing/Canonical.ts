import { cleanInvisibles } from "../Fork/TextDetection.ts";
import { codePointLength, isValidCodePointRange } from "./CodePoint.ts";
import type {
  Boundary,
  CanonicalLine,
  CanonicalLineBuilder,
  LanguageContext,
  ParsedLine,
  ScriptPartitioner,
  ScriptRun,
  ValidationResult,
} from "./Model.ts";

const normalizeSpan = (text: string): string => cleanInvisibles((text || "").normalize("NFKC"));
const coreText = (text: string): string => text.replace(/^\s+|\s+$/gu, "");

function appendBoundary(
  text: string,
  boundaries: Boundary[],
  kind: Boundary["kind"],
  provenance: string
): string {
  if (!text || /\s$/u.test(text)) return text;
  boundaries.push({ offsetCp: codePointLength(text), kind, confidence: 1, provenance });
  return `${text} `;
}

export class DefaultCanonicalLineBuilder implements CanonicalLineBuilder {
  build(line: ParsedLine): CanonicalLine {
    let text = "";
    const spanMappings: CanonicalLine["spanMappings"][number][] = [];
    const boundaries: Boundary[] = [];

    line.spans.forEach((span, index) => {
      const normalized = normalizeSpan(span.rawText || span.cleanText);
      const hasLeadingWhitespace = /^\s/u.test(normalized);
      const previous = line.spans[index - 1];
      if (index > 0) {
        if (hasLeadingWhitespace || /\s$/u.test(normalizeSpan(previous.rawText || previous.cleanText))) {
          text = appendBoundary(text, boundaries, "explicitWhitespace", "providerTextWhitespace");
        } else if (previous.providerPartOfWord === false) {
          text = appendBoundary(text, boundaries, "inferred", "providerPartOfWord:false");
        }
      }

      const clean = coreText(normalized);
      const startCp = codePointLength(text);
      text += clean;
      spanMappings.push({
        spanId: span.id,
        canonicalRange: { startCp, endCp: codePointLength(text) },
      });
    });

    return { lineId: line.id, text, spanMappings, boundaries };
  }
}

function scriptOf(char: string): string {
  if (/\s/u.test(char)) return "Whitespace";
  if (/\p{Script=Hangul}/u.test(char)) return "Hangul";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(char)) return "Kana";
  if (/\p{Script=Han}/u.test(char)) return "Han";
  if (/\p{Script=Latin}/u.test(char)) return "Latin";
  if (/\p{Script=Cyrillic}/u.test(char)) return "Cyrillic";
  if (/\p{Script=Greek}/u.test(char)) return "Greek";
  if (/\p{Punctuation}|\p{Symbol}/u.test(char)) return "Punctuation";
  return "Other";
}

export class DefaultScriptPartitioner implements ScriptPartitioner {
  partition(line: CanonicalLine, _context: LanguageContext): readonly ScriptRun[] {
    const chars = Array.from(line.text);
    if (chars.length === 0) return [];
    const runs: ScriptRun[] = [];
    let startCp = 0;
    let script = scriptOf(chars[0]);
    for (let offsetCp = 1; offsetCp <= chars.length; offsetCp += 1) {
      const next = offsetCp < chars.length ? scriptOf(chars[offsetCp]) : undefined;
      if (next !== script) {
        runs.push({ script, canonicalRange: { startCp, endCp: offsetCp } });
        startCp = offsetCp;
        script = next || "Other";
      }
    }
    return runs;
  }
}

export function validateCanonicalLine(line: CanonicalLine, runs: readonly ScriptRun[]): ValidationResult {
  const errors: string[] = [];
  let mappingEnd = 0;
  for (const mapping of line.spanMappings) {
    if (!isValidCodePointRange(line.text, mapping.canonicalRange)) errors.push(`invalid mapping:${mapping.spanId}`);
    if (mapping.canonicalRange.startCp < mappingEnd) errors.push(`overlapping mapping:${mapping.spanId}`);
    mappingEnd = mapping.canonicalRange.endCp;
  }
  let runEnd = 0;
  for (const run of runs) {
    if (!isValidCodePointRange(line.text, run.canonicalRange)) errors.push(`invalid run:${run.script}`);
    if (run.canonicalRange.startCp !== runEnd) errors.push(`run gap:${runEnd}`);
    runEnd = run.canonicalRange.endCp;
  }
  if (runEnd !== codePointLength(line.text)) errors.push(`run coverage:${runEnd}`);
  for (const boundary of line.boundaries) {
    if (boundary.offsetCp < 0 || boundary.offsetCp > codePointLength(line.text)) errors.push("invalid boundary");
  }
  return { valid: errors.length === 0, errors };
}
