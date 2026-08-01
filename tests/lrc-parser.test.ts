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
