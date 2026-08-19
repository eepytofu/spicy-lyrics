import type { NativeLyrics, ProviderId } from "./types";
import {
  markEmbeddedProviderInfo,
  type ProviderInfoContext,
} from "./provider-info";
import { markEmbeddedVocalCues } from "./vocal-cues";

export function markProviderLineSemantics(
  lyrics: NativeLyrics,
  provider: ProviderId,
  context: ProviderInfoContext,
): NativeLyrics {
  markEmbeddedProviderInfo(lyrics, provider, context);
  return markEmbeddedVocalCues(lyrics, provider, context);
}
