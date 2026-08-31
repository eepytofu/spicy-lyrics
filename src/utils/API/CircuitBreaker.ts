import { GetInstantStore } from "../../modules/Store.ts";
import Logger from "../Logger.ts";
import { jitter } from "../jitter.ts";
import {
  createCircuitBreaker,
  DEFAULT_BREAKER_STATE,
  isTripStatus,
  parseRetryAfter,
  ServiceUnavailableError,
  type BreakerLease,
  type BreakerState,
} from "./CircuitBreakerCore.ts";

const logger = new Logger("Query Breaker");
const store = GetInstantStore<BreakerState>(
  "SpicyLyrics_QueryBreaker_g1",
  1,
  DEFAULT_BREAKER_STATE,
);
const breaker = createCircuitBreaker(store.Items, {
  now: () => Date.now(),
  jitter,
  save: store.SaveChanges,
  warn: (...values) => logger.warn(...values),
});

export { ServiceUnavailableError };
export type { BreakerLease };

export const Acquire = breaker.acquire;
export const IsOpen = breaker.isOpen;
export const RetryAfterMs = breaker.retryAfterMs;
export const SettleFailure = breaker.settleFailure;
export const SettleNeutral = breaker.settleNeutral;
export const SettleSuccess = breaker.settleSuccess;
export const IsTripStatus = isTripStatus;
export const ParseRetryAfter = (header: string | null) => parseRetryAfter(header);

export const BreakerDebug = {
  state: breaker.snapshot,
  reset: breaker.reset,
};
