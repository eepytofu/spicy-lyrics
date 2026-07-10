import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultCanonicalLineBuilder } from "../src/utils/Lyrics/Processing/Canonical.ts";
import {
  annotateKoreanLine,
  joinReadingUnits,
} from "../src/utils/Lyrics/Processing/Korean/KoreanAnnotationProcessor.ts";
import { romanizeKoreanForDisplay, type KoreanDisplayMode } from "../src/utils/Lyrics/Fork/Romanization.ts";
import type { ParsedLine } from "../src/utils/Lyrics/Processing/Model.ts";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL(
  "./fixtures/lyrics-reading/v1/camouflage-provider.json", import.meta.url
)), "utf8"));

function parsedLine(raw: any): ParsedLine {
  return { id: raw.id, displayText: raw.expected.canonicalText, paragraphProvenance: "unavailable",
    spans: raw.spans.map((s: any[], i: number) => ({ id: `${raw.id}-s${i}`, rawText: s[0], cleanText: s[0],
      providerPartOfWord: s[1], startMs: s[2], endMs: s[3] })) };
}

test("Korean annotation derives joined display from timed units in all modes", () => {
  const builder = new DefaultCanonicalLineBuilder();
  const modes: KoreanDisplayMode[] = ["wordTranslit", "rrStandard", "rrPronunciation", "vnPronunciation"];
  for (const raw of fixture.lines.filter((line: any) => /[가-힯]/u.test(line.expected.canonicalText))) {
    const canonical = builder.build(parsedLine(raw));
    for (const mode of modes) {
      const annotation = annotateKoreanLine(canonical, mode);
      assert.equal(joinReadingUnits(annotation), romanizeKoreanForDisplay(canonical.text, mode).display, `${raw.id}:${mode}`);
      assert.deepEqual(annotation.units.flatMap((unit) => unit.timingRefs), canonical.spanMappings.map((m) => m.spanId));
    }
  }
});

test("mixed English is typed passthrough and remains source ordered", () => {
  const raw = fixture.lines.find((line: any) => line.id === "camouflage-29");
  const annotation = annotateKoreanLine(new DefaultCanonicalLineBuilder().build(parsedLine(raw)), "vnPronunciation");
  assert.equal(joinReadingUnits(annotation), "jujo op-ssi da, Probably delete it");
  assert.deepEqual(annotation.units.slice(-3).map((unit) => [unit.kind, unit.text.trim()]), [
    ["passthrough", "Probably"], ["passthrough", "delete"], ["passthrough", "it"],
  ]);
});
