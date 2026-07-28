export type ProviderAcquisitionOutcome<Result> =
  | { kind: "lyrics"; result: Result }
  | { kind: "queued" }
  | { kind: "no-match" }
  | { kind: "timeout" }
  | { kind: "aborted" }
  | { kind: "error"; error: unknown };

export type ProviderAcquisitionRecord<Provider, Result> = {
  provider: Provider;
  orderIndex: number;
  outcome: ProviderAcquisitionOutcome<Result>;
};

function abortError(): DOMException {
  return new DOMException("Provider acquisition aborted", "AbortError");
}

export async function runProviderAcquisition<Result>(
  task: (signal: AbortSignal) => Promise<ProviderAcquisitionOutcome<Result>>,
  parentSignal?: AbortSignal,
  timeoutMs = 6500,
): Promise<ProviderAcquisitionOutcome<Result>> {
  if (parentSignal?.aborted) return { kind: "aborted" };

  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });

  try {
    return await Promise.race([task(controller.signal), aborted]);
  } catch (error) {
    if (controller.signal.aborted) {
      return { kind: timedOut ? "timeout" : "aborted" };
    }
    return { kind: "error", error };
  } finally {
    clearTimeout(timer);
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
