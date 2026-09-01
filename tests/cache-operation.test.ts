import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { performCacheOperation } from "../src/utils/CacheOperation.ts";

test("a cache clear failure does not attempt a lyrics refresh", async () => {
  const failure = new Error("clear failed");
  let refreshes = 0;
  const outcome = await performCacheOperation(
    async () => { throw failure; },
    async () => { refreshes += 1; },
  );

  assert.deepEqual(outcome, { kind: "operation-failed", error: failure });
  assert.equal(refreshes, 0);
});

test("a completed cache clear and refresh has one successful outcome", async () => {
  const order: string[] = [];
  const outcome = await performCacheOperation(
    async () => { order.push("clear"); },
    async () => { order.push("refresh"); },
  );

  assert.deepEqual(outcome, { kind: "success" });
  assert.deepEqual(order, ["clear", "refresh"]);
});

test("a post-clear refresh failure cannot be reported as a clear failure", async () => {
  const failure = new Error("refresh failed");
  let cleared = false;
  const outcome = await performCacheOperation(
    async () => { cleared = true; },
    async () => { throw failure; },
  );

  assert.equal(cleared, true);
  assert.deepEqual(outcome, { kind: "refresh-failed", error: failure });
});

test("cache UI maps the three outcomes to distinct final notifications", () => {
  const source = readFileSync(
    new URL("../src/utils/LyricsCacheTools.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /outcome\.kind === "success"[\s\S]*toast\.success/u);
  assert.match(source, /outcome\.kind === "operation-failed"[\s\S]*toast\.error/u);
  assert.match(source, /toast\.warning\(refreshFailureMessage\)/u);
  assert.doesNotMatch(source, /toast\.success\(successMessage\)[\s\S]*await refetchCurrentLyrics/u);
});
