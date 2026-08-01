import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyLineState,
  animationTimelineJumped,
  finiteAnimationValue,
  gradientTargetsAt,
  getElementState,
  getProgressPercentage,
  lineFuriganaFillProgress,
  safeAnimationDelay,
  setClassPresence,
  shouldHideDotLine,
  syllableLinePaintAction,
  timedGroupEnvelopeAt,
  wordGradientTargets,
} from "../src/utils/Lyrics/Animator/Lyrics/AnimatorState.ts";
import {
  IdleEmphasisGroupScale,
  IdleEmphasisLetterScale,
  IdleLyricsScale,
} from "../src/utils/Lyrics/Animator/Shared.ts";

const animatorSource = readFileSync(
  new URL("../src/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts", import.meta.url),
  "utf8"
);
const emphasizeSource = readFileSync(
  new URL("../src/utils/Lyrics/Applyer/Utils/Emphasize.ts", import.meta.url),
  "utf8",
);
const syllableApplyerSource = readFileSync(
  new URL("../src/utils/Lyrics/Applyer/Synced/Syllable.ts", import.meta.url),
  "utf8",
);

class FakeClassList {
  readonly values = new Set<string>();

  toggle(className: string, force?: boolean): boolean {
    const present = force ?? !this.values.has(className);
    if (present) this.values.add(className);
    else this.values.delete(className);
    return present;
  }
}

test("animation state keeps exact start/end and zero-duration semantics", () => {
  assert.equal(getElementState(99, 100, 200), "NotSung");
  assert.equal(getElementState(100, 100, 200), "Active");
  assert.equal(getElementState(199, 100, 200), "Active");
  assert.equal(getElementState(200, 100, 200), "Sung");
  assert.equal(getElementState(100, 100, 100), "Sung");

  assert.equal(getProgressPercentage(99, 100, 200), 0);
  assert.equal(getProgressPercentage(100, 100, 200), 0);
  assert.equal(getProgressPercentage(150, 100, 200), 0.5);
  assert.equal(getProgressPercentage(200, 100, 200), 1);
  assert.equal(getProgressPercentage(100, 100, 100), 0);
  assert.equal(getProgressPercentage(101, 100, 100), 1);
});

test("idle emphasis keeps the outer motion without shrinking each glyph box", () => {
  assert.equal(IdleLyricsScale, 0.95);
  assert.equal(IdleEmphasisGroupScale, 0.95);
  assert.equal(IdleEmphasisLetterScale, 1);
  assert.match(
    emphasizeSource,
    /letterElem\.style\.scale\s*=\s*IdleEmphasisLetterScale\.toString\(\)/u,
  );
  assert.match(
    syllableApplyerSource,
    /word\.style\.scale\s*=\s*IdleEmphasisGroupScale\.toString\(\)/u,
  );
  assert.equal(
    animatorSource.match(/\{\s*Time:\s*0,\s*Value:\s*IdleEmphasisLetterScale\s*\}/gu)?.length,
    2,
  );
  assert.match(
    animatorSource,
    /const ScaleRange\s*=\s*\[\s*\{\s*Time:\s*0,\s*Value:\s*IdleLyricsScale\s*\}/u,
  );
});

test("forward, pause, backward, and rapid seeks resolve deterministically", () => {
  const positions = [90, 120, 120, 190, 250, 150, 50, 180];
  assert.deepEqual(
    positions.map((position) => getElementState(position, 100, 200)),
    ["NotSung", "Active", "Active", "Active", "Sung", "Active", "NotSung", "Active"]
  );
});

test("timeline discontinuities distinguish seeks from ordinary playback and stalls", () => {
  assert.equal(animationTimelineJumped(null, 1000, 16), false);
  assert.equal(animationTimelineJumped(1000, 1016, 16), false);
  assert.equal(animationTimelineJumped(1000, 1000, 16), false);
  assert.equal(animationTimelineJumped(1000, 1000, 1000), false);
  assert.equal(animationTimelineJumped(1000, 2000, 1000), false);
  assert.equal(animationTimelineJumped(1000, 5000, 16), true);
  assert.equal(animationTimelineJumped(5000, 1000, 16), true);
});

test("syllable paint state settles lines skipped by a seek", () => {
  assert.equal(syllableLinePaintAction("Sung", undefined, "Sung"), "settleSung");
  assert.equal(syllableLinePaintAction("Sung", "NotSung", "Active"), "settleSung");
  assert.equal(syllableLinePaintAction("Sung", "Active", "NotSung"), "continueSung");
  assert.equal(syllableLinePaintAction("Sung", "Active", "Sung"), "settleSung");
  assert.equal(syllableLinePaintAction("Sung", "Sung", "Sung"), "none");
  assert.equal(syllableLinePaintAction("NotSung", "Sung", "Active"), "resetNotSung");
});

test("animation delay guards NaN, infinity, and browser-clamped negatives", () => {
  assert.equal(safeAnimationDelay(250, 1000), 250);
  assert.equal(safeAnimationDelay(-25, 1000), 0);
  assert.equal(safeAnimationDelay(Number.NaN, 1000), 1000);
  assert.equal(safeAnimationDelay(Number.POSITIVE_INFINITY, 1000), 1000);
  assert.equal(safeAnimationDelay(Number.NaN, Number.NaN), 0);
  assert.equal(finiteAnimationValue(undefined, 0.75), 0.75);
  assert.equal(finiteAnimationValue(Number.NaN, 0.75), 0.75);
  assert.equal(finiteAnimationValue(0.5, 0.75), 0.5);
});

test("line state writes one mutually exclusive class set", () => {
  const classList = new FakeClassList();
  const target = { classList };

  applyLineState(target, "Active");
  assert.deepEqual([...classList.values], ["Active"]);

  applyLineState(target, "Sung");
  assert.deepEqual([...classList.values], ["Sung"]);

  applyLineState(target, "NotSung");
  assert.deepEqual([...classList.values], ["NotSung"]);

  setClassPresence(target, "pre-hidden", true);
  assert.equal(classList.values.has("pre-hidden"), true);
  setClassPresence(target, "pre-hidden", false);
  assert.equal(classList.values.has("pre-hidden"), false);
});

test("simple and full word gradients keep their distinct paint ranges", () => {
  assert.deepEqual(wordGradientTargets("NotSung", 0, false), {
    base: -20,
    extra: -40,
  });
  assert.deepEqual(wordGradientTargets("Active", 0.5, false), {
    base: 40,
    extra: 30,
  });
  assert.deepEqual(wordGradientTargets("NotSung", 0, true), {
    base: -50,
    extra: -50,
  });
  assert.deepEqual(wordGradientTargets("Active", 0.5, true), {
    base: 10,
    extra: 10,
  });
  assert.deepEqual(wordGradientTargets("Sung", 0, false), {
    base: 100,
    extra: 100,
  });
});

test("a grouped reading sweep follows its derived window without changing ordinary spans", () => {
  assert.deepEqual(
    gradientTargetsAt(50, 0, 100, false),
    wordGradientTargets("Active", 0.5, false),
  );
  assert.equal(gradientTargetsAt(150, 0, 100, false).extra, 100);
  assert.equal(gradientTargetsAt(150, 0, 300, false).extra, 30);
});

test("line furigana fill is direct, bounded, and independent from glow history", () => {
  assert.equal(lineFuriganaFillProgress("NotSung", 0.8, false), 0);
  assert.equal(lineFuriganaFillProgress("Active", -1, false), 0);
  assert.equal(lineFuriganaFillProgress("Active", 0.275, false), 0.275);
  assert.equal(lineFuriganaFillProgress("Active", 2, false), 1);
  assert.equal(lineFuriganaFillProgress("Sung", 0, false), 1);
  assert.equal(lineFuriganaFillProgress("NotSung", 0, true), 1);
  assert.equal(lineFuriganaFillProgress("Active", 0.25, true), 1);
});

test("timed group attack, hold, and release remain monotonic", () => {
  const times = {
    start: 100,
    firstEnd: 200,
    lastStart: 400,
    end: 500,
  };

  assert.equal(timedGroupEnvelopeAt(times, 50, 0.7), 0);
  assert.equal(timedGroupEnvelopeAt(times, 150, 0.7), 0.5);
  assert.equal(timedGroupEnvelopeAt(times, 250, 0.7), 0.7);
  assert.equal(timedGroupEnvelopeAt(times, 420, 0.7), 0.7);
  assert.equal(timedGroupEnvelopeAt(times, 480, 0.7), 0.8);
  assert.equal(timedGroupEnvelopeAt(times, 500, 0.7), 1);
});

test("dot-line pre-hide state follows timeline direction", () => {
  assert.equal(shouldHideDotLine("NotSung", 0, 1000, 200), true);
  assert.equal(shouldHideDotLine("Active", 700, 1000, 200), false);
  assert.equal(shouldHideDotLine("Active", 801, 1000, 200), true);
  assert.equal(shouldHideDotLine("Sung", 1000, 1000, 200), false);
});

test("live animator has no dormant dot-group or invalid fallback paths", () => {
  assert.doesNotMatch(
    animatorSource,
    /DotGroupAnimations|_createDotGroupSprings|_calculateOpacity|_calculateLineGlowOpacity/u
  );
  assert.doesNotMatch(animatorSource, /Number\([^)]+\)\s*\?\?/u);
  assert.equal(animatorSource.match(/applyDotVisualState\(/gu)?.length, 5);
  assert.equal(animatorSource.match(/safeAnimationDelay\(/gu)?.length, 2);
});
