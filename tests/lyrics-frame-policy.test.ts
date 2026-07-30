import assert from "node:assert/strict";
import test from "node:test";

import {
  PausedAnimationSettleMs,
  shouldAnimateLyricsFrame,
} from "../src/utils/Lyrics/AnimationFramePolicy.ts";

test("lyrics animation remains live during playback", () => {
  assert.equal(shouldAnimateLyricsFrame(true, false, 10_000, 0), true);
});

test("paused lyrics settle briefly and then stop rendering unchanged frames", () => {
  const changedAt = 10_000;
  const animateThrough = changedAt + PausedAnimationSettleMs;

  assert.equal(shouldAnimateLyricsFrame(false, true, changedAt, 0), true);
  assert.equal(shouldAnimateLyricsFrame(false, false, animateThrough, animateThrough), true);
  assert.equal(shouldAnimateLyricsFrame(false, false, animateThrough + 1, animateThrough), false);
});
