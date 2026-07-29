import {
  annotateJapaneseTextTarget,
  applyJapaneseReadingToSyllables,
  prepareJapaneseLineAnalysis,
  type FuriganaSegment,
  type JapaneseAnalysisOptions,
  type JapaneseReadable,
  type JapaneseTimedTextSpan,
} from "../../Reading/JapaneseReading.ts";
import { buildCanonicalLine } from "../Canonical.ts";
import {
  projectProviderAuthoredJapaneseReadings,
  projectProviderSourceOffset,
} from "./ProviderAuthoredReading.ts";
import { annotateJapaneseLine } from "./JapaneseAnnotationProcessor.ts";
import { buildRenderPlan, validateRenderPlan } from "../RenderPlan.ts";
import type { ParsedLine, RenderPlan } from "../Model.ts";

export function buildJapanesePackageParsedLine(
  finalDisplayText: string,
  displaySpans: JapaneseTimedTextSpan[],
  times: Array<{ StartTime?: number; EndTime?: number }>,
): ParsedLine {
  return {
    id: `japanese-fallback-${times[0]?.StartTime || 0}`,
    displayText: finalDisplayText,
    paragraphProvenance: "unavailable",
    spans: displaySpans.map((span, index) => ({
      id: String(span.index),
      rawText: span.normalizedText,
      cleanText: span.normalizedText,
      startMs: Number(times[span.index]?.StartTime || 0),
      endMs: Number(times[span.index]?.EndTime || 0),
      // The structured providers encode word boundaries as literal whitespace
      // between timed spans. The canonical builder cannot see that whitespace
      // after each span has been sliced, so retain the authored gap as the
      // native trailing-boundary flag instead of inferring from character type.
      providerPartOfWord: !/\s/u.test(
        finalDisplayText.slice(span.end, displaySpans[index + 1]?.start ?? finalDisplayText.length),
      ),
    })),
  };
}

export async function processJapanesePackageLine(
  displayText: string,
  syllables: JapaneseReadable[],
  spans: JapaneseTimedTextSpan[],
  times: Array<{ StartTime?: number; EndTime?: number }>,
  options: JapaneseAnalysisOptions = {}
): Promise<{ plan: RenderPlan; romaji: string; furigana: FuriganaSegment[]; displayText: string }> {
  const projection = projectProviderAuthoredJapaneseReadings(displayText, spans);
  const projectedSpans = spans.map((span) => {
    const start = projectProviderSourceOffset(projection, span.start);
    const end = projectProviderSourceOffset(projection, span.end);
    return {
      ...span,
      normalizedText: projection.displayText.slice(start, end),
      start,
      end,
    };
  });
  const analysisOptions = { ...options, authoredReadingProjection: projection };
  const analysis = await prepareJapaneseLineAnalysis(displayText, analysisOptions);
  const reading = await applyJapaneseReadingToSyllables(
    displayText,
    syllables,
    projectedSpans,
    analysisOptions,
    analysis,
  );
  const romaji = reading?.romaji || syllables.map((entry) => entry.RomanizedText || entry.TransliteratedText || "").join(" ").trim();
  if (!romaji) throw new Error("Japanese fallback processor produced no reading");
  const finalDisplayText = reading?.displayText || projection.displayText;
  const displaySpans = projectedSpans.map((span) => ({
    ...span,
    normalizedText: finalDisplayText.slice(span.start, span.end),
  }));

  const parsed = buildJapanesePackageParsedLine(finalDisplayText, displaySpans, times);
  const canonical = buildCanonicalLine(parsed);
  const annotation = await annotateJapaneseLine(canonical, analysisOptions, analysis);
  if (!annotation) throw new Error("Japanese fallback annotation failed");
  const plan = buildRenderPlan(parsed, canonical, [annotation]);
  const validation = validateRenderPlan(plan);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return { plan, romaji, furigana: reading?.furigana || [], displayText: finalDisplayText };
}

export async function processJapanesePackageTextTarget(
  target: JapaneseReadable & { Text?: string },
  options: JapaneseAnalysisOptions = {}
): Promise<string | undefined> {
  const reading = await annotateJapaneseTextTarget(target, options);
  if (!reading?.romaji) return undefined;
  target.RomanizedText = reading.romaji;
  target.TransliteratedText = reading.romaji;
  return reading.romaji;
}
