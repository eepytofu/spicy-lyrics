import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireSpicyOutcomeWithBoundedAuthRetry,
  classifySpicyTransportFailure,
  isSpicyEnvelopeAuthRejectionStatus,
} from "../src/utils/Lyrics/SpicyAuthRetry.ts";

test("Spicy authentication rejection invalidates once and retries once", async () => {
  let attempts = 0;
  let invalidations = 0;
  let invalidatedToken = "";
  let tokenReads = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => `token-${++tokenReads}`,
    invalidateToken: (token) => {
      invalidations += 1;
      invalidatedToken = token;
    },
    runAttempt: async () => {
      attempts += 1;
      return { kind: "auth-rejected", status: 401 } as const;
    },
  });

  assert.deepEqual(result, { kind: "upstream-error", status: 401 });
  assert.equal(attempts, 2);
  assert.equal(tokenReads, 2);
  assert.equal(invalidations, 1);
  assert.equal(invalidatedToken, "token-1");
});

test("Spicy authentication retry returns the second settled outcome", async () => {
  let attempts = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => `token-${attempts + 1}`,
    invalidateToken: () => {},
    runAttempt: async () => ++attempts === 1
      ? { kind: "auth-rejected", status: 401 } as const
      : { kind: "settled", outcome: { kind: "lyrics", result: "lyrics" } } as const,
  });

  assert.deepEqual(result, { kind: "lyrics", result: "lyrics" });
  assert.equal(attempts, 2);
});

test("Spicy authentication never resends the rejected token", async () => {
  let attempts = 0;
  let reads = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => {
      reads += 1;
      return "repeated-token";
    },
    invalidateToken: () => {},
    runAttempt: async () => {
      attempts += 1;
      return { kind: "auth-rejected", status: 401 } as const;
    },
  });

  assert.deepEqual(result, { kind: "upstream-error", status: 401 });
  assert.equal(reads, 2);
  assert.equal(attempts, 1);
});

test("a failed token refresh retains the original 401 outcome", async () => {
  let reads = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => {
      if (++reads === 1) return "rejected-token";
      throw new Error("no different token");
    },
    invalidateToken: () => {},
    runAttempt: async () => ({ kind: "auth-rejected", status: 401 }) as const,
  });

  assert.deepEqual(result, { kind: "upstream-error", status: 401 });
});

test("a breaker-suppressed retry retains the original 401 outcome", async () => {
  let attempts = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => `token-${attempts + 1}`,
    invalidateToken: () => {},
    runAttempt: async () => ++attempts === 1
      ? { kind: "auth-rejected", status: 401 } as const
      : {
          kind: "settled",
          outcome: { kind: "service-unavailable", retryAfterMs: 30_000 },
        } as const,
  });

  assert.deepEqual(result, { kind: "upstream-error", status: 401 });
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

test("only an envelope 401 is a Spicy authentication rejection", () => {
  assert.equal(isSpicyEnvelopeAuthRejectionStatus(401), true);
  assert.equal(isSpicyEnvelopeAuthRejectionStatus(403), false);
  assert.equal(isSpicyEnvelopeAuthRejectionStatus(429), false);
  assert.equal(classifySpicyTransportFailure(401), "upstream-error");
  assert.equal(classifySpicyTransportFailure(403), "upstream-error");
  assert.equal(classifySpicyTransportFailure(429), "rate-limited");
});
