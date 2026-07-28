import { amllDbProvider } from "./providers/amlldb";
import { kugouProvider } from "./providers/kugou";
import { neteaseProvider } from "./providers/netease";
import { qqProvider } from "./providers/qq";
import { sodaProvider } from "./providers/soda";
import type {
  LyricsProvider,
  NativeLyrics,
  ProviderId,
  ProviderMatchMetadata,
  ProviderRequestContext,
  TrackMetadata,
} from "./types";

export type WorkerProviderId = ProviderId | "amlldb";

export type ProviderPayload =
  | {
      format: "json";
      lyrics: NativeLyrics;
    }
  | {
      format: "ttml";
      ttml: string;
      match: ProviderMatchMetadata;
    };

export type ProviderAdapter = (
  track: TrackMetadata,
  context: ProviderRequestContext,
) => Promise<ProviderPayload | undefined>;

export type ProviderAdapterRegistry = Record<WorkerProviderId, ProviderAdapter>;

export type ProviderAcquisitionOutcome =
  | { kind: "lyrics"; payload: ProviderPayload }
  | { kind: "no-match" }
  | { kind: "timeout" }
  | { kind: "aborted" }
  | { kind: "error"; error: unknown };

function nativeAdapter(provider: LyricsProvider): ProviderAdapter {
  return async (track, context) => {
    const lyrics = await provider(track, context);
    return lyrics ? { format: "json", lyrics } : undefined;
  };
}

export const providerAdapters: ProviderAdapterRegistry = {
  amlldb: async (track, context) => {
    const result = await amllDbProvider(track, context);
    return result ? { format: "ttml", ...result } : undefined;
  },
  qq: nativeAdapter(qqProvider),
  kugou: nativeAdapter(kugouProvider),
  netease: nativeAdapter(neteaseProvider),
  soda: nativeAdapter(sodaProvider),
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object"
      && error !== null
      && "name" in error
      && (error as { name?: unknown }).name === "AbortError";
}

export async function acquireProvider(
  provider: WorkerProviderId,
  track: TrackMetadata,
  context: ProviderRequestContext,
  adapters: ProviderAdapterRegistry = providerAdapters,
): Promise<ProviderAcquisitionOutcome> {
  if (context.signal?.aborted) return { kind: "aborted" };
  try {
    const payload = await adapters[provider](track, context);
    if (context.signal?.aborted) return { kind: "aborted" };
    return payload ? { kind: "lyrics", payload } : { kind: "no-match" };
  } catch (error) {
    if (context.signal?.aborted) return { kind: "aborted" };
    if (isAbortError(error)) return { kind: "timeout" };
    return { kind: "error", error };
  }
}
