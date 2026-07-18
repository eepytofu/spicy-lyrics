import assert from "node:assert/strict";
import { test } from "node:test";
import { DefaultCanonicalLineBuilder } from "../src/utils/Lyrics/Processing/Canonical.ts";
import { DefaultRenderPlanBuilder } from "../src/utils/Lyrics/Processing/RenderPlan.ts";
import { annotateKoreanLine } from "../src/utils/Lyrics/Processing/Korean/KoreanAnnotationProcessor.ts";
import { romanizeCantonese } from "../src/utils/Lyrics/Fork/Romanization.ts";
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

test("render plan builder carries typed annotation furigana", () => {
  const parsed = charSpans("AB");
  const canonical = new DefaultCanonicalLineBuilder().build(parsed);
  const annotation: ReadingAnnotation = {
    processor: "Japanese",
    mode: "romaji",
    provenance: "local",
    units: canonical.spanMappings.map((mapping, index) => ({
      canonicalRange: mapping.canonicalRange,
      text: `u${index}`,
      kind: "transformed",
      logicalGroupId: `g${index}`,
      timingRefs: [mapping.spanId],
    })),
    furigana: [{ canonicalRange: { startCp: 0, endCp: 2 }, reading: "かな", provenance: "local" }],
  };
  const plan = new DefaultRenderPlanBuilder().build(parsed, canonical, [annotation]);
  assert.deepEqual(plan.furigana, annotation.furigana);
});

test("korean annotation stays aligned when normalization inserts whitespace", () => {
  const canonical = new DefaultCanonicalLineBuilder().build(charSpans("사랑합니다"));
  const annotation = annotateKoreanLine(canonical, "rrStandard");
  assert.equal(annotation.units.map((unit) => unit.text).join(""), "sarang hapnida");
  assert.deepEqual(
    annotation.units.map((unit) => unit.text),
    ["sa", "rang", " hap", "ni", "da"],
  );
});

test("jyutping tone strip preserves digits in passthrough latin tokens", async () => {
  assert.equal(await romanizeCantonese("唱 mp3 歌", "yue", true, false), "coeng mp3 go");
  assert.equal(await romanizeCantonese("唱歌", "yue", true, false), "coeng go");
});
