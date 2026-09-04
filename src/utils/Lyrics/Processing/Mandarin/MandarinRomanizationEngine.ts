import CompletePinyinDict from "@pinyin-pro/data/complete";
import { addDict, OutputFormat, pinyin, segment } from "pinyin-pro";
import { ChineseTextTest } from "../../Fork/TextDetection.ts";

const COMPLETE_DICTIONARY_NAME = "spicy-lyrics-complete";
// @pinyin-pro/data 1.3.1 has no key longer than this. The longest-entry
// regression test must move with this bound when the pinned dataset changes.
const COMPLETE_DICTIONARY_MAX_CODE_POINTS = 16;
const registeredCompleteEntries = new Set<string>();

// The default pinyin-pro dictionary is intentionally compact and misses some
// ordinary lexical readings (for example, 诗行 is shī háng). Keep every entry
// in the complete dictionary available, but expand only entries that can match
// the current source text instead of building a 348k-pattern matcher eagerly.
function registerCompleteEntriesForText(text: string): void {
  const codePoints = Array.from(text);
  const pending: Record<string, string | [string] | [string, number] | [string, number, string]> = {};
  const pendingKeys: string[] = [];

  for (let start = 0; start < codePoints.length; start += 1) {
    const limit = Math.min(codePoints.length, start + COMPLETE_DICTIONARY_MAX_CODE_POINTS);
    let candidate = "";
    for (let end = start; end < limit; end += 1) {
      candidate += codePoints[end];
      if (
        registeredCompleteEntries.has(candidate) ||
        Object.prototype.hasOwnProperty.call(pending, candidate) ||
        !Object.prototype.hasOwnProperty.call(CompletePinyinDict, candidate)
      ) {
        continue;
      }
      pending[candidate] = CompletePinyinDict[candidate];
      pendingKeys.push(candidate);
    }
  }

  if (pendingKeys.length > 0) {
    addDict(pending, { name: COMPLETE_DICTIONARY_NAME, dict1: "replace" });
    for (const key of pendingKeys) registeredCompleteEntries.add(key);
  }
}

function isChineseHanChar(char: string): boolean {
  return ChineseTextTest.test(char);
}

export type MandarinReadingSegment = {
  startCp: number;
  endCp: number;
  reading: string;
};

export type MandarinReadingProjection = {
  text: string;
  segments: MandarinReadingSegment[];
  valid: boolean;
};

export function projectMandarinReading(text: string, tones = true): MandarinReadingProjection {
  registerCompleteEntriesForText(text);
  const readings = pinyin(text, {
    type: "all",
    toneType: tones ? "symbol" : "none",
    toneSandhi: false,
    nonZh: "consecutive",
  });
  const segments: MandarinReadingSegment[] = [];
  let cursorCp = 0;
  let reconstructed = "";

  for (const result of readings) {
    const origin = result.origin || "";
    const originLength = Array.from(origin).length;
    reconstructed += origin;
    if (
      result.isZh &&
      originLength === 1 &&
      isChineseHanChar(origin) &&
      result.result &&
      result.result !== origin
    ) {
      segments.push({
        startCp: cursorCp,
        endCp: cursorCp + 1,
        reading: result.result,
      });
    }
    cursorCp += originLength;
  }

  const hanCount = Array.from(text).filter(isChineseHanChar).length;
  return {
    text: readings.map((result) => result.result).join(" ").replace(/\s+/gu, " ").trim(),
    segments,
    valid: reconstructed === text && segments.length === hanCount,
  };
}

export function romanizeMandarin(text: string, tones = true): string {
  return projectMandarinReading(text, tones).text;
}

export type MandarinWordLayout = {
  tokenCount: number;
  continuationTokenIndices: ReadonlySet<number>;
};

/**
 * Describe Pinyin token boundaries that fall inside one segmented Mandarin
 * word. Whitespace is excluded from the token count because romanizeMandarin
 * normalizes it into separators rather than display tokens.
 */
export function buildMandarinWordLayout(text: string): MandarinWordLayout {
  registerCompleteEntriesForText(text);
  const groups = segment(text, {
    format: OutputFormat.ZhArray,
    nonZh: "consecutive",
    toneSandhi: false,
  });
  const continuationTokenIndices = new Set<number>();
  let tokenCount = 0;

  for (const group of groups) {
    const isHanWord = group.length > 1 && group.every((part) => {
      const characters = Array.from(part);
      return characters.length === 1 && isChineseHanChar(characters[0]);
    });

    for (let index = 0; index < group.length; index += 1) {
      if (!group[index].trim()) continue;
      if (isHanWord && index > 0) continuationTokenIndices.add(tokenCount);
      tokenCount += 1;
    }
  }

  return { tokenCount, continuationTokenIndices };
}

export function joinMandarinReadingWords(text: string, reading: string): string {
  const layout = buildMandarinWordLayout(text);
  const tokens = reading.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length !== layout.tokenCount) return reading;

  return tokens.map((token, index) => {
    if (index === 0 || layout.continuationTokenIndices.has(index)) return token;
    return ` ${token}`;
  }).join("");
}
