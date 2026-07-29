import { ConverterBuilder } from "opencc-js/core";
import * as CnToTraditionalPreset from "opencc-js/preset/cn2t";
import * as TraditionalToCnPreset from "opencc-js/preset/t2cn";
import { needsSyllableSpaceBefore } from "./Processing/SyllableBoundaries.ts";
import {
  CHINESE_PROVIDER_JAPANESE_CHARACTER_MAP,
  CHINESE_PROVIDER_JAPANESE_CHARACTER_PATTERN,
} from "./Processing/Japanese/ChineseProviderCharacterMap.generated.ts";

export type ChineseCharacterForm = "original" | "simplified" | "traditional";
export type DetectedChineseCharacterForm = Exclude<ChineseCharacterForm, "original"> | "ambiguous";

type TimedTextUnit = { Text?: string; IsPartOfWord?: boolean };

const toSimplified = ConverterBuilder(TraditionalToCnPreset)({ from: "t", to: "cn" });
const toTraditional = ConverterBuilder(CnToTraditionalPreset)({ from: "cn", to: "tw" });

const CHINESE_LYRICS_PROVIDERS = new Set(["qq", "kugou", "netease", "soda"]);

function replaceCharacterAt(text: string, index: number, replacement: string): string {
  return `${text.slice(0, index)}${replacement}${text.slice(index + 1)}`;
}

function applyContextualJapaneseRepairs(source: string, normalized: string): string {
  let result = normalized;
  const repairMatches = (
    pattern: RegExp,
    sourceCharacterOffset: number,
    replacement: string,
  ) => {
    for (const match of source.matchAll(pattern)) {
      if (match.index === undefined) continue;
      result = replaceCharacterAt(result, match.index + sourceCharacterOffset, replacement);
    }
  };

  // These source forms are valid Japanese characters in other contexts, so
  // the generated character map deliberately abstains. Repair only lexical
  // contexts whose Japanese spelling is unambiguous.
  repairMatches(/后宫/gu, 0, "後");
  repairMatches(/叶っぱ/gu, 0, "葉");
  repairMatches(/无常/gu, 0, "無");
  return result;
}

function codePoints(value: string): string[] {
  return Array.from(value);
}

function differenceCount(left: string, right: string): number {
  const a = codePoints(left);
  const b = codePoints(right);
  const length = Math.max(a.length, b.length);
  let differences = 0;
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) differences += 1;
  }
  return differences;
}

export function convertChineseText(text: string, form: ChineseCharacterForm): string {
  if (!text || form === "original") return text;
  return form === "simplified" ? toSimplified(text) : toTraditional(text);
}

export function isChineseLyricsProvider(lyrics: { fetchProvider?: unknown; source?: unknown } | null | undefined): boolean {
  return [lyrics?.fetchProvider, lyrics?.source].some((value) =>
    typeof value === "string" && CHINESE_LYRICS_PROVIDERS.has(value.toLowerCase())
  );
}

/**
 * Repair Chinese-provider character conversion for Japanese analysis and its
 * display-only projection. Unequal-length conversions are rejected so UTF-16
 * furigana and timing ranges continue to align with immutable provider text.
 */
export function normalizeChineseProviderJapaneseText(text: string): string {
  if (!text) return text;
  const normalized = text.replace(
    CHINESE_PROVIDER_JAPANESE_CHARACTER_PATTERN,
    (character) => CHINESE_PROVIDER_JAPANESE_CHARACTER_MAP.get(character) ?? character,
  );
  return applyContextualJapaneseRepairs(text, normalized);
}

export function detectChineseCharacterForm(text: string): DetectedChineseCharacterForm {
  const simplifiedEvidence = differenceCount(text, toTraditional(text));
  const traditionalEvidence = differenceCount(text, toSimplified(text));
  if (simplifiedEvidence === traditionalEvidence) return "ambiguous";
  return traditionalEvidence > simplifiedEvidence ? "traditional" : "simplified";
}

function alignedOutputBoundaries(source: string, output: string): number[] {
  const from = codePoints(source);
  const to = codePoints(output);
  const costs = Array.from({ length: from.length + 1 }, () => Array<number>(to.length + 1).fill(0));
  for (let index = 0; index <= from.length; index += 1) costs[index][0] = index;
  for (let index = 0; index <= to.length; index += 1) costs[0][index] = index;
  for (let fromIndex = 1; fromIndex <= from.length; fromIndex += 1) {
    for (let toIndex = 1; toIndex <= to.length; toIndex += 1) {
      const substitution = costs[fromIndex - 1][toIndex - 1] + (from[fromIndex - 1] === to[toIndex - 1] ? 0 : 1);
      const deletion = costs[fromIndex - 1][toIndex] + 1;
      const insertion = costs[fromIndex][toIndex - 1] + 1;
      costs[fromIndex][toIndex] = Math.min(substitution, deletion, insertion);
    }
  }

  const reversed: Array<"pair" | "delete" | "insert"> = [];
  let fromIndex = from.length;
  let toIndex = to.length;
  while (fromIndex > 0 || toIndex > 0) {
    const pairCost = fromIndex > 0 && toIndex > 0
      ? costs[fromIndex - 1][toIndex - 1] + (from[fromIndex - 1] === to[toIndex - 1] ? 0 : 1)
      : Number.POSITIVE_INFINITY;
    if (pairCost === costs[fromIndex][toIndex]) {
      reversed.push("pair");
      fromIndex -= 1;
      toIndex -= 1;
    } else if (fromIndex > 0 && costs[fromIndex - 1][toIndex] + 1 === costs[fromIndex][toIndex]) {
      reversed.push("delete");
      fromIndex -= 1;
    } else {
      reversed.push("insert");
      toIndex -= 1;
    }
  }

  const boundaries = Array<number>(from.length + 1).fill(0);
  fromIndex = 0;
  toIndex = 0;
  for (const operation of reversed.reverse()) {
    if (operation === "insert") {
      toIndex += 1;
      continue;
    }
    fromIndex += 1;
    if (operation === "pair") toIndex += 1;
    boundaries[fromIndex] = toIndex;
  }
  boundaries[from.length] = to.length;
  return boundaries;
}

export function convertChineseTimedTextUnits(units: TimedTextUnit[], form: ChineseCharacterForm): string[] {
  if (form === "original" || units.length === 0) return units.map((unit) => unit.Text || "");
  let source = "";
  let offset = 0;
  const ranges = units.map((unit, index) => {
    const prefix = needsSyllableSpaceBefore(units, index) ? " " : "";
    source += prefix;
    offset += codePoints(prefix).length;
    const start = offset;
    const text = unit.Text || "";
    source += text;
    offset += codePoints(text).length;
    return { start, end: offset };
  });
  const output = convertChineseText(source, form);
  const boundaries = alignedOutputBoundaries(source, output);
  const outputPoints = codePoints(output);
  return ranges.map(({ start, end }) => outputPoints.slice(boundaries[start], boundaries[end]).join(""));
}

export function convertChineseLyricsText(
  lyrics: any,
  form: ChineseCharacterForm,
  shouldConvert: (text: string) => boolean,
): void {
  if (form === "original") return;
  const convertTextEntry = (entry: any) => {
    if (typeof entry?.Text === "string" && shouldConvert(entry.Text)) entry.Text = convertChineseText(entry.Text, form);
  };
  const convertTimedGroup = (group: any) => {
    const units = group?.Syllables;
    if (!Array.isArray(units) || units.length === 0) return;
    const lineText = units.reduce((text: string, unit: TimedTextUnit, index: number) =>
      `${text}${needsSyllableSpaceBefore(units, index) ? " " : ""}${unit.Text || ""}`, "");
    if (!shouldConvert(lineText)) return;
    const converted = convertChineseTimedTextUnits(units, form);
    units.forEach((unit: TimedTextUnit, index: number) => { unit.Text = converted[index]; });
  };
  if (lyrics?.Type === "Static") {
    for (const line of lyrics.Lines || []) convertTextEntry(line);
  } else if (lyrics?.Type === "Line") {
    for (const line of lyrics.Content || []) convertTextEntry(line);
  } else if (lyrics?.Type === "Syllable") {
    for (const vocal of lyrics.Content || []) {
      convertTimedGroup(vocal?.Lead);
      for (const background of vocal?.Background || []) convertTimedGroup(background);
    }
  }
}
