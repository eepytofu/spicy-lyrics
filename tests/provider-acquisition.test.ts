import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireProviderOutcomes,
  runProviderAcquisition,
} from "../src/utils/Lyrics/ProviderAcquisition.ts";

test("provider acquisition returns a usable result before the deadline", async () => {
  const result = await runProviderAcquisition(
    async () => ({ kind: "lyrics", result: "lyrics" }),
    undefined,
    100,
  );
  assert.deepEqual(result, { kind: "lyrics", result: "lyrics" });
});

test("provider timeout aborts the adapter and has a distinct outcome", async () => {
  let aborted = false;
  const result = await runProviderAcquisition(
    (signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        resolve({ kind: "no-match" });
      });
    }),
    undefined,
    5,
  );

  assert.equal(aborted, true);
  assert.deepEqual(result, { kind: "timeout" });
});

test("parent cancellation is distinct from a timeout", async () => {
  const parent = new AbortController();
  const request = runProviderAcquisition(
    () => new Promise(() => {}),
    parent.signal,
    100,
  );
  parent.abort();

  assert.deepEqual(await request, { kind: "aborted" });
});

test("strict acquisition stops on an Apple queued outcome", async () => {
  const calls: string[] = [];
  const records = await acquireProviderOutcomes(
    ["apple", "spotify"],
    "strict",
    async (provider) => {
      calls.push(provider);
      return provider === "apple"
        ? { kind: "queued" }
        : { kind: "lyrics", result: "spotify lyrics" };
    },
  );

  assert.deepEqual(calls, ["apple"]);
  assert.equal(records[0].provider, "apple");
  assert.equal(records[0].outcome.kind, "queued");
});

test("quality-first acquisition retains source-order indices while running all providers", async () => {
  const records = await acquireProviderOutcomes(
    ["slow", "fast"],
    "concurrent",
    async (provider) => {
      if (provider === "slow") await new Promise((resolve) => setTimeout(resolve, 5));
      return { kind: "lyrics", result: provider };
    },
  );

  assert.deepEqual(
    records.map(({ provider, orderIndex }) => ({ provider, orderIndex })),
    [
      { provider: "slow", orderIndex: 0 },
      { provider: "fast", orderIndex: 1 },
    ],
  );
});
