import assert from "node:assert/strict";
import { test } from "node:test";
import { DefaultCanonicalLineBuilder } from "../src/utils/Lyrics/Processing/Canonical.ts";
import { DefaultRenderPlanBuilder } from "../src/utils/Lyrics/Processing/RenderPlan.ts";
import { annotateKoreanLine } from "../src/utils/Lyrics/Processing/Korean/KoreanAnnotationProcessor.ts";
import type { ParsedLine, ReadingAnnotation } from "../src/utils/Lyrics/Processing/Model.ts";

function charSpans(text: string): ParsedLine {
  return {
    id: "t",
    displayText: text,
    paragraphProvenance: "unavailable",
    spans: Array.from(text).map((ch, i) => ({
      id: String(i),
      rawText: ch,
      cleanText: ch,
      startMs: i,
      endMs: i + 1,
      providerPartOfWord: true,
    })),
  };
}

test("render plan builder carries annotation furigana", () => {
  const parsed = charSpans("AB");
  const canonical = new DefaultCanonicalLineBuilder().build(parsed);
  const annotation: ReadingAnnotation = {
    processor: "Japanese",
    mode: "romaji",
    provenance: "local",
    units: canonical.spanMappings.map((m, i) => ({
      canonicalRange: m.canonicalRange,
      text: `u${i}`,
      kind: "transformed",
      logicalGroupId: `g${i}`,
      timingRefs: [m.spanId],
    })),
    furigana: [{ canonicalRange: { startCp: 0, endCp: 2 }, reading: "かな", provenance: "local" }],
  };
  const plan = new DefaultRenderPlanBuilder().build(parsed, canonical, [annotation]);
  assert.equal(plan.furigana?.length, 1);
});

test("crossing-ruby detection accepts annotation-shaped furigana", async () => {
  // ReadingRenderer touches Spicetify/DOM globals at import time — stub them.
  (globalThis as any).Spicetify = { LocalStorage: { get: () => null, set: () => {}, remove: () => {} } };
  (globalThis as any).MutationObserver = class { observe() {} disconnect() {} };
  (globalThis as any).document = {
    querySelector: () => null,
    documentElement: { classList: { contains: () => false } },
    createElement: () => ({ classList: { add() {}, toggle() {} }, appendChild() {}, append() {}, style: {}, dataset: {} }),
  };
  const { hasFuriganaCrossingTimedUnits } = await import("../src/utils/Lyrics/Applyer/ReadingRenderer.ts");
  const parsed = charSpans("AB");
  const canonical = new DefaultCanonicalLineBuilder().build(parsed);
  const plan: any = {
    sourceUnits: canonical.spanMappings,
    furigana: [{ canonicalRange: { startCp: 0, endCp: 2 }, reading: "かな" }],
  };
  assert.equal(hasFuriganaCrossingTimedUnits(plan), true);
  const contained: any = {
    sourceUnits: canonical.spanMappings,
    furigana: [{ canonicalRange: { startCp: 0, endCp: 1 }, reading: "か" }],
  };
  assert.equal(hasFuriganaCrossingTimedUnits(contained), false);
});

test("korean annotation stays aligned when normalization inserts whitespace", () => {
  // One 5-syllable word with no canonical spaces: the readability splitter
  // inserts a space ("사랑 합니다"), which used to shift every later unit.
  const canonical = new DefaultCanonicalLineBuilder().build(charSpans("사랑합니다"));
  const annotation = annotateKoreanLine(canonical, "rrStandard");
  assert.equal(annotation.units.map((u) => u.text).join(""), "sarang hapnida");
  assert.deepEqual(
    annotation.units.map((u) => u.text),
    ["sa", "rang", " hap", "ni", "da"],
  );
});
