import type { JapaneseAnalyzerToken } from "../Processing/Japanese/JapaneseAnalyzer.ts";
import { japaneseTokenJoinsPrevious } from "../Fork/JukujikunMerge.ts";
import type {
  JapaneseRomajiSegment,
  JapaneseTokenContext,
  JapaneseTokenEntry,
} from "./JapaneseReadingModel.ts";

export function entryRomaji(
  entry: JapaneseTokenEntry,
  token: JapaneseAnalyzerToken,
  kanaToRomaji: (kana: string) => string,
): string {
  if (token.partOfSpeech === "particle") {
    if (entry.surface === "は") return "wa";
    if (entry.surface === "へ") return "e";
    if (entry.surface === "を") return "wo";
  }
  if (!entry.readingKana) return entry.surface;
  const romaji = kanaToRomaji(entry.readingKana);
  return romaji || entry.surface;
}

export function buildRomajiProjectionFromContext(
  context: JapaneseTokenContext,
): {
  romaji?: string;
  segments: JapaneseRomajiSegment[];
} {
  const segments: JapaneseRomajiSegment[] = [];
  for (let index = 0; index < context.entries.length; index += 1) {
    const entry = context.entries[index];
    if (entry.consumed || !entry.romaji) continue;
    const prefix =
      segments.length > 0 &&
      !japaneseTokenJoinsPrevious(context.boundaryPlan, index)
        ? " "
        : "";
    segments.push({
      text: `${prefix}${entry.romaji}`,
      ...(entry.readingProvenance ? { provenance: entry.readingProvenance } : {}),
    });
  }

  const normalizedSegments: JapaneseRomajiSegment[] = [];
  for (const segment of segments) {
    let text = segment.text.replace(/\s+/gu, " ");
    if (normalizedSegments.length === 0) text = text.trimStart();
    else if (normalizedSegments.at(-1)?.text.endsWith(" ")) text = text.trimStart();
    if (text) normalizedSegments.push({ ...segment, text });
  }
  while (normalizedSegments.length > 0) {
    const last = normalizedSegments.at(-1)!;
    const text = last.text.trimEnd();
    if (text) {
      normalizedSegments[normalizedSegments.length - 1] = { ...last, text };
      break;
    }
    normalizedSegments.pop();
  }

  const romaji = normalizedSegments.map((segment) => segment.text).join("");
  return { romaji: romaji || undefined, segments: normalizedSegments };
}
