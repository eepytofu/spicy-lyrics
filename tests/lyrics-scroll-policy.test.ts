import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  measuredVerticalSize,
  shouldVerifyLyricsScroll,
} from "../src/utils/Lyrics/LyricsScrollPolicy.ts";

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
