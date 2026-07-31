import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PausedAnimationSettleMs,
  shouldAnimateLyricsFrame,
} from "../src/utils/Lyrics/AnimationFramePolicy.ts";

const animatorSource = readFileSync(
  new URL("../src/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts", import.meta.url),
  "utf8",
);
const lyricsLoopSource = readFileSync(
  new URL("../src/utils/Lyrics/lyrics.ts", import.meta.url),
  "utf8",
);
const virtualizerSource = readFileSync(
  new URL("../src/utils/Lyrics/LyricsVirtualizer.ts", import.meta.url),
  "utf8",
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

test("mounted virtualized lines invalidate stale paint before bounded paused settle", () => {
  assert.match(
    animatorSource,
    /setOnNewElementMounted\(\(mountedWrappers\)\s*=>\s*\{[\s\S]*?invalidateMountedStyleCache\(wrapper\)[\s\S]*?syllableLinePaintStates\.delete\(line\)[\s\S]*?applyLineState\(line,\s*"NotSung"\)[\s\S]*?requestPausedAnimationSettle\(\)/u,
  );
  assert.match(
    lyricsLoopSource,
    /export function requestPausedAnimationSettle\(\): void/u,
  );
  assert.match(
    virtualizerSource,
    /if \(newlyMountedWrappers\.length > 0\)\s*\{\s*this\._onNewElementMounted\?\.\(newlyMountedWrappers\)/u,
  );
  assert.doesNotMatch(
    virtualizerSource,
    /destroy\(\): void\s*\{[\s\S]*?this\._onNewElementMounted\s*=\s*null/u,
  );
});
