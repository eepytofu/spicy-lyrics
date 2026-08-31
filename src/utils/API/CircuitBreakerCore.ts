export const BREAKER_FAILURE_THRESHOLD = 2;
export const BREAKER_LADDER_MS = [120_000, 300_000, 900_000, 1_800_000] as const;
export const BREAKER_LADDER_DECAY_MS = 3_600_000;
export const BREAKER_PROBE_MIN_INTERVAL_MS = 30_000;
export const BREAKER_PROBE_STALE_AFTER_MS = 60_000;

const LADDER_MAX_MS = BREAKER_LADDER_MS.at(-1)!;
const OPEN_UNTIL_SANITY_MS = LADDER_MAX_MS * 1.5;
const TRIP_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

export type BreakerState = {
  [key: string]: unknown;
  openUntil: number;
  ladderIndex: number;
  lastTripAt: number;
  lastProbeAt: number;
};

export const DEFAULT_BREAKER_STATE: BreakerState = {
  openUntil: 0,
  ladderIndex: 0,
  lastTripAt: 0,
  lastProbeAt: 0,
};

type LeaseKind = "normal" | "halfOpen" | "earlyProbe";

export type BreakerLease = {
  kind: LeaseKind;
  probeToken?: number;
  generation: number;
};

export class ServiceUnavailableError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Request suppressed; retry in ~${Math.round(retryAfterMs / 1000)}s`);
    this.name = "ServiceUnavailableError";
    this.retryAfterMs = retryAfterMs;
  }
}

export type CircuitBreakerDependencies = {
  now: () => number;
  jitter: (milliseconds: number, ratio: number) => number;
  save: () => void;
  warn?: (...values: unknown[]) => void;
};

export function createCircuitBreaker(
  state: BreakerState,
  dependencies: CircuitBreakerDependencies,
) {
  let consecutiveFailures = 0;
  let probeInFlight = false;
  let probeStartedAt = 0;
  let probeSequence = 0;
  let activeProbeToken = 0;
  let generation = 0;

  const persist = () => dependencies.save();

  function normalizeState(): void {
    const now = dependencies.now();
    let changed = false;

    if (state.openUntil - now > OPEN_UNTIL_SANITY_MS) {
      state.openUntil = 0;
      state.ladderIndex = 0;
      state.lastTripAt = 0;
      changed = true;
    }
    if (state.lastTripAt > now) {
      state.lastTripAt = 0;
      changed = true;
    }
    if (state.lastProbeAt > now) {
      state.lastProbeAt = 0;
      changed = true;
    }
    if (
      state.ladderIndex > 0
      && now - state.lastTripAt > BREAKER_LADDER_DECAY_MS
    ) {
      state.ladderIndex = 0;
      changed = true;
    }
    if (changed) persist();
  }

  function retryAfterMs(): number {
    return Math.max(0, state.openUntil - dependencies.now());
  }

  function probeIsHeld(now: number): boolean {
    if (!probeInFlight) return false;
    if (now - probeStartedAt <= BREAKER_PROBE_STALE_AFTER_MS) return true;

    probeInFlight = false;
    activeProbeToken = 0;
    dependencies.warn?.("Stale breaker probe released");
    return false;
  }

  function grantProbe(kind: LeaseKind, now: number): BreakerLease {
    probeInFlight = true;
    probeStartedAt = now;
    activeProbeToken = ++probeSequence;
    state.lastProbeAt = now;
    persist();
    return { kind, probeToken: activeProbeToken, generation };
  }

  function acquire(probeCandidate: boolean): BreakerLease {
    const now = dependencies.now();
    if (now < state.openUntil) {
      if (!probeCandidate || probeIsHeld(now)) {
        throw new ServiceUnavailableError(state.openUntil - now);
      }
      const sinceLastProbe = now - state.lastProbeAt;
      if (sinceLastProbe < BREAKER_PROBE_MIN_INTERVAL_MS) {
        throw new ServiceUnavailableError(
          BREAKER_PROBE_MIN_INTERVAL_MS - sinceLastProbe,
        );
      }
      return grantProbe("earlyProbe", now);
    }

    if (state.openUntil !== 0) {
      if (probeIsHeld(now)) {
        throw new ServiceUnavailableError(BREAKER_PROBE_MIN_INTERVAL_MS);
      }
      return grantProbe("halfOpen", now);
    }

    return { kind: "normal", generation };
  }

  function claimSettle(lease: BreakerLease): boolean {
    if (lease.kind !== "normal") {
      if (lease.probeToken !== activeProbeToken) return false;
      probeInFlight = false;
      activeProbeToken = 0;
    }
    return lease.generation === generation;
  }

  function settleSuccess(lease: BreakerLease): void {
    if (!claimSettle(lease)) return;
    consecutiveFailures = 0;
    if (state.openUntil === 0 && state.ladderIndex === 0) return;

    state.openUntil = 0;
    state.ladderIndex = 0;
    generation += 1;
    persist();
  }

  function settleNeutral(lease: BreakerLease): void {
    claimSettle(lease);
  }

  function trip(retryAfterHeaderMs?: number): void {
    const now = dependencies.now();
    const rung = BREAKER_LADDER_MS[
      Math.min(state.ladderIndex, BREAKER_LADDER_MS.length - 1)
    ];
    const pause = Math.min(
      retryAfterHeaderMs ?? dependencies.jitter(rung, 0.5),
      OPEN_UNTIL_SANITY_MS,
    );
    state.openUntil = now + pause;
    state.lastTripAt = now;
    state.ladderIndex = Math.min(
      state.ladderIndex + 1,
      BREAKER_LADDER_MS.length - 1,
    );
    generation += 1;
    consecutiveFailures = 0;
    persist();
  }

  function settleFailure(
    lease: BreakerLease,
    retryAfterHeaderMs?: number,
  ): void {
    if (!claimSettle(lease)) return;
    if (lease.kind === "earlyProbe") return;
    if (lease.kind === "halfOpen") {
      trip(retryAfterHeaderMs);
      return;
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
      trip(retryAfterHeaderMs);
    }
  }

  function reset(): void {
    state.openUntil = 0;
    state.ladderIndex = 0;
    state.lastTripAt = 0;
    state.lastProbeAt = 0;
    consecutiveFailures = 0;
    probeInFlight = false;
    probeStartedAt = 0;
    activeProbeToken = 0;
    generation += 1;
    persist();
  }

  normalizeState();

  return {
    acquire,
    isOpen: () => retryAfterMs() > 0,
    retryAfterMs,
    settleFailure,
    settleNeutral,
    settleSuccess,
    reset,
    snapshot: () => ({
      ...state,
      open: retryAfterMs() > 0,
      retryAfterMs: retryAfterMs(),
    }),
  };
}

export function isTripStatus(status: number): boolean {
  return TRIP_STATUSES.has(status);
}

export function parseRetryAfter(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  const delta = date - now;
  return delta > 0 ? delta : undefined;
}
