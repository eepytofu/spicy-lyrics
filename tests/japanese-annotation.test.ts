import assert from "node:assert/strict";
import { test } from "node:test";
import { DefaultCanonicalLineBuilder } from "../src/utils/Lyrics/Processing/Canonical.ts";
import { annotateJapaneseLine } from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnnotationProcessor.ts";
import { DefaultRenderPlanBuilder } from "../src/utils/Lyrics/Processing/RenderPlan.ts";
import { prepareJapaneseLineAnalysis } from "../src/utils/Lyrics/Reading/JapaneseReading.ts";
import { timedFuriganaGroups } from "../src/utils/Lyrics/Processing/Japanese/TimedGroupIds.ts";

test("Japanese annotation keeps split spans as unique timing owners", async () => {
  const line = { id: "jp", displayText: "だんだん剥がれてく", paragraphProvenance: "lineBoundary" as const,
    spans: ["だん", "だん", "剥", "がれて", "く"].map((text, index) => ({ id: String(index), rawText: text,
      cleanText: text, startMs: index * 100, endMs: (index + 1) * 100, providerPartOfWord: true })) };
  const canonical = new DefaultCanonicalLineBuilder().build(line);
  const annotation = await annotateJapaneseLine(canonical, "dandan hagareteku");
  assert.ok(annotation);
  const plan = new DefaultRenderPlanBuilder().build(line, canonical, [annotation!]);
  assert.equal(plan.timedReadingUnits.length, 5);
  assert.equal(new Set(plan.timedReadingUnits.map((unit) => unit.spanId)).size, 5);
  assert.equal(plan.joinedDisplayText.length > 0, true);
});

test("Japanese furigana ranges are exported as code-point coordinates", async () => {
  const line = { id: "astral-jp", displayText: "😀今日", paragraphProvenance: "lineBoundary" as const,
    spans: [{ id: "0", rawText: "😀", cleanText: "😀", startMs: 0, endMs: 100, providerPartOfWord: true },
      { id: "1", rawText: "今日", cleanText: "今日", startMs: 100, endMs: 200, providerPartOfWord: false }] };
  const canonical = new DefaultCanonicalLineBuilder().build(line);
  const annotation = await annotateJapaneseLine(canonical, "😀 kyou");
  for (const segment of (annotation?.furigana || []) as any[]) {
    assert.ok(segment.canonicalRange.startCp >= 1);
    assert.ok(segment.canonicalRange.endCp <= 3);
  }
});

test("provider-authored reading keeps source evidence and emits explicit furigana", async () => {
  const reading = (await prepareJapaneseLineAnalysis(
    "今宵も天(そら)は明るく",
    "koyoi mo sora wa akaruku",
  ))?.reading;
  assert.ok(reading);
  assert.equal(reading!.sourceText, "今宵も天(そら)は明るく");
  assert.equal(reading!.displayText, "今宵も天は明るく");
  assert.match(reading!.romaji || "", /sora/);
  assert.equal(reading!.furigana.some((segment) =>
    segment.reading === "そら" && segment.provenance === "providerExplicit"
  ), true);
});

test("compound explicit provenance crosses timed syllables and reaches romaji owners", () => {
  const line = { id: "compound", displayText: "永久に", paragraphProvenance: "lineBoundary" as const,
    spans: ["永", "久", "に"].map((text, index) => ({ id: String(index), rawText: text,
      cleanText: text, startMs: index * 100, endMs: (index + 1) * 100, providerPartOfWord: true })) };
  const canonical = new DefaultCanonicalLineBuilder().build(line);
  const result = new DefaultRenderPlanBuilder().build(line, canonical, [{
    processor: "Japanese",
    mode: "romaji",
    provenance: "local",
    units: canonical.spanMappings.map((mapping, index) => ({
      canonicalRange: mapping.canonicalRange,
      text: index === 0 ? "towa" : index === 2 ? " ni" : "",
      kind: "transformed" as const,
      logicalGroupId: index < 2 ? "jp-explicit" : "jp-local",
      timingRefs: [mapping.spanId],
      ...(index === 0 ? { provenance: "providerExplicit" as const } : {}),
    })),
    furigana: [{
      canonicalRange: { startCp: 0, endCp: 2 },
      reading: "とわ",
      provenance: "providerExplicit",
    }],
  }]);
  assert.equal(new Set(result.timedReadingUnits.map((unit) => unit.spanId)).size, 3);
  assert.equal(result.timedReadingUnits[0].provenance, "providerExplicit");
  const groups = timedFuriganaGroups(result);
  assert.equal(groups.groups.length, 1);
  assert.equal(groups.groups[0].reading, "とわ");
  assert.equal(groups.groups[0].provenance, "providerExplicit");
});
