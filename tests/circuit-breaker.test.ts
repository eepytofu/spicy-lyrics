import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BREAKER_LADDER_MS,
  BREAKER_PROBE_MIN_INTERVAL_MS,
  BREAKER_PROBE_STALE_AFTER_MS,
  createCircuitBreaker,
  DEFAULT_BREAKER_STATE,
  isTripStatus,
  parseRetryAfter,
  ServiceUnavailableError,
  type BreakerState,
} from "../src/utils/API/CircuitBreakerCore.ts";

function harness(startAt = 100_000) {
  let now = startAt;
  let saves = 0;
  const state: BreakerState = { ...DEFAULT_BREAKER_STATE };
  const breaker = createCircuitBreaker(state, {
    now: () => now,
    jitter: (milliseconds) => milliseconds,
    save: () => { saves += 1; },
  });
  return {
    breaker,
    state,
    saves: () => saves,
    advance: (milliseconds: number) => { now += milliseconds; },
    now: () => now,
  };
}

test("two transport failures persist the first breaker window", () => {
  const context = harness();
  context.breaker.settleFailure(context.breaker.acquire(false));
  assert.equal(context.breaker.isOpen(), false);
  context.breaker.settleFailure(context.breaker.acquire(false));

  assert.equal(context.breaker.isOpen(), true);
  assert.equal(
    context.state.openUntil,
    context.now() + BREAKER_LADDER_MS[0],
  );
  assert.equal(context.state.ladderIndex, 1);
  assert.ok(context.saves() > 0);
  assert.throws(
    () => context.breaker.acquire(false),
    ServiceUnavailableError,
  );
});

test("one bounded early probe owns the open-breaker slot", () => {
  const context = harness();
  context.breaker.settleFailure(context.breaker.acquire(false));
  context.breaker.settleFailure(context.breaker.acquire(false));

  const probe = context.breaker.acquire(true);
  assert.equal(probe.kind, "earlyProbe");
  assert.throws(() => context.breaker.acquire(true), ServiceUnavailableError);
  const openUntil = context.state.openUntil;
  context.breaker.settleFailure(probe);
  assert.equal(context.state.openUntil, openUntil);
  assert.throws(() => context.breaker.acquire(true), ServiceUnavailableError);

  context.advance(BREAKER_PROBE_MIN_INTERVAL_MS);
  assert.equal(context.breaker.acquire(true).kind, "earlyProbe");
});

test("stale and pre-transition settles cannot steal current breaker state", () => {
  const context = harness();
  const first = context.breaker.acquire(false);
  const second = context.breaker.acquire(false);
  const lateSuccess = context.breaker.acquire(false);
  context.breaker.settleFailure(first);
  context.breaker.settleFailure(second);
  context.breaker.settleSuccess(lateSuccess);
  assert.equal(context.breaker.isOpen(), true);

  const staleProbe = context.breaker.acquire(true);
  context.advance(BREAKER_PROBE_STALE_AFTER_MS + 1);
  const replacement = context.breaker.acquire(true);
  context.breaker.settleFailure(staleProbe);
  assert.throws(() => context.breaker.acquire(true), ServiceUnavailableError);
  context.breaker.settleSuccess(replacement);
  assert.equal(context.breaker.isOpen(), false);
});

test("a failed half-open probe advances the pause ladder", () => {
  const context = harness();
  context.breaker.settleFailure(context.breaker.acquire(false));
  context.breaker.settleFailure(context.breaker.acquire(false));
  context.advance(BREAKER_LADDER_MS[0]);

  const halfOpen = context.breaker.acquire(false);
  assert.equal(halfOpen.kind, "halfOpen");
  context.breaker.settleFailure(halfOpen);
  assert.equal(
    context.state.openUntil,
    context.now() + BREAKER_LADDER_MS[1],
  );
  assert.equal(context.state.ladderIndex, 2);
});

test("a canceled probe releases its lease without changing the open window", () => {
  const context = harness();
  context.breaker.settleFailure(context.breaker.acquire(false));
  context.breaker.settleFailure(context.breaker.acquire(false));
  const openUntil = context.state.openUntil;

  const canceled = context.breaker.acquire(true);
  context.breaker.settleNeutral(canceled);
  assert.equal(context.state.openUntil, openUntil);
  context.advance(BREAKER_PROBE_MIN_INTERVAL_MS);
  assert.equal(context.breaker.acquire(true).kind, "earlyProbe");
});

test("persisted timestamps are normalized before they can suppress traffic", () => {
  const now = 100_000;
  let saves = 0;
  const state: BreakerState = {
    openUntil: now + BREAKER_LADDER_MS.at(-1)! * 2,
    ladderIndex: BREAKER_LADDER_MS.length - 1,
    lastTripAt: now + 1,
    lastProbeAt: now + 1,
  };
  const breaker = createCircuitBreaker(state, {
    now: () => now,
    jitter: (milliseconds) => milliseconds,
    save: () => { saves += 1; },
  });

  assert.equal(breaker.isOpen(), false);
  assert.deepEqual(state, DEFAULT_BREAKER_STATE);
  assert.equal(saves, 1);
});

test("trip signals and Retry-After parsing stay transport-only", () => {
  assert.equal(isTripStatus(403), true);
  assert.equal(isTripStatus(429), true);
  assert.equal(isTripStatus(503), true);
  assert.equal(isTripStatus(401), false);
  assert.equal(isTripStatus(404), false);
  assert.equal(parseRetryAfter("12", 1_000), 12_000);
  assert.equal(
    parseRetryAfter("Thu, 01 Jan 1970 00:00:15 GMT", 10_000),
    5_000,
  );
  assert.equal(parseRetryAfter("invalid", 1_000), undefined);
});

test("Query owns the 15-second deadline and composes parent cancellation", () => {
  const querySource = readFileSync(
    new URL("../src/utils/API/Query.ts", import.meta.url),
    "utf8",
  );
  const sourceSource = readFileSync(
    new URL("../src/utils/Lyrics/ExternalSources.ts", import.meta.url),
    "utf8",
  );

  assert.match(querySource, /SPICY_API_REQUEST_TIMEOUT_MS = 15_000/u);
  assert.match(querySource, /SettleFailure\(lease/u);
  assert.match(querySource, /SettleNeutral\(lease\)/u);
  assert.match(querySource, /SettleSuccess\(lease\)/u);
  assert.match(querySource, /parentSignal\?\.addEventListener\("abort"/u);
  assert.match(sourceSource, /\{ signal, probe \}/u);
  assert.match(sourceSource, /kind: "timeout"/u);
  assert.match(sourceSource, /retryAfterMs: error\.retryAfterMs/u);
});
