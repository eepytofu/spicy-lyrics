import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireSpicyOutcomeWithBoundedAuthRetry,
  isSpicyAuthRejectionStatus,
} from "../src/utils/Lyrics/SpicyAuthRetry.ts";

test("Spicy authentication rejection invalidates once and retries once", async () => {
  let attempts = 0;
  let invalidations = 0;
  let tokenReads = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => `token-${++tokenReads}`,
    invalidateToken: () => { invalidations += 1; },
    runAttempt: async () => {
      attempts += 1;
      return { kind: "auth-rejected", status: 401 } as const;
    },
  });

  assert.deepEqual(result, { kind: "upstream-error", status: 401 });
  assert.equal(attempts, 2);
  assert.equal(tokenReads, 2);
  assert.equal(invalidations, 1);
});

test("Spicy authentication retry returns the second settled outcome", async () => {
  let attempts = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => "token",
    invalidateToken: () => {},
    runAttempt: async () => ++attempts === 1
      ? { kind: "auth-rejected", status: 403 } as const
      : { kind: "settled", outcome: { kind: "lyrics", result: "lyrics" } } as const,
  });

  assert.deepEqual(result, { kind: "lyrics", result: "lyrics" });
  assert.equal(attempts, 2);
});

test("aborted Spicy authentication does not invalidate or retry", async () => {
  const controller = new AbortController();
  let attempts = 0;
  let invalidations = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: controller.signal,
    resolveToken: async () => "token",
    invalidateToken: () => { invalidations += 1; },
    runAttempt: async () => {
      attempts += 1;
      controller.abort();
      return { kind: "auth-rejected", status: 401 } as const;
    },
  });

  assert.deepEqual(result, { kind: "aborted" });
  assert.equal(attempts, 1);
  assert.equal(invalidations, 0);
});

test("only 401 and 403 are Spicy authentication rejections", () => {
  assert.equal(isSpicyAuthRejectionStatus(401), true);
  assert.equal(isSpicyAuthRejectionStatus(403), true);
  assert.equal(isSpicyAuthRejectionStatus(429), false);
  assert.equal(isSpicyAuthRejectionStatus(500), false);
});
