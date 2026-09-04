import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PausedAnimationSettleMs,
  shouldAnimateLyricsFrame,
} from "../src/utils/Lyrics/AnimationFramePolicy.ts";

const lyricsLoopSource = readFileSync(
  new URL("../src/utils/Lyrics/lyrics.ts", import.meta.url),
  "utf8"
);

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

test("lyrics loop exposes a bounded settle request for newly mounted lines", () => {
  assert.match(lyricsLoopSource, /export function requestPausedAnimationSettle\(\): void/u);
});
