import { buildCanonicalLine } from "./Canonical.ts";
import { buildRenderPlan, validateRenderPlan } from "./RenderPlan.ts";
import type { ParsedLine, ReadingAnnotation, ReadingProvenance, RenderPlan } from "./Model.ts";

function align(chunks: string[], display: string): string[] {
  const out = [...chunks];
  let cursor = 0;
  for (let index = 0; index < out.length; index += 1) {
    if (!out[index]) continue;
    const found = display.indexOf(out[index], cursor);
    if (found < 0) return chunks;
    out[index] = `${display.slice(cursor, found)}${out[index]}`;
    cursor = found + chunks[index].length;
  }
  if (cursor < display.length) {
    for (let index = out.length - 1; index >= 0; index -= 1) {
      if (out[index]) { out[index] += display.slice(cursor); break; }
    }
  }
  return out;
}

const PunctuationOnlyTest = /^[\p{Punctuation}\p{Symbol}]+$/u;
const CjkTextTest = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function contextualDisplayTokens(display: string, sourceTexts: string[]): string[] {
  const punctuationSpans: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;

  for (const sourceText of sourceTexts) {
    const literal = sourceText.trim();
    if (!literal) continue;
    const start = display.indexOf(literal, searchFrom);
    if (start < 0) continue;
    if (PunctuationOnlyTest.test(literal)) {
      punctuationSpans.push({ start, end: start + literal.length });
    } else if (CjkTextTest.test(literal)) {
      // Contextual readings replace CJK source text, so only passthrough text
      // can safely advance the literal search cursor.
      continue;
    }
    searchFrom = start + literal.length;
  }

  const tokens: string[] = [];
  const pushWords = (text: string): void => {
    tokens.push(...text.trim().split(/\s+/u).filter(Boolean));
  };
  let cursor = 0;
  for (const span of punctuationSpans) {
    pushWords(display.slice(cursor, span.start));
    tokens.push(display.slice(span.start, span.end));
    cursor = span.end;
  }
  pushWords(display.slice(cursor));
  return tokens;
}

function hasAuthoredWhitespaceBetween(sourceTexts: string[], left: number, right: number): boolean {
  if (/\s$/u.test(sourceTexts[left] || "") || /^\s/u.test(sourceTexts[right] || "")) return true;
  for (let index = left + 1; index < right; index += 1) {
    if (/\s/u.test(sourceTexts[index] || "")) return true;
  }
  return false;
}

type TimedGenericPlanOptions = {
  mandarinWordLayout?: {
    tokenCount: number;
    continuationTokenIndices: ReadonlySet<number>;
  };
  provenance?: ReadingProvenance;
};

type TimedReadingSyllable = {
  Text?: string;
  RomanizedText?: string;
  TransliteratedText?: string;
  StartTime?: number;
  EndTime?: number;
  IsPartOfWord?: boolean;
};

type TimedReadingGroup = {
  StartTime?: number;
  EndTime?: number;
  Syllables?: TimedReadingSyllable[];
};

function buildParsedTimedLine(
  group: TimedReadingGroup,
  processor: string,
): { parsed: ParsedLine; syllables: TimedReadingSyllable[] } | undefined {
  const syllables = group?.Syllables;
  if (!Array.isArray(syllables) || syllables.length === 0) return undefined;
  return {
    syllables,
    parsed: {
      id: `${processor}-${group.StartTime ?? 0}-${group.EndTime ?? 0}`,
      displayText: syllables.map((syllable) => syllable.Text || "").join(""),
      paragraphProvenance: "unavailable",
      spans: syllables.map((syllable, index) => ({
        id: String(index),
        rawText: syllable.Text || "",
        cleanText: syllable.Text || "",
        startMs: Number(syllable.StartTime || 0),
        endMs: Number(syllable.EndTime || 0),
        providerPartOfWord: syllable.IsPartOfWord === true,
      })),
    },
  };
}

function withTimedBoundaries(
  units: string[],
  sourceTexts: string[],
  suppressSpaceBefore: ReadonlySet<number> = new Set(),
): string[] {
  const output = [...units];
  let previousNonempty = -1;
  for (let index = 0; index < output.length; index += 1) {
    const unit = output[index];
    if (!unit) continue;
    if (previousNonempty >= 0) {
      const currentPunctuation = PunctuationOnlyTest.test((sourceTexts[index] || "").trim());
      const previousPunctuation = PunctuationOnlyTest.test((sourceTexts[previousNonempty] || "").trim());
      const authoredWhitespace = hasAuthoredWhitespaceBetween(sourceTexts, previousNonempty, index);
      const suppressInferredSpace = suppressSpaceBefore.has(index) && !authoredWhitespace;
      if (authoredWhitespace || (!suppressInferredSpace && !currentPunctuation && !previousPunctuation)) {
        output[index] = ` ${unit}`;
      }
    }
    previousNonempty = index;
  }
  return output;
}

function joinContextualTokens(
  tokens: string[],
  start: number,
  count: number,
  continuationTokenIndices: ReadonlySet<number>,
): string {
  let output = "";
  for (let index = start; index < start + count; index += 1) {
    if (index > start && !continuationTokenIndices.has(index)) output += " ";
    output += tokens[index] || "";
  }
  return output;
}

function alignChineseTimedUnits(
  chunks: string[],
  display: string,
  sourceTexts: string[],
  options: TimedGenericPlanOptions,
): string[] {
  const tokens = contextualDisplayTokens(display, sourceTexts);
  const wordLayout = options.mandarinWordLayout;
  const continuationTokenIndices = wordLayout?.tokenCount === tokens.length
    ? wordLayout.continuationTokenIndices
    : new Set<number>();

  if (tokens.length === chunks.length) {
    return withTimedBoundaries(tokens, sourceTexts, continuationTokenIndices);
  }

  const chunkTokenCounts = chunks.map(
    (chunk) => chunk.trim().split(/\s+/u).filter(Boolean).length,
  );
  const timedTokenCount = chunkTokenCounts.reduce((sum, count) => sum + count, 0);
  if (timedTokenCount === tokens.length) {
    // A provider span can own several reading tokens, such as a Han character plus punctuation.
    // Reuse that token geometry while taking pronunciation from the contextual full-line pass.
    let cursor = 0;
    const suppressSpaceBeforeChunks = new Set<number>();
    const contextualChunks = chunkTokenCounts.map((count, chunkIndex) => {
      if (continuationTokenIndices.has(cursor)) suppressSpaceBeforeChunks.add(chunkIndex);
      const chunk = joinContextualTokens(tokens, cursor, count, continuationTokenIndices);
      cursor += count;
      return chunk;
    });
    return withTimedBoundaries(contextualChunks, sourceTexts, suppressSpaceBeforeChunks);
  }

  return align(chunks, display);
}

export function buildTimedGenericPlan(
  group: TimedReadingGroup,
  display: string,
  processor: string,
  options: TimedGenericPlanOptions = {},
): RenderPlan | undefined {
  if (!display) return undefined;
  const timedLine = buildParsedTimedLine(group, processor);
  if (!timedLine) return undefined;
  const { parsed, syllables } = timedLine;
  const canonical = buildCanonicalLine(parsed);
  const rawChunks = syllables.map((syllable) =>
    (syllable.RomanizedText || syllable.TransliteratedText || syllable.Text || "").trim()
  );
  const sourceTexts = syllables.map((syllable) => syllable.Text || "");
  const chunks = processor === "Chinese"
    ? alignChineseTimedUnits(rawChunks, display, sourceTexts, options)
    : align(rawChunks, display);
  const provenance = options.provenance || "local";
  const annotation: ReadingAnnotation = { processor, mode: provenance, provenance,
    units: canonical.spanMappings.map((mapping, index) => ({ canonicalRange: mapping.canonicalRange,
      text: chunks[index], kind: chunks[index].trim() === (syllables[index].Text || "").trim() ? "passthrough" : "transformed",
      logicalGroupId: `generic-${index}`, timingRefs: [mapping.spanId], provenance })) };
  const plan = buildRenderPlan(parsed, canonical, [annotation]);
  if (!validateRenderPlan(plan).valid) return undefined;
  return processor === "Chinese" ? { ...plan, primaryScript: "Chinese" } : plan;
}

export function buildTimedContextReadingPlan(
  group: TimedReadingGroup,
  display: string,
  processor: string,
  provenance: ReadingProvenance = "local",
): RenderPlan | undefined {
  if (!display) return undefined;
  const timedLine = buildParsedTimedLine(group, processor);
  if (!timedLine) return undefined;
  const { parsed } = timedLine;
  const canonical = buildCanonicalLine(parsed);
  const timingRefs = parsed.spans.map((span) => span.id);
  const annotation: ReadingAnnotation = {
    processor,
    mode: provenance,
    provenance,
    units: [{
      canonicalRange: { startCp: 0, endCp: Array.from(canonical.text).length },
      text: display,
      kind: "transformed",
      logicalGroupId: `${processor}-context`,
      // The sidecar is one visual unit owned by the first timed span. Its
      // animation window still covers every source timing owner.
      timingRefs: [timingRefs[0]],
      animationTimingRefs: timingRefs,
      provenance,
    }],
  };
  const plan = buildRenderPlan(parsed, canonical, [annotation]);
  return validateRenderPlan(plan).valid ? plan : undefined;
}

export function buildLineFallbackPlan(source: string, display: string, id: string): RenderPlan {
  const parsed: ParsedLine = { id, displayText: source, paragraphProvenance: "lineBoundary",
    spans: [{ id: "line", rawText: source, cleanText: source, startMs: 0, endMs: 0, providerPartOfWord: false }] };
  const canonical = buildCanonicalLine(parsed);
  const annotation: ReadingAnnotation = { processor: "Fallback", mode: "line", provenance: "provider",
    units: [{ canonicalRange: { startCp: 0, endCp: Array.from(canonical.text).length }, text: display,
      kind: "transformed", logicalGroupId: "line", timingRefs: [] }] };
  return buildRenderPlan(parsed, canonical, [annotation]);
}
