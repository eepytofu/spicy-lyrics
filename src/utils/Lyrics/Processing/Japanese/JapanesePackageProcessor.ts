import {
  annotateJapaneseTextTarget,
  applyJapaneseReadingToSyllables,
  type FuriganaSegment,
  type JapaneseAnalysisOptions,
  type JapaneseReadable,
  type JapaneseTimedTextSpan,
} from "../../Reading/JapaneseReading.ts";
import { DefaultCanonicalLineBuilder } from "../Canonical.ts";
import { annotateJapaneseLine } from "./JapaneseAnnotationProcessor.ts";
import { DefaultRenderPlanBuilder, validateRenderPlan } from "../RenderPlan.ts";
import type { ParsedLine, RenderPlan } from "../Model.ts";

export async function processJapanesePackageLine(
  displayText: string,
  syllables: JapaneseReadable[],
  spans: JapaneseTimedTextSpan[],
  times: Array<{ StartTime?: number; EndTime?: number }>,
  romajiPromise?: Promise<void>,
  options: JapaneseAnalysisOptions = {}
): Promise<{ plan: RenderPlan; romaji: string; furigana: FuriganaSegment[] }> {
  const reading = await applyJapaneseReadingToSyllables(displayText, undefined, syllables, romajiPromise, spans, options);
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
  const annotation = await annotateJapaneseLine(canonical, romaji, romajiPromise, options);
  if (!annotation) throw new Error("Japanese fallback annotation failed");
  const plan = new DefaultRenderPlanBuilder().build(parsed, canonical, [annotation]);
  const validation = validateRenderPlan(plan);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return { plan, romaji, furigana: reading?.furigana || [] };
}

export async function processJapanesePackageTextTarget(
  target: JapaneseReadable & { Text?: string },
  romajiPromise?: Promise<void>,
  options: JapaneseAnalysisOptions = {}
): Promise<string | undefined> {
  const reading = await annotateJapaneseTextTarget(target, undefined, romajiPromise, options);
  if (!reading?.romaji) return undefined;
  target.RomanizedText = reading.romaji;
  target.TransliteratedText = reading.romaji;
  return reading.romaji;
}
