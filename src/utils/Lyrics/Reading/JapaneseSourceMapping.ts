import { cleanInvisiblesPreserveEdges } from "../Fork/TextDetection.ts";
import { needsSyllableSpaceBefore } from "../Processing/SyllableBoundaries.ts";
import type {
  JapaneseLineTextMap,
  JapaneseReadable,
} from "./JapaneseReadingModel.ts";

const LatinWordTextTest = /[A-Za-zÀ-ÖØ-öø-ÿĀ-žƀ-ɏ]/;
const JapaneseCharacterTest = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u;

const firstCharacter = (value: string): string => Array.from(value)[0] || "";
const lastCharacter = (value: string): string => Array.from(value).at(-1) || "";

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
  let sourceText = "";
  const spans: JapaneseLineTextMap["spans"] = [];
  const hasWordContinuation = syllables.some(
    (syllable) => (syllable as JapaneseReadable & { IsPartOfWord?: boolean }).IsPartOfWord === true,
  );

  for (let index = 0; index < syllables.length; index += 1) {
    const rawText = syllables[index]?.Text || "";
    const normalizedRaw = normalizeJapaneseTimedText(rawText);
    const normalizedText = normalizedRaw.trim();
    if (!normalizedRaw && !normalizedText) continue;

    const leading = normalizedRaw.match(/^\s+/)?.[0] || "";
    const trailing = normalizedRaw.match(/\s+$/)?.[0] || "";
    if (leading) {
      lineText = appendLineSpaceIfNeeded(lineText);
      sourceText = appendLineSpaceIfNeeded(sourceText);
    }

    const previousRaw = syllables[index - 1]?.Text || "";
    const previous = syllables[index - 1] as JapaneseReadable & { IsPartOfWord?: boolean };
    const providerBoundary = needsSyllableSpaceBefore(syllables, index);
    const packedJapaneseBoundary =
      hasWordContinuation &&
      previous?.IsPartOfWord === false &&
      JapaneseCharacterTest.test(lastCharacter(previousRaw.trim())) &&
      JapaneseCharacterTest.test(firstCharacter(normalizedText));
    const nextNeedsAnalysisSpace =
      !leading &&
      lineText &&
      (packedJapaneseBoundary ||
        (providerBoundary &&
          (LatinWordTextTest.test(previousRaw) || LatinWordTextTest.test(normalizedText))));
    if (nextNeedsAnalysisSpace) {
      lineText = appendLineSpaceIfNeeded(lineText);
      sourceText = appendLineSpaceIfNeeded(sourceText);
    }

    const start = sourceText.length;
    lineText += normalizedText;
    sourceText += rawText.trim();
    const end = sourceText.length;
    if (normalizedText) {
      spans.push({ index, rawText, normalizedText, start, end });
    }

    if (trailing) {
      lineText = appendLineSpaceIfNeeded(lineText);
      sourceText = appendLineSpaceIfNeeded(sourceText);
    }
  }

  return {
    sourceText: sourceText.replace(/\s+$/g, ""),
    lineText: lineText.replace(/\s+$/g, ""),
    spans,
  };
}
