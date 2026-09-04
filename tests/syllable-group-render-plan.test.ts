import assert from "node:assert/strict";
import { test } from "node:test";
import type { TimedSyllableGroup } from "../src/utils/Lyrics/Reading/JapaneseReading.ts";

const storage = new Map<string, string>();
(globalThis as any).Spicetify = {
  LocalStorage: {
    get: (key: string) => storage.get(key) ?? null,
    set: (key: string, value: string) => storage.set(key, value),
  },
};
(globalThis as any).document = { querySelector: () => null };
(globalThis as any).MutationObserver = class {
  observe() {}
  disconnect() {}
};

const { prepareSyllableGroupRenderPlan } =
  await import("../src/utils/Lyrics/Applyer/Synced/SyllableGroupRenderPlan.ts");
const { $japaneseReadingMode, $pinyinPlacement, $chineseTranslitMode } =
  await import("../src/utils/uiState.ts");

// Constructed rendering-contract fixtures, not evidence for linguistic accuracy.
const basic = (): TimedSyllableGroup => ({
  StartTime: 1,
  EndTime: 3,
  Syllables: [
    { Text: "hello", StartTime: 1, EndTime: 2, IsPartOfWord: false },
    { Text: "世界", StartTime: 2, EndTime: 2, IsPartOfWord: false },
  ],
});

test("group planning preserves source references, zero-duration timing, and exact sidecar text", () => {
  const group = basic();
  group.RomanizedText = "  authored reading!  ";
  const before = structuredClone(group);
  const plan = prepareSyllableGroupRenderPlan(group, { useRomanized: false });
  assert.equal(plan.sourceText, "hello 世界");
  assert.equal(plan.romanizedText, "  authored reading!  ");
  assert.deepEqual(plan.texts, ["hello", "世界"]);
  assert.equal(plan.words[0].syllable, group.Syllables[0]);
  assert.deepEqual(plan.words[1].timing, { startTime: 2000, endTime: 2000, totalDuration: 0 });
  assert.deepEqual(
    plan.words.map((word) => word.readingRow),
    [{ kind: "none" }, { kind: "none" }]
  );
  assert.deepEqual(group, before);
});

test("a group reserves Furigana beside real ruby and respects Pure and Romaji modes", () => {
  const group = basic();
  group.Syllables[1].JapaneseReading = {
    sourceText: "世界",
    romaji: "sekai",
    furigana: [{ start: 0, end: 2, reading: "せかい" }],
  };
  $japaneseReadingMode.set("both");
  const options = { useRomanized: true, isJapaneseLyrics: true };
  const plan = prepareSyllableGroupRenderPlan(group, options);
  assert.deepEqual(
    plan.words.map((word) => word.readingRow),
    [
      { kind: "furigana", state: "reserved" },
      { kind: "furigana", state: "rendered" },
    ]
  );
  for (const mode of ["pure", "romaji"] as const) {
    $japaneseReadingMode.set("romaji");
    const result = prepareSyllableGroupRenderPlan(group, {
      ...options,
      useRomanized: mode !== "pure",
    });
    assert.ok(result.words.every((word) => word.readingRow.kind === "none"));
    assert.equal(result.timedRubyLookup.bySpanId.size, 0);
  }
});

test("pending Pinyin Above rows and RTL remain group-owned", () => {
  const group = basic();
  group.Syllables[0].Text = "مرحبا";
  $chineseTranslitMode.set("pinyin");
  $pinyinPlacement.set("above");
  const plan = prepareSyllableGroupRenderPlan(group, {
    useRomanized: true,
    chineseDocument: true,
    romanizationPending: true,
  });
  assert.equal(plan.hasRtl, true);
  assert.ok(
    plan.words.every(
      (word) => word.readingRow.kind === "pinyinAbove" && word.readingRow.state === "pending"
    )
  );
});

test("Above precedence cannot accidentally create Furigana sweep owners", () => {
  $chineseTranslitMode.set("pinyin");
  $pinyinPlacement.set("above");
  $japaneseReadingMode.set("both");
  const above = {
    canonicalRange: { startCp: 0, endCp: 1 },
    reading: "reading",
    kind: "mandarinPinyin",
    provenance: "local",
  };
  const readingPlan = {
    primaryScript: "Chinese",
    sourceUnits: [0, 1].map((index) => ({
      spanId: String(index),
      canonicalRange: { startCp: index, endCp: index + 1 },
    })),
    furigana: [
      { canonicalRange: { startCp: 0, endCp: 2 }, reading: "constructed", provenance: "local" },
    ],
    aboveReadingSegments: [above, { ...above, canonicalRange: { startCp: 1, endCp: 2 } }],
  };
  const group = {
    StartTime: 1,
    EndTime: 2,
    ReadingRenderPlan: readingPlan,
    JapaneseReading: {
      sourceText: "世界",
      romaji: "constructed",
      furigana: [{ start: 0, end: 2, reading: "constructed" }],
    },
    Syllables: ["世", "界"].map((Text, index) => ({
      Text,
      StartTime: 1 + index * 0.5,
      EndTime: 1.5 + index * 0.5,
      ReadingPrimaryScript: "Chinese",
      ReadingRenderPlan: { primaryScript: "Chinese", aboveReadingSegments: [above] },
      JapaneseReading: {
        sourceText: Text,
        romaji: "constructed",
        furigana: [{ start: 0, end: 1, reading: "constructed" }],
      },
    })),
  } as unknown as TimedSyllableGroup;
  const plan = prepareSyllableGroupRenderPlan(group, { useRomanized: true });
  assert.ok(plan.words.every((word) => word.readingRow.kind === "pinyinAbove"));
  assert.equal(plan.timedRubyLookup.bySpanId.size, 0);
  assert.ok(plan.words.every((word) => !word.timedFuriganaBaseSweepRange));
});
