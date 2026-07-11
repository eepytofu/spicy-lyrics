import assert from "node:assert/strict";
import { test } from "node:test";
import { furiganaContainedByTimingSpan } from "../src/utils/Lyrics/Processing/Japanese/JapanesePackageProcessor.ts";

test("compound ruby crossing timing fragments stays line-level", () => {
  const ruby = [{ start: 0, end: 2, reading: "おぼつか", source: "jmdict" as const }];
  assert.deepEqual(furiganaContainedByTimingSpan("覚束なく", { start: 0, end: 1 }, ruby), []);
  assert.deepEqual(furiganaContainedByTimingSpan("覚束なく", { start: 1, end: 4 }, ruby), []);
  assert.deepEqual(furiganaContainedByTimingSpan("覚束なく", { start: 0, end: 4 }, ruby), [{ start: 0, end: 2, reading: "おぼつか" }]);
});
