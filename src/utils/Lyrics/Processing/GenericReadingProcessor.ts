import { DefaultCanonicalLineBuilder } from "./Canonical.ts";
import { DefaultRenderPlanBuilder, validateRenderPlan } from "./RenderPlan.ts";
import type { ParsedLine, ReadingAnnotation, RenderPlan } from "./Model.ts";

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

function alignChineseTimedUnits(chunks: string[], display: string): string[] {
  const tokens = display.trim().split(/\s+/u).filter(Boolean);
  const withTimedBoundaries = (units: string[]) => units.map(
    (unit, index) => index === 0 || !unit ? unit : ` ${unit}`,
  );

  if (tokens.length === chunks.length) return withTimedBoundaries(tokens);

  const chunkTokenCounts = chunks.map(
    (chunk) => chunk.trim().split(/\s+/u).filter(Boolean).length,
  );
  const timedTokenCount = chunkTokenCounts.reduce((sum, count) => sum + count, 0);
  if (timedTokenCount === tokens.length) {
    // A provider span can own several reading tokens, such as a Han character plus punctuation.
    // Reuse that token geometry while taking pronunciation from the contextual full-line pass.
    let cursor = 0;
    const contextualChunks = chunkTokenCounts.map((count) => {
      const chunk = tokens.slice(cursor, cursor + count).join(" ");
      cursor += count;
      return chunk;
    });
    return withTimedBoundaries(contextualChunks);
  }

  return align(chunks, display);
}

export function buildTimedGenericPlan(group: any, display: string, processor: string): RenderPlan | undefined {
  const syllables = group?.Syllables;
  if (!Array.isArray(syllables) || syllables.length === 0 || !display) return undefined;
  const parsed: ParsedLine = { id: `${processor}-${group.StartTime ?? 0}-${group.EndTime ?? 0}`,
    displayText: syllables.map((s: any) => s.Text || "").join(""), paragraphProvenance: "unavailable",
    spans: syllables.map((s: any, i: number) => ({ id: String(i), rawText: s.Text || "", cleanText: s.Text || "",
      startMs: Number(s.StartTime || 0), endMs: Number(s.EndTime || 0), providerPartOfWord: s.IsPartOfWord === true })) };
  const canonical = new DefaultCanonicalLineBuilder().build(parsed);
  const rawChunks = syllables.map((s: any) => (s.RomanizedText || s.TransliteratedText || s.Text || "").trim());
  const chunks = processor === "Chinese"
    ? alignChineseTimedUnits(rawChunks, display)
    : align(rawChunks, display);
  const annotation: ReadingAnnotation = { processor, mode: "local", provenance: "local",
    units: canonical.spanMappings.map((mapping, index) => ({ canonicalRange: mapping.canonicalRange,
      text: chunks[index], kind: chunks[index].trim() === (syllables[index].Text || "").trim() ? "passthrough" : "transformed",
      logicalGroupId: `generic-${index}`, timingRefs: [mapping.spanId] })) };
  const plan = new DefaultRenderPlanBuilder().build(parsed, canonical, [annotation]);
  if (!validateRenderPlan(plan).valid) return undefined;
  return processor === "Chinese" ? { ...plan, primaryScript: "Chinese" } : plan;
}

export function buildLineFallbackPlan(source: string, display: string, id: string): RenderPlan {
  const parsed: ParsedLine = { id, displayText: source, paragraphProvenance: "lineBoundary",
    spans: [{ id: "line", rawText: source, cleanText: source, startMs: 0, endMs: 0, providerPartOfWord: false }] };
  const canonical = new DefaultCanonicalLineBuilder().build(parsed);
  const annotation: ReadingAnnotation = { processor: "Fallback", mode: "line", provenance: "provider",
    units: [{ canonicalRange: { startCp: 0, endCp: Array.from(canonical.text).length }, text: display,
      kind: "transformed", logicalGroupId: "line", timingRefs: [] }] };
  return new DefaultRenderPlanBuilder().build(parsed, canonical, [annotation]);
}
