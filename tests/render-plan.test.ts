import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultCanonicalLineBuilder } from "../src/utils/Lyrics/Processing/Canonical.ts";
import { annotateKoreanLine } from "../src/utils/Lyrics/Processing/Korean/KoreanAnnotationProcessor.ts";
import { DefaultRenderPlanBuilder, validateRenderPlan } from "../src/utils/Lyrics/Processing/RenderPlan.ts";
import type { ParsedLine } from "../src/utils/Lyrics/Processing/Model.ts";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL(
  "./fixtures/lyrics-reading/v1/camouflage-provider.json", import.meta.url
)), "utf8"));

function parsed(raw: any): ParsedLine {
  return { id: raw.id, displayText: raw.expected.canonicalText, paragraphProvenance: "unavailable",
    spans: raw.spans.map((s: any[], i: number) => ({ id: `${raw.id}-s${i}`, rawText: s[0], cleanText: s[0],
      providerPartOfWord: s[1], startMs: s[2], endMs: s[3] })) };
}

test("render plan gives every provider span one unique timing owner", () => {
  const raw = fixture.lines.find((line: any) => line.id === "camouflage-29");
  const line = parsed(raw);
  const canonical = new DefaultCanonicalLineBuilder().build(line);
  const plan = new DefaultRenderPlanBuilder().build(line, canonical, [annotateKoreanLine(canonical, "vnPronunciation")]);
  assert.equal(plan.joinedDisplayText, "jujo op-ssi da, Probably delete it");
  assert.equal(plan.timedReadingUnits.length, line.spans.length);
  assert.equal(new Set(plan.timedReadingUnits.map((unit) => unit.spanId)).size, line.spans.length);
  assert.equal(validateRenderPlan(plan).valid, true);
});
