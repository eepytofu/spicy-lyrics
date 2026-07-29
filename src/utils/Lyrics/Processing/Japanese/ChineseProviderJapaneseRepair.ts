import {
  CHINESE_PROVIDER_JAPANESE_CHARACTER_MAP,
  CHINESE_PROVIDER_JAPANESE_CHARACTER_PATTERN,
} from "./ChineseProviderCharacterMap.generated.ts";
import type {
  JapaneseTextProjection,
} from "../../Reading/JapaneseReadingModel.ts";

const ChineseLyricsProviders = new Set(["qq", "kugou", "netease", "soda"]);
const LabelShapedLine = /^[^:\n]{1,48}:/u;

function replaceCharacterAt(
  text: string,
  index: number,
  replacement: string,
): string {
  return `${text.slice(0, index)}${replacement}${text.slice(index + 1)}`;
}

function applyContextualJapaneseRepairs(
  source: string,
  normalized: string,
): string {
  let result = normalized;
  const repairMatches = (
    pattern: RegExp,
    sourceCharacterOffset: number,
    replacement: string,
  ) => {
    for (const match of source.matchAll(pattern)) {
      if (match.index === undefined) continue;
      result = replaceCharacterAt(
        result,
        match.index + sourceCharacterOffset,
        replacement,
      );
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

export function isChineseProviderJapaneseRepairSource(
  lyrics: { fetchProvider?: unknown; source?: unknown } | null | undefined,
): boolean {
  return [lyrics?.fetchProvider, lyrics?.source].some(
    (value) =>
      typeof value === "string" &&
      ChineseLyricsProviders.has(value.toLowerCase()),
  );
}

/**
 * Chinese-provider glyph repair is a display projection, not source recovery.
 * Preserve compact `label: value` rows exactly without trying to enumerate
 * every possible contributor role. Language routing remains the caller's
 * responsibility, so genuine Chinese lines never enter this Japanese lane.
 */
export function allowsChineseProviderJapaneseRepair(text: string): boolean {
  const normalized = (text || "").normalize("NFKC").trim();
  return normalized.length > 0 && !LabelShapedLine.test(normalized);
}

/**
 * Repair Chinese-provider character conversion for Japanese analysis and its
 * display-only projection. Every generated mapping preserves UTF-16 length so
 * furigana and timing ranges remain aligned with immutable provider text.
 */
export function repairChineseProviderJapaneseText(text: string): string {
  if (!text) return text;
  const normalized = text.replace(
    CHINESE_PROVIDER_JAPANESE_CHARACTER_PATTERN,
    (character) =>
      CHINESE_PROVIDER_JAPANESE_CHARACTER_MAP.get(character) ?? character,
  );
  return applyContextualJapaneseRepairs(text, normalized);
}

export const ChineseProviderJapaneseTextProjection: JapaneseTextProjection = {
  kind: "chineseProviderRepair",
  project: repairChineseProviderJapaneseText,
};
