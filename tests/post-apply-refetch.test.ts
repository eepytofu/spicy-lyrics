import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRefetchAfterApply } from "../src/utils/Lyrics/PostApplyRefetch.ts";

const CURRENT_URI = "spotify:track:current";

test("post-apply recovery leaves matching lyric state alone", () => {
  assert.equal(shouldRefetchAfterApply(JSON.stringify({ uri: CURRENT_URI }), CURRENT_URI), false);
  assert.equal(shouldRefetchAfterApply(`NO_LYRICS:${CURRENT_URI}`, CURRENT_URI), false);
});

test("post-apply recovery refetches mismatched sentinels and documents", () => {
  assert.equal(shouldRefetchAfterApply("NO_LYRICS:spotify:track:old", CURRENT_URI), true);
  assert.equal(
    shouldRefetchAfterApply(JSON.stringify({ uri: "spotify:track:old" }), CURRENT_URI),
    true,
  );
});

test("post-apply recovery treats malformed stored JSON as stale", () => {
  assert.equal(shouldRefetchAfterApply("{broken", CURRENT_URI), true);
  assert.equal(shouldRefetchAfterApply("", CURRENT_URI), false);
  assert.equal(shouldRefetchAfterApply("{broken", null), false);
});
