import {
  codePointLength,
  isValidCodePointRange,
} from "../../src/utils/Lyrics/Processing/CodePoint.ts";
import type {
  CanonicalLine,
  TextRange,
  ValidationResult,
} from "../../src/utils/Lyrics/Processing/Model.ts";

export type FixtureScriptRun = {
  readonly script: string;
  readonly canonicalRange: TextRange;
};

function scriptOf(character: string): string {
  if (/\s/u.test(character)) return "Whitespace";
  if (/\p{Script=Hangul}/u.test(character)) return "Hangul";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) return "Kana";
  if (/\p{Script=Han}/u.test(character)) return "Han";
  if (/\p{Script=Latin}/u.test(character)) return "Latin";
  if (/\p{Script=Cyrillic}/u.test(character)) return "Cyrillic";
  if (/\p{Script=Greek}/u.test(character)) return "Greek";
  if (/\p{Punctuation}|\p{Symbol}/u.test(character)) return "Punctuation";
  return "Other";
}

export function partitionCanonicalFixture(line: CanonicalLine): FixtureScriptRun[] {
  const characters = Array.from(line.text);
  if (characters.length === 0) return [];
  const runs: FixtureScriptRun[] = [];
  let startCp = 0;
  let script = scriptOf(characters[0]);
  for (let offsetCp = 1; offsetCp <= characters.length; offsetCp += 1) {
    const next = offsetCp < characters.length ? scriptOf(characters[offsetCp]) : undefined;
    if (next !== script) {
      runs.push({ script, canonicalRange: { startCp, endCp: offsetCp } });
      startCp = offsetCp;
      script = next || "Other";
    }
  }
  return runs;
}

export function validateCanonicalFixture(
  line: CanonicalLine,
  runs: readonly FixtureScriptRun[],
): ValidationResult {
  const errors: string[] = [];
  let mappingEnd = 0;
  for (const mapping of line.spanMappings) {
    if (!isValidCodePointRange(line.text, mapping.canonicalRange)) {
      errors.push(`invalid mapping:${mapping.spanId}`);
    }
    if (mapping.canonicalRange.startCp < mappingEnd) {
      errors.push(`overlapping mapping:${mapping.spanId}`);
    }
    mappingEnd = mapping.canonicalRange.endCp;
  }

  let runEnd = 0;
  for (const run of runs) {
    if (!isValidCodePointRange(line.text, run.canonicalRange)) {
      errors.push(`invalid run:${run.script}`);
    }
    if (run.canonicalRange.startCp !== runEnd) errors.push(`run gap:${runEnd}`);
    runEnd = run.canonicalRange.endCp;
  }
  if (runEnd !== codePointLength(line.text)) errors.push(`run coverage:${runEnd}`);
  for (const boundary of line.boundaries) {
    if (boundary.offsetCp < 0 || boundary.offsetCp > codePointLength(line.text)) {
      errors.push("invalid boundary");
    }
  }
  return { valid: errors.length === 0, errors };
}
