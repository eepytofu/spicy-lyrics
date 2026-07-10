import {
  loadBrowserJmdictFurigana,
  loadBrowserUniDicTokenizer,
  processJapaneseLine,
  type FuriganaSpan as PackageFuriganaSpan,
  type SourceSpan as PackageSourceSpan,
} from "japanese-lyrics-processor";
import type { JapaneseReadable, JapaneseTimedTextSpan } from "../../Reading/JapaneseReading.ts";
import type { RenderPlan } from "../Model.ts";

let dependencies: Promise<{ tokenizer: Awaited<ReturnType<typeof loadBrowserUniDicTokenizer>>; jmdict: Awaited<ReturnType<typeof loadBrowserJmdictFurigana>> }> | undefined;
const loadDependencies = () => dependencies ??= Promise.all([loadBrowserUniDicTokenizer(), loadBrowserJmdictFurigana()]).then(([tokenizer, jmdict]) => ({ tokenizer, jmdict }));
const cp = (text: string, utf16: number): number => Array.from(text.slice(0, utf16)).length;
const utf16 = (text: string, codePoints: number): number => Array.from(text).slice(0, codePoints).join("").length;

function providerFurigana(text: string, syllables: JapaneseReadable[], spans: JapaneseTimedTextSpan[]): PackageFuriganaSpan[] {
  const output: PackageFuriganaSpan[] = [];
  for (const span of spans) {
    const local = syllables[span.index]?.JapaneseReading?.furigana || [];
    for (const ruby of local) output.push({
      start: cp(text, span.start + ruby.start), end: cp(text, span.start + ruby.end), reading: ruby.reading, source: "provider",
    });
  }
  return output;
}

export async function processJapanesePackageLine(
  displayText: string,
  syllables: JapaneseReadable[],
  spans: JapaneseTimedTextSpan[],
  times: Array<{ StartTime?: number; EndTime?: number }>
): Promise<{ plan: RenderPlan; romaji: string }> {
  const { tokenizer, jmdict } = await loadDependencies();
  const sourceSpans: PackageSourceSpan[] = spans.map((span) => ({
    start: cp(displayText, span.start), end: cp(displayText, span.end), text: span.rawText, ownerId: String(span.index),
    beginMs: Number(times[span.index]?.StartTime || 0), endMs: Number(times[span.index]?.EndTime || 0),
  }));
  const result = await processJapaneseLine({ displayText, spans: sourceSpans, providerFurigana: providerFurigana(displayText, syllables, spans) }, { tokenizer, jmdict });
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  for (const span of spans) {
    const sourceStartCp = cp(displayText, span.start); const sourceEndCp = cp(displayText, span.end);
    const ruby = result.furigana.filter((item) => item.end > sourceStartCp && item.start < sourceEndCp).map((item) => ({
      start: utf16(displayText, Math.max(item.start, sourceStartCp)) - span.start,
      end: utf16(displayText, Math.min(item.end, sourceEndCp)) - span.start,
      reading: item.reading,
    }));
    syllables[span.index].JapaneseReading = { sourceText: syllables[span.index].Text || "", romaji: result.timedReadingUnits.find((unit) => unit.ownerId === String(span.index))?.romaji || "", furigana: ruby };
  }
  const timedReadingUnits = result.timedReadingUnits.map((unit, index) => ({
    spanId: unit.ownerId, canonicalRange: { startCp: unit.start, endCp: unit.end }, text: unit.romaji,
    logicalGroupId: result.layoutGroups.findIndex((group) => group.end > unit.start && group.start < unit.end) >= 0 ? `jp-${result.layoutGroups.findIndex((group) => group.end > unit.start && group.start < unit.end)}` : `jp-${index}`,
  }));
  const readingUnits = timedReadingUnits.map((unit) => ({ canonicalRange: unit.canonicalRange, text: unit.text, kind: "transformed" as const, logicalGroupId: unit.logicalGroupId, timingRefs: [unit.spanId] }));
  return {
    romaji: result.romaji,
    plan: { lineId: `japanese-package-${times[0]?.StartTime || 0}`, sourceUnits: sourceSpans.map((span) => ({ spanId: span.ownerId!, canonicalRange: { startCp: span.start, endCp: span.end } })), readingUnits, timedReadingUnits, joinedDisplayText: result.romaji, furigana: result.furigana },
  };
}
