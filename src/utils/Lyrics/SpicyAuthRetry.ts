import type { ProviderAcquisitionOutcome } from "./ProviderAcquisition.ts";

export type SpicyAuthRejectionStatus = 401;

export type SpicyQueryAttempt<Outcome extends ProviderAcquisitionOutcome<unknown>> =
  | { kind: "auth-rejected"; status: SpicyAuthRejectionStatus }
  | { kind: "settled"; outcome: Outcome };

export type SpicyAuthRetryDependencies<
  Outcome extends ProviderAcquisitionOutcome<unknown>,
> = {
  signal: AbortSignal;
  resolveToken: () => Promise<string>;
  invalidateToken: (rejectedToken: string) => void;
  runAttempt: (
    token: string,
    signal: AbortSignal,
  ) => Promise<SpicyQueryAttempt<Outcome>>;
};

export function isSpicyEnvelopeAuthRejectionStatus(
  status: number,
): status is SpicyAuthRejectionStatus {
  return status === 401;
}

export function classifySpicyTransportFailure(
  status: number,
): "rate-limited" | "upstream-error" {
  return status === 429 ? "rate-limited" : "upstream-error";
}

export function classifySpicyEnvelopeStatus(
  status: number,
):
  | "success"
  | "auth-rejected"
  | "queued"
  | "no-match"
  | "rate-limited"
  | "upstream-error" {
  if (isSpicyEnvelopeAuthRejectionStatus(status)) return "auth-rejected";
  if (status === 503) return "queued";
  if (status === 404) return "no-match";
  if (status === 429) return "rate-limited";
  return status === 200 ? "success" : "upstream-error";
}

export async function acquireSpicyOutcomeWithBoundedAuthRetry<
  Outcome extends ProviderAcquisitionOutcome<unknown>,
>(dependencies: SpicyAuthRetryDependencies<Outcome>): Promise<Outcome> {
  let token = await dependencies.resolveToken();
  if (dependencies.signal.aborted) return { kind: "aborted" } as Outcome;

  let attempt = await dependencies.runAttempt(token, dependencies.signal);
  if (attempt.kind !== "auth-rejected") return attempt.outcome;
  if (dependencies.signal.aborted) return { kind: "aborted" } as Outcome;

  const rejectedToken = token;
  const rejectedStatus = attempt.status;
  dependencies.invalidateToken(rejectedToken);
  try {
    token = await dependencies.resolveToken();
  } catch {
    return dependencies.signal.aborted
      ? { kind: "aborted" } as Outcome
      : { kind: "upstream-error", status: rejectedStatus } as Outcome;
  }
  if (dependencies.signal.aborted) return { kind: "aborted" } as Outcome;
  if (token === rejectedToken) {
    return { kind: "upstream-error", status: rejectedStatus } as Outcome;
  }

  attempt = await dependencies.runAttempt(token, dependencies.signal);
  if (attempt.kind === "auth-rejected") {
    return { kind: "upstream-error", status: rejectedStatus } as Outcome;
  }
  return attempt.outcome.kind === "service-unavailable"
    ? { kind: "upstream-error", status: rejectedStatus } as Outcome
    : attempt.outcome;
}
