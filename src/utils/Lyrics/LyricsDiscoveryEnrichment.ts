import type { LyricsSourceProviderId } from "./LyricsSourcePreferences.ts";
import type { LyricsMatchMetadata } from "./LyricsCandidateSelector.ts";
import type {
  ProviderAcquisitionOutcome,
  ProviderAcquisitionRecord,
} from "./ProviderAcquisition.ts";

const METADATA_WORKER_PROVIDERS = new Set<LyricsSourceProviderId>([
  "amlldb",
  "qq",
  "kugou",
  "soda",
]);

export const NATIVE_TITLE_ENRICHMENT_BUDGET_MS = 8_000;

export type NativeTitleEnrichmentOptions = {
  signal?: AbortSignal;
  budgetMs?: number;
};

const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;

type EnrichableLyricsResult = {
  lyrics: Record<string, unknown>;
  match?: LyricsMatchMetadata;
};

export type NativeTitleHint = {
  title: string;
  discovery: NonNullable<LyricsMatchMetadata["discovery"]>;
};

function normalizedTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function resultMatch(result: EnrichableLyricsResult): LyricsMatchMetadata | undefined {
  const sourceMatch = result.lyrics.SourceMatch;
  return result.match
    ?? (sourceMatch && typeof sourceMatch === "object"
      ? sourceMatch as LyricsMatchMetadata
      : undefined);
}

function reliableNeteaseHintMatch(match: LyricsMatchMetadata): boolean {
  return match.coherent === true
    && match.evidence?.versionConflict === false
    && match.discoveryEvidence?.canonicalTitleVersionConflict === false
    && (
      (match.evidence.artists ?? 0) >= 0.85
      || (match.discoveryEvidence.bestRequestedArtist ?? 0) >= 0.85
    )
    && (match.evidence.duration ?? 0) >= 0.8;
}

export function nativeTitleHint(
  originalTitle: string,
  result: EnrichableLyricsResult,
): NativeTitleHint | null {
  const match = resultMatch(result);
  const title = match?.title?.trim() ?? "";
  const normalizedOriginal = normalizedTitle(originalTitle);
  const normalizedRecovered = normalizedTitle(title);
  if (
    !normalizedOriginal
    || !normalizedRecovered
    || normalizedOriginal === normalizedRecovered
    || !LATIN_SCRIPT.test(originalTitle)
    || CJK_SCRIPT.test(originalTitle)
    || !CJK_SCRIPT.test(title)
    || !match
    || !reliableNeteaseHintMatch(match)
  ) {
    return null;
  }
  return {
    title,
    discovery: {
      kind: "netease-native-title",
      provider: "netease",
      originalTitle,
      queryTitle: title,
    },
  };
}

export function nativeTitleRetryProvider(provider: LyricsSourceProviderId): boolean {
  return METADATA_WORKER_PROVIDERS.has(provider);
}

export function nativeTitleRetryInfo<T extends { title: string }>(
  info: T,
  hint: NativeTitleHint,
): T {
  return { ...info, title: hint.title };
}

export function isAcceptedNativeTitleResult(result: EnrichableLyricsResult): boolean {
  const match = resultMatch(result);
  const duration = match?.evidence?.duration;
  return match?.coherent === true
    && match.evidence?.versionConflict === false
    && match.discoveryEvidence?.canonicalTitleVersionConflict === false
    && (match.evidence.title ?? 0) >= 0.9
    && (match.evidence.artists ?? 0) >= 0.85
    && (duration === null || duration === undefined || duration >= 0.8);
}

function annotateNativeTitleResult<Result extends EnrichableLyricsResult>(
  result: Result,
  hint: NativeTitleHint,
): Result {
  const match = resultMatch(result);
  if (!match) return result;
  const enrichedMatch = { ...match, discovery: hint.discovery };
  return {
    ...result,
    match: enrichedMatch,
    lyrics: {
      ...result.lyrics,
      SourceMatch: enrichedMatch,
    },
  };
}

type NativeTitleRetryWindow = {
  signal: AbortSignal;
  aborted: Promise<null>;
  dispose: () => void;
};

function createNativeTitleRetryWindow(
  parentSignal: AbortSignal | undefined,
  remainingBudgetMs: number,
): NativeTitleRetryWindow {
  const controller = new AbortController();
  let resolveAbort!: () => void;
  const aborted = new Promise<null>((resolve) => { resolveAbort = () => resolve(null); });
  controller.signal.addEventListener("abort", resolveAbort, { once: true });

  const onParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Native-title enrichment budget expired", "TimeoutError")),
    remainingBudgetMs,
  );

  return {
    signal: controller.signal,
    aborted,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

export async function acquireWithNativeTitleEnrichment<Result extends EnrichableLyricsResult>(
  order: readonly LyricsSourceProviderId[],
  originalTitle: string,
  acquire: (
    provider: LyricsSourceProviderId,
    hint?: NativeTitleHint,
    signal?: AbortSignal,
  ) => Promise<ProviderAcquisitionOutcome<Result>>,
  options: NativeTitleEnrichmentOptions = {},
): Promise<Array<ProviderAcquisitionRecord<LyricsSourceProviderId, Result>>> {
  const { signal, budgetMs = NATIVE_TITLE_ENRICHMENT_BUDGET_MS } = options;
  const enrichmentDeadline = performance.now() + Math.max(0, budgetMs);
  const basePromises = order.map(async (provider, orderIndex) => ({
    provider,
    orderIndex,
    outcome: await acquire(provider),
  }));
  const neteaseIndex = order.indexOf("netease");
  if (neteaseIndex < 0 || !order.some(nativeTitleRetryProvider)) return Promise.all(basePromises);

  const neteaseRecord = await basePromises[neteaseIndex];
  if (signal?.aborted || neteaseRecord.outcome.kind !== "lyrics") return Promise.all(basePromises);
  const hint = nativeTitleHint(originalTitle, neteaseRecord.outcome.result);
  if (!hint || signal?.aborted) return Promise.all(basePromises);

  const remainingBudgetMs = enrichmentDeadline - performance.now();
  if (remainingBudgetMs <= 0) return Promise.all(basePromises);
  const retryWindow = createNativeTitleRetryWindow(signal, remainingBudgetMs);
  try {
    const retryPromises = order.map(async (provider, orderIndex) => {
      if (!nativeTitleRetryProvider(provider)) return null;
      const baseRecord = await basePromises[orderIndex];
      if (retryWindow.signal.aborted || baseRecord.outcome.kind !== "no-match") return null;
      const retried = await Promise.race([
        acquire(provider, hint, retryWindow.signal),
        retryWindow.aborted,
      ]);
      if (!retried || retried.kind !== "lyrics" || !isAcceptedNativeTitleResult(retried.result)) return null;
      return annotateNativeTitleResult(retried.result, hint);
    });

    const [baseRecords, retries] = await Promise.all([
      Promise.all(basePromises),
      Promise.all(retryPromises),
    ]);
    return baseRecords.map((record, index) => {
      const result = retries[index];
      return result
        ? { ...record, outcome: { kind: "lyrics" as const, result } }
        : record;
    });
  } finally {
    retryWindow.dispose();
  }
}
