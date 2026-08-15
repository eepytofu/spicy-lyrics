import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLrcDocument } from "../src/utils/Lyrics/LrcParser.ts";

test("LRC parsing consumes only leading timestamps and preserves bracketed lyrics", () => {
  const parsed = parseLrcDocument([
    "[ar:Artist]",
    "[00:01.250][00:02.500][Chorus] hello",
    "plain [bridge] text",
  ].join("\n"));

  assert.deepEqual(parsed.synced, [
    { text: "[Chorus] hello", startTimeMs: 1250 },
    { text: "[Chorus] hello", startTimeMs: 2500 },
  ]);
  assert.deepEqual(parsed.plain, ["plain [bridge] text"]);
});

test("LRC parsing applies offsets, clamps negative times, and sorts output", () => {
  const parsed = parseLrcDocument([
    "[offset:-500]",
    "[00:02.000]later",
    "[00:00.250]first",
  ].join("\n"));

  assert.deepEqual(parsed.synced, [
    { text: "first", startTimeMs: 0 },
    { text: "later", startTimeMs: 1500 },
  ]);
  assert.deepEqual(parsed.plain, []);
});

test("LRC parsing accepts provider colon-separated centiseconds", () => {
  const parsed = parseLrcDocument("[00:23:71]colon fraction\n[00:24.125]decimal fraction");

  assert.deepEqual(parsed.synced, [
    { text: "colon fraction", startTimeMs: 23_710 },
    { text: "decimal fraction", startTimeMs: 24_125 },
  ]);
});

test("enhanced LRC preserves authored word timing, whitespace, and zero-duration text", () => {
  const parsed = parseLrcDocument([
    "[offset:100]",
    "[00:01.00]<00:01.00>A<00:01.25> <00:01.25>B<00:01.25>!<00:02.00>",
  ].join("\n"), 4_000);

  assert.deepEqual(parsed.synced, [{ text: "A B!", startTimeMs: 1_100 }]);
  assert.deepEqual(parsed.enhanced, [{
    startTimeMs: 1_100,
    endTimeMs: 2_100,
    words: [
      { text: "A", startTimeMs: 1_100, endTimeMs: 1_350, isPartOfWord: false },
      { text: " ", startTimeMs: 1_350, endTimeMs: 1_350, isPartOfWord: true },
      { text: "B", startTimeMs: 1_350, endTimeMs: 1_350, isPartOfWord: true },
      { text: "!", startTimeMs: 1_350, endTimeMs: 2_100, isPartOfWord: true },
    ],
  }]);
});
