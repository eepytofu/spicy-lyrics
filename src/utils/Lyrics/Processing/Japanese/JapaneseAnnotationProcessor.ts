import {
  applyJapaneseReadingToSyllables,
  prepareJapaneseLineAnalysis,
  type JapaneseAnalysisOptions,
  type PreparedJapaneseLineAnalysis,
  type JapaneseReadable,
} from "../../Reading/JapaneseReading.ts";
import { codePointOffsetToUtf16Index, codePointSlice, utf16IndexToCodePointOffset } from "../CodePoint.ts";
import type { CanonicalLine, ReadingAnnotation, ReadingUnit } from "../Model.ts";

export function alignJapaneseReadingUnitTexts(texts: string[], display: string): string[] {
  // A tokenizer can assign several tokens, including a literal whitespace
  // token, to one provider timing span. Normalize only that projection noise
  // before matching it back to the already-normalized full reading. The gaps
  // copied from `display` below remain the authoritative separators.
  const out = texts.map((text) => text.replace(/\s+/gu, " ").trim());
  let cursor = 0;
  for (let index = 0; index < out.length; index += 1) {
    const text = out[index];
    if (!text) continue;
    const found = display.indexOf(text, cursor);
    if (found < 0) return texts;
    out[index] = `${display.slice(cursor, found)}${text}`;
    cursor = found + text.length;
  }
  if (cursor < display.length) {
    const last = out.findLastIndex(Boolean);
    if (last >= 0) out[last] += display.slice(cursor);
  }
  return out;
}

export async function annotateJapaneseLine(
  canonical: CanonicalLine,
  fullRomaji?: string,
  romajiPromise?: Promise<void>,
  options: JapaneseAnalysisOptions = {},
  prepared?: PreparedJapaneseLineAnalysis
): Promise<ReadingAnnotation | undefined> {
  const analysis = (prepared?.reading.displayText || prepared?.reading.sourceText) === canonical.text
    ? prepared
    : await prepareJapaneseLineAnalysis(canonical.text, fullRomaji, romajiPromise, options);
  const reading = analysis?.reading;
  if (!reading?.romaji) return undefined;
  const temp: JapaneseReadable[] = canonical.spanMappings.map((mapping) => ({
    Text: codePointSlice(canonical.text, mapping.canonicalRange),
  }));
  const spans = canonical.spanMappings.map((mapping, index) => ({
    index,
    rawText: temp[index].Text || "",
    normalizedText: temp[index].Text || "",
    start: codePointOffsetToUtf16Index(canonical.text, mapping.canonicalRange.startCp),
    end: codePointOffsetToUtf16Index(canonical.text, mapping.canonicalRange.endCp),
  }));
  await applyJapaneseReadingToSyllables(
    canonical.text,
    reading.romaji,
    temp,
    romajiPromise,
    spans,
    options,
    analysis,
  );
  const aligned = alignJapaneseReadingUnitTexts(temp.map((entry) => entry.RomanizedText || entry.TransliteratedText ||
    (/\p{Script=Latin}/u.test(entry.Text || "") ? entry.Text || "" : "")), reading.romaji);
  if (!aligned.some(Boolean) && aligned.length > 0) aligned[0] = reading.romaji;
  let group = 0;
  const units: ReadingUnit[] = canonical.spanMappings.map((mapping, index) => {
    if (index > 0 && aligned[index]) group += 1;
    const source = temp[index].Text || "";
    const timingProjection = temp[index].JapaneseRomajiTiming;
    const animationTimingRefs = timingProjection?.animationSpanIndexes
      .map((spanIndex) => canonical.spanMappings[spanIndex]?.spanId)
      .filter((spanId): spanId is string => typeof spanId === "string");
    const animationRange = timingProjection && aligned[index]
      ? {
          startCp: utf16IndexToCodePointOffset(
            canonical.text,
            timingProjection.animationStart
          ),
          endCp: utf16IndexToCodePointOffset(
            canonical.text,
            timingProjection.animationEnd
          ),
        }
      : undefined;
    return {
      canonicalRange: mapping.canonicalRange,
      text: aligned[index],
      kind: /[぀-ヿ一-鿿]/u.test(source) ? "transformed" : "passthrough",
      logicalGroupId: timingProjection?.logicalGroupId || `jp-${group}`,
      timingRefs: [mapping.spanId],
      ...(animationTimingRefs && animationTimingRefs.length > 1
        ? { animationTimingRefs }
        : {}),
      ...(animationRange ? { animationRange } : {}),
      ...(temp[index].JapaneseReading?.romajiSegments?.some((segment) => segment.provenance === "providerExplicit")
        ? { provenance: "providerExplicit" as const }
        : {}),
    };
  });
  return {
    processor: "Japanese",
    mode: "romaji",
    provenance: "local",
    units,
    furigana: reading.furigana.map((segment) => ({
      canonicalRange: {
        startCp: utf16IndexToCodePointOffset(canonical.text, segment.start),
        endCp: utf16IndexToCodePointOffset(canonical.text, segment.end),
      },
      reading: segment.reading,
      provenance: segment.provenance || "local",
    })),
  };
}
