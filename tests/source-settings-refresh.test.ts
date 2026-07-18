import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindCoalescedSourceSettingsRefresh,
  commitSourceSettingsChange,
} from "../src/utils/Lyrics/SourceSettingsRefresh.ts";

test("committed source changes coalesce into one current-song refresh", async () => {
  const target = new EventTarget();
  let refreshes = 0;
  const dispose = bindCoalescedSourceSettingsRefresh(() => refreshes++, target, 5);

  commitSourceSettingsChange(target);
  commitSourceSettingsChange(target);
  commitSourceSettingsChange(target);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(refreshes, 1);
  dispose();
});

test("disposing a source refresh binding cancels pending work", async () => {
  const target = new EventTarget();
  let refreshes = 0;
  const dispose = bindCoalescedSourceSettingsRefresh(() => refreshes++, target, 5);

  commitSourceSettingsChange(target);
  dispose();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(refreshes, 0);
});
