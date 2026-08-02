import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  chooseScrollLineIndex,
  measuredVerticalSize,
  shouldVerifyLyricsScroll,
} from "../src/utils/Lyrics/LyricsScrollPolicy.ts";

test("keeps a lead line anchored while its background vocal group is active", () => {
  const lines = [
    { StartTime: 0, EndTime: 4000 },
    { StartTime: 1000, EndTime: 5000, BGLine: true },
    { StartTime: 3000, EndTime: 6000 },
    { StartTime: 6000, EndTime: 7000 },
  ];

  assert.equal(chooseScrollLineIndex(lines, 3500), 0);
  assert.equal(chooseScrollLineIndex(lines, 5500), 2);
});

test("preserves the fallback for overlapping lines separated by a larger gap", () => {
  const lines = [
    { StartTime: 0, EndTime: 5000 },
    { StartTime: 1000, EndTime: 6000 },
    { StartTime: 2000, EndTime: 7000 },
    { StartTime: 3000, EndTime: 8000 },
  ];

  assert.equal(chooseScrollLineIndex(lines, 3500, 2), 3);
});

test("mounted smooth next-line targets do not enter the convergence retry loop", () => {
  assert.equal(shouldVerifyLyricsScroll(false, true), false);
});

test("instant seeks and unmounted smooth targets retain convergence verification", () => {
  assert.equal(shouldVerifyLyricsScroll(true, true), true);
  assert.equal(shouldVerifyLyricsScroll(true, false), true);
  assert.equal(shouldVerifyLyricsScroll(false, false), true);
});

test("resize measurements consume observer border boxes without reading layout fallback", () => {
  let offsetHeightReads = 0;
  const element = {
    get offsetHeight() {
      offsetHeightReads += 1;
      return 99;
    },
  };

  assert.equal(measuredVerticalSize(element, { borderBoxSize: [{ blockSize: 72.4 }] }), 72);
  assert.equal(offsetHeightReads, 0);
  assert.equal(measuredVerticalSize(element), 99);
  assert.equal(offsetHeightReads, 1);
});

test("virtual-window DOM writes are batched before synchronous measurements", () => {
  const source = readFileSync(
    new URL("../src/utils/Lyrics/LyricsVirtualizer.ts", import.meta.url),
    "utf8",
  );
  const appendAt = source.indexOf("this._virtualContainer.appendChild(wrapper)");
  const mountBatchAt = source.indexOf("for (const wrapper of wrappersToMeasure)");
  const unmountMeasureAt = source.indexOf("for (const wrapper of unmountWrappers)");
  const unmountRemoveAt = source.indexOf("wrapper?.parentElement?.removeChild(wrapper)");

  assert.ok(appendAt >= 0 && mountBatchAt > appendAt);
  assert.ok(unmountMeasureAt >= 0 && unmountRemoveAt > unmountMeasureAt);
});

test("disabled virtualizer diagnostics do not evaluate layout reads", () => {
  const source = readFileSync(
    new URL("../src/utils/Lyrics/LyricsVirtualizer.ts", import.meta.url),
    "utf8",
  );
  const guardAt = source.indexOf("if (virtualizerLogger.isEnabled)");
  const computedStyleAt = source.indexOf("getComputedStyle(scrollEl).scrollBehavior");

  assert.ok(guardAt >= 0 && computedStyleAt > guardAt);
});
