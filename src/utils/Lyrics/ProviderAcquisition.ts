export type ProviderAcquisitionOutcome<Result> =
  | { kind: "lyrics"; result: Result }
  | { kind: "queued" }
  | { kind: "no-match" }
  | { kind: "timeout" }
  | { kind: "aborted" }
  | { kind: "rate-limited"; retryAfterMs?: number }
  | { kind: "service-unavailable"; retryAfterMs?: number }
  | { kind: "upstream-error"; status: number }
  | { kind: "error"; error: unknown };

export type ProviderAggregateOutcome<Result> =
  | { kind: "lyrics"; result: Result }
  | { kind: "queued" }
  | { kind: "no-match" }
  | { kind: "rate-limited" }
  | { kind: "service-unavailable" };

export class ProviderResponseError extends Error {
  readonly outcome: Extract<ProviderAcquisitionOutcome<never>, { kind: "rate-limited" | "service-unavailable" | "upstream-error" | "timeout" | "aborted" }>;

  constructor(
    outcome: Extract<ProviderAcquisitionOutcome<never>, { kind: "rate-limited" | "service-unavailable" | "upstream-error" | "timeout" | "aborted" }>,
    message: string,
  ) {
    super(message);
    this.name = "ProviderResponseError";
    this.outcome = outcome;
  }
}

export type ProviderAcquisitionRecord<Provider, Result> = {
  provider: Provider;
  orderIndex: number;
  outcome: ProviderAcquisitionOutcome<Result>;
};

/**
 * Resolves one foreground result without allowing a failed provider to hide a
 * usable fallback. When no lyrics survived, preserve the most actionable
 * aggregate state instead of collapsing temporary failures into "no match".
 */
export function resolveProviderAcquisition<Provider, Result>(
  selected: Result | null,
  records: readonly ProviderAcquisitionRecord<Provider, Result>[],
): ProviderAggregateOutcome<Result> {
  if (selected !== null) return { kind: "lyrics", result: selected };
  if (records.some(({ outcome }) => outcome.kind === "queued")) return { kind: "queued" };
  if (
    records.some(({ outcome }) =>
      outcome.kind === "service-unavailable"
      || outcome.kind === "timeout"
      || outcome.kind === "aborted"
      || outcome.kind === "upstream-error"
      || outcome.kind === "error"
    )
  ) {
    return { kind: "service-unavailable" };
  }
  if (records.some(({ outcome }) => outcome.kind === "rate-limited")) {
    return { kind: "rate-limited" };
  }
  return { kind: "no-match" };
}

function abortError(): DOMException {
  return new DOMException("Provider acquisition aborted", "AbortError");
}

export async function runProviderAcquisition<Result>(
  task: (signal: AbortSignal) => Promise<ProviderAcquisitionOutcome<Result>>,
  parentSignal?: AbortSignal,
): Promise<ProviderAcquisitionOutcome<Result>> {
  if (parentSignal?.aborted) return { kind: "aborted" };

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });

  try {
    return await Promise.race([task(controller.signal), aborted]);
  } catch (error) {
    if (controller.signal.aborted) {
      return { kind: "aborted" };
    }
    if (error instanceof ProviderResponseError) return error.outcome;
    return { kind: "error", error };
  } finally {
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

export async function acquireProviderOutcomes<Provider, Result>(
  order: readonly Provider[],
  mode: "strict" | "concurrent",
  acquire: (
    provider: Provider,
    orderIndex: number,
  ) => Promise<ProviderAcquisitionOutcome<Result>>,
): Promise<Array<ProviderAcquisitionRecord<Provider, Result>>> {
  if (mode === "strict") {
    const records: Array<ProviderAcquisitionRecord<Provider, Result>> = [];
    for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
      const provider = order[orderIndex];
      const outcome = await acquire(provider, orderIndex);
      records.push({ provider, orderIndex, outcome });
      if (outcome.kind === "lyrics" || outcome.kind === "queued") break;
    }
    return records;
  }

  return Promise.all(order.map(async (provider, orderIndex) => ({
    provider,
    orderIndex,
    outcome: await acquire(provider, orderIndex),
  })));
}
