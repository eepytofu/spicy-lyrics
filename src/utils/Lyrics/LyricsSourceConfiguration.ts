import {
  $customLyricsServers,
  $disabledLyricsSources,
  $externalLyricsWorkerUrl,
  $ignoreMusixmatchSyllableSync,
  $lyricsSelectionMode,
  $lyricsSourceOrder,
  $prioritizeAppleMusicQuality,
} from "../stores.ts";
import {
  normalizeDisabledLyricsSourceIds,
  normalizeLyricsSourceOrder,
  parseCustomLyricsServers,
  type LyricsSourceProviderId,
} from "./LyricsSourcePreferences.ts";

export const LYRICS_SOURCE_CACHE_VERSION = 32;

export function getActiveLyricsSourceOrder(): LyricsSourceProviderId[] {
  const custom = parseCustomLyricsServers($customLyricsServers.get());
  const disabled = new Set(normalizeDisabledLyricsSourceIds($disabledLyricsSources.get(), custom));
  return normalizeLyricsSourceOrder($lyricsSourceOrder.get(), custom).filter(
    (provider) => !disabled.has(provider)
  );
}

export function lyricsSourceCacheSignature(): string {
  return JSON.stringify({
    version: LYRICS_SOURCE_CACHE_VERSION,
    order: getActiveLyricsSourceOrder(),
    worker: $externalLyricsWorkerUrl.get().trim().replace(/\/+$/, ""),
    custom: parseCustomLyricsServers($customLyricsServers.get()),
    ignoreMusixmatchSyllableSync: $ignoreMusixmatchSyllableSync.get(),
    prioritizeAppleMusicQuality: $prioritizeAppleMusicQuality.get(),
    lyricsSelectionMode: $lyricsSelectionMode.get(),
  });
}
