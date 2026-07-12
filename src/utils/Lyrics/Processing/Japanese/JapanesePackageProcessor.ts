import {
  annotateJapaneseTextTarget,
  applyJapaneseReadingToSyllables,
  type FuriganaSegment,
  type JapaneseReadable,
  type JapaneseTimedTextSpan,
} from "../../Reading/JapaneseReading.ts";
import { DefaultCanonicalLineBuilder } from "../Canonical.ts";
import { annotateJapaneseLine } from "./JapaneseAnnotationProcessor.ts";
import { DefaultRenderPlanBuilder, validateRenderPlan } from "../RenderPlan.ts";
import type { ParsedLine, RenderPlan } from "../Model.ts";

function codePointsBefore(text: string, utf16Index: number): number {
  return Array.from(text.slice(0, utf16Index)).length;
}

/** Kept for the package-era acceptance test; the fallback uses UTF-16 source spans. */
export function furiganaContainedByTimingSpan(
  displayText: string,
  timingSpan: Pick<JapaneseTimedTextSpan, "start" | "end">,
  furigana: Array<FuriganaSegment | { start: number; end: number; reading: string }>
): Array<{ start: number; end: number; reading: string }> {
  const sourceStartCp = codePointsBefore(displayText, timingSpan.start);
  const sourceEndCp = codePointsBefore(displayText, timingSpan.end);
  return furigana.flatMap((item) => {
    const startCp = codePointsBefore(displayText, item.start);
    const endCp = codePointsBefore(displayText, item.end);
    if (startCp < sourceStartCp || endCp > sourceEndCp) return [];
    return [{ start: item.start - timingSpan.start, end: item.end - timingSpan.start, reading: item.reading }];
  });
}

export async function processJapanesePackageLine(
  displayText: string,
  syllables: JapaneseReadable[],
  spans: JapaneseTimedTextSpan[],
  times: Array<{ StartTime?: number; EndTime?: number }>,
  romajiPromise?: Promise<void>
): Promise<{ plan: RenderPlan; romaji: string }> {
  const reading = await applyJapaneseReadingToSyllables(displayText, undefined, syllables, romajiPromise, spans);
  const romaji = reading?.romaji || syllables.map((entry) => entry.RomanizedText || entry.TransliteratedText || "").join(" ").trim();
  if (!romaji) throw new Error("Japanese fallback processor produced no reading");

  const parsed: ParsedLine = {
    id: `japanese-fallback-${times[0]?.StartTime || 0}`,
    displayText,
    paragraphProvenance: "unavailable",
    spans: spans.map((span) => ({
      id: String(span.index),
      rawText: span.rawText,
      cleanText: span.normalizedText,
      startMs: Number(times[span.index]?.StartTime || 0),
      endMs: Number(times[span.index]?.EndTime || 0),
      providerPartOfWord: true,
    })),
  };
  const canonical = new DefaultCanonicalLineBuilder().build(parsed);
  const annotation = await annotateJapaneseLine(canonical, romaji, romajiPromise);
  if (!annotation) throw new Error("Japanese fallback annotation failed");
  const plan = new DefaultRenderPlanBuilder().build(parsed, canonical, [annotation]);
  const validation = validateRenderPlan(plan);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return { plan, romaji };
}

export async function processJapanesePackageTextTarget(
  target: JapaneseReadable & { Text?: string },
  romajiPromise?: Promise<void>
): Promise<string | undefined> {
  const reading = await annotateJapaneseTextTarget(target, undefined, romajiPromise);
  if (!reading?.romaji) return undefined;
  target.RomanizedText = reading.romaji;
  target.TransliteratedText = reading.romaji;
  return reading.romaji;
}
