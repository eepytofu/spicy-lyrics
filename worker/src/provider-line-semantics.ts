import {
  isProviderInfoKind,
  isVocalCue,
  type NativeLyrics,
  type ProviderId,
  type TrackMetadata,
} from "./types";
import {
  markEmbeddedProviderInfo,
} from "./provider-info";
import { markEmbeddedVocalCues } from "./vocal-cues";

export type ProviderLineSemanticContext = {
  reference: TrackMetadata;
  selected?: {
    title: string;
    titleAliases?: string[];
    artists: string[];
    artistAliases?: string[];
  };
};

export function markProviderLineSemantics(
  lyrics: NativeLyrics,
  provider: ProviderId,
  context: ProviderLineSemanticContext,
): NativeLyrics {
  markEmbeddedProviderInfo(lyrics, provider, context);
  return markEmbeddedVocalCues(lyrics, provider, context);
}

export function hasOrdinaryLyricContent(lyrics: NativeLyrics): boolean {
  const entries = lyrics.Type === "Static"
    ? ((lyrics.Lines as Array<Record<string, unknown>> | undefined) ?? [])
    : ((lyrics.Content as Array<Record<string, any>> | undefined) ?? []).map((line) =>
      lyrics.Type === "Syllable" ? line.Lead : line);
  return entries.some((entry) =>
    !isProviderInfoKind(entry?.ProviderInfoKind) && !isVocalCue(entry?.VocalCue));
}
