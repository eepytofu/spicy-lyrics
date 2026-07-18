import assert from "node:assert/strict";
import { test } from "node:test";
import { DefaultCanonicalLineBuilder } from "../src/utils/Lyrics/Processing/Canonical.ts";
import { timedFuriganaGroups, timedGroupContinuesAt } from "../src/utils/Lyrics/Processing/Japanese/TimedGroupIds.ts";
import type { ParsedLine } from "../src/utils/Lyrics/Processing/Model.ts";

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

function planFor(text: string, furigana: unknown[]) {
  const canonical = new DefaultCanonicalLineBuilder().build(charSpans(text));
  return { sourceUnits: canonical.spanMappings, furigana } as any;
}

test("crossing ruby groups every intersecting timed span", () => {
  const plan = planFor("運命だ", [
    { canonicalRange: { startCp: 0, endCp: 2 }, reading: "うんめい", provenance: "local" },
  ]);
  const result = timedFuriganaGroups(plan);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].spanIds, ["0", "1"]);
  assert.equal(result.groups[0].segmentKey, "0:2\u0000うんめい");
  assert.equal(result.groups[0].reading, "うんめい");
  assert.equal(result.groups[0].rubyCenterCh, 1);
  assert.equal(result.bySpanId.get("0"), result.groups[0]);
  assert.equal(result.bySpanId.get("1"), result.groups[0]);
  assert.equal(result.bySpanId.has("2"), false);
});

test("ruby centers over the annotated range inside oversized provider fragments", () => {
  // Real AMLL fragmenting: one timed span holds エーテル麻, the next holds 酔.
  const parsed: ParsedLine = {
    id: "t",
    displayText: "エーテル麻酔",
    paragraphProvenance: "unavailable",
    spans: [
      { id: "0", rawText: "エーテル麻", cleanText: "エーテル麻", startMs: 0, endMs: 1, providerPartOfWord: true },
      { id: "1", rawText: "酔", cleanText: "酔", startMs: 1, endMs: 2, providerPartOfWord: true },
    ],
  };
  const canonical = new DefaultCanonicalLineBuilder().build(parsed);
  const plan = {
    sourceUnits: canonical.spanMappings,
    furigana: [{ canonicalRange: { startCp: 4, endCp: 6 }, reading: "ますい", provenance: "local" }],
  } as any;
  const result = timedFuriganaGroups(plan);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].spanIds, ["0", "1"]);
  // 麻酔 starts 4 code points into the group, so the ruby midpoint sits at 5ch.
  assert.equal(result.groups[0].rubyCenterCh, 5);
});

test("ruby contained by one timed span creates no group", () => {
  const plan = planFor("華や", [
    { canonicalRange: { startCp: 0, endCp: 1 }, reading: "はな", provenance: "local" },
  ]);
  const result = timedFuriganaGroups(plan);
  assert.equal(result.groups.length, 0);
  assert.equal(result.bySpanId.size, 0);
});

test("malformed overlapping ruby never duplicates a timing owner", () => {
  const plan = planFor("運命だ", [
    { canonicalRange: { startCp: 0, endCp: 2 }, reading: "うんめい", provenance: "local" },
    { canonicalRange: { startCp: 1, endCp: 3 }, reading: "おかしい", provenance: "local" },
  ]);
  const result = timedFuriganaGroups(plan);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].reading, "うんめい");
});

test("accepts raw start/end shaped ruby and skips invalid segments", () => {
  const plan = planFor("運命だ", [
    { start: 0, end: 2, reading: "うんめい" },
    { start: 2, end: 2, reading: "empty-range" },
    { start: 2, reading: "missing-end" },
    { canonicalRange: { startCp: 0, endCp: 2 } },
  ]);
  const result = timedFuriganaGroups(plan);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].spanIds, ["0", "1"]);
});

test("group continues across whitespace-only syllables but not text", () => {
  const groups = {
    groups: [],
    bySpanId: new Map([
      ["0", { id: "timed-ruby-0", reading: "ますい", spanIds: ["0", "2"] }],
      ["2", { id: "timed-ruby-0", reading: "ますい", spanIds: ["0", "2"] }],
      ["5", { id: "timed-ruby-1", reading: "さいご", spanIds: ["5", "6"] }],
    ]),
  } as any;
  // 麻 [space] 酔: the space keeps the group open.
  assert.equal(timedGroupContinuesAt(["麻", " ", "酔"], groups, 2, "timed-ruby-0"), true);
  // Ordinary text between members closes the group.
  assert.equal(timedGroupContinuesAt(["麻", "の", "酔"], groups, 1, "timed-ruby-0"), false);
  // A different group id does not continue the current one.
  assert.equal(timedGroupContinuesAt(["麻", " ", "最", "後"], groups, 1, "timed-ruby-1"), false);
  // Trailing whitespace with no further member closes the group.
  assert.equal(timedGroupContinuesAt(["麻", " "], groups, 1, "timed-ruby-0"), false);
  assert.equal(timedGroupContinuesAt(["麻", " ", "酔"], groups, 2, undefined), false);
});

test("adjacent crossing rubies form separate consecutive groups", () => {
  const plan = planFor("運命最後", [
    { canonicalRange: { startCp: 0, endCp: 2 }, reading: "うんめい", provenance: "local" },
    { canonicalRange: { startCp: 2, endCp: 4 }, reading: "さいご", provenance: "local" },
  ]);
  const result = timedFuriganaGroups(plan);
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups[0].spanIds, ["0", "1"]);
  assert.deepEqual(result.groups[1].spanIds, ["2", "3"]);
  assert.notEqual(result.bySpanId.get("1"), result.bySpanId.get("2"));
});
