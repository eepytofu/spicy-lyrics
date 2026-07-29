import { cleanInvisiblesPreserveEdges } from "../Fork/TextDetection.ts";
import { needsSyllableSpaceBefore } from "../Processing/SyllableBoundaries.ts";
import type {
  JapaneseLineTextMap,
  JapaneseReadable,
} from "./JapaneseReadingModel.ts";

const LatinWordTextTest = /[A-Za-zÀ-ÖØ-öø-ÿĀ-žƀ-ɏ]/;

export function normalizeJapaneseTimedText(text: string): string {
  return cleanInvisiblesPreserveEdges((text || "").normalize("NFKC"));
}

function appendLineSpaceIfNeeded(lineText: string): string {
  return lineText && !/\s$/.test(lineText) ? `${lineText} ` : lineText;
}

export function buildJapaneseLineTextMap(
  syllables: JapaneseReadable[],
): JapaneseLineTextMap {
  let lineText = "";
  const spans: JapaneseLineTextMap["spans"] = [];

  for (let index = 0; index < syllables.length; index += 1) {
    const rawText = syllables[index]?.Text || "";
    const normalizedRaw = normalizeJapaneseTimedText(rawText);
    const normalizedText = normalizedRaw.trim();
    if (!normalizedRaw && !normalizedText) continue;

    const leading = normalizedRaw.match(/^\s+/)?.[0] || "";
    const trailing = normalizedRaw.match(/\s+$/)?.[0] || "";
    if (leading) lineText = appendLineSpaceIfNeeded(lineText);

    const previousRaw = syllables[index - 1]?.Text || "";
    const nextNeedsLatinSpace =
      !leading &&
      lineText &&
      needsSyllableSpaceBefore(syllables, index) &&
      (LatinWordTextTest.test(previousRaw) || LatinWordTextTest.test(normalizedText));
    if (nextNeedsLatinSpace) lineText = appendLineSpaceIfNeeded(lineText);

    const start = lineText.length;
    lineText += normalizedText;
    const end = lineText.length;
    if (normalizedText) {
      spans.push({ index, rawText, normalizedText, start, end });
    }

    if (trailing) lineText = appendLineSpaceIfNeeded(lineText);
  }

  return { lineText: lineText.replace(/\s+$/g, ""), spans };
}
