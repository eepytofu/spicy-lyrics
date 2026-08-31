import type { ProviderAcquisitionOutcome } from "./ProviderAcquisition.ts";

export type SpicyAuthRejectionStatus = 401 | 403;

export type SpicyQueryAttempt<Outcome extends ProviderAcquisitionOutcome<unknown>> =
  | { kind: "auth-rejected"; status: SpicyAuthRejectionStatus }
  | { kind: "settled"; outcome: Outcome };

export type SpicyAuthRetryDependencies<
  Outcome extends ProviderAcquisitionOutcome<unknown>,
> = {
  signal: AbortSignal;
  resolveToken: () => Promise<string>;
  invalidateToken: () => void;
  runAttempt: (
    token: string,
    signal: AbortSignal,
  ) => Promise<SpicyQueryAttempt<Outcome>>;
};

export function isSpicyAuthRejectionStatus(
  status: number,
): status is SpicyAuthRejectionStatus {
  return status === 401 || status === 403;
}

export async function acquireSpicyOutcomeWithBoundedAuthRetry<
  Outcome extends ProviderAcquisitionOutcome<unknown>,
>(dependencies: SpicyAuthRetryDependencies<Outcome>): Promise<Outcome> {
  let token = await dependencies.resolveToken();
  if (dependencies.signal.aborted) return { kind: "aborted" } as Outcome;

  let attempt = await dependencies.runAttempt(token, dependencies.signal);
  if (attempt.kind !== "auth-rejected") return attempt.outcome;
  if (dependencies.signal.aborted) return { kind: "aborted" } as Outcome;

  dependencies.invalidateToken();
  token = await dependencies.resolveToken();
  if (dependencies.signal.aborted) return { kind: "aborted" } as Outcome;

  attempt = await dependencies.runAttempt(token, dependencies.signal);
  return attempt.kind === "auth-rejected"
    ? { kind: "upstream-error", status: attempt.status } as Outcome
    : attempt.outcome;
}
