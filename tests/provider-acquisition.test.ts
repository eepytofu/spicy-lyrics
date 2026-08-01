import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireProviderOutcomes,
  ProviderResponseError,
  runProviderAcquisition,
} from "../src/utils/Lyrics/ProviderAcquisition.ts";

test("provider acquisition returns a usable result", async () => {
  const result = await runProviderAcquisition(
    async () => ({ kind: "lyrics", result: "lyrics" }),
  );
  assert.deepEqual(result, { kind: "lyrics", result: "lyrics" });
});

test("typed provider request timeouts keep their distinct outcome", async () => {
  const result = await runProviderAcquisition(async () => {
    throw new ProviderResponseError({ kind: "timeout" }, "timed out");
  });
  assert.deepEqual(result, { kind: "timeout" });
});

test("parent cancellation is distinct from a timeout", async () => {
  const parent = new AbortController();
  const request = runProviderAcquisition(
    () => new Promise(() => {}),
    parent.signal,
  );
  parent.abort();

  assert.deepEqual(await request, { kind: "aborted" });
});

test("typed server failures keep their actionable acquisition outcome", async () => {
  const rateLimited = await runProviderAcquisition(async () => {
    throw new ProviderResponseError({ kind: "rate-limited", retryAfterMs: 3000 }, "limited");
  });
  const upstream = await runProviderAcquisition(async () => {
    throw new ProviderResponseError({ kind: "upstream-error", status: 502 }, "failed");
  });

  assert.deepEqual(rateLimited, { kind: "rate-limited", retryAfterMs: 3000 });
  assert.deepEqual(upstream, { kind: "upstream-error", status: 502 });
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
