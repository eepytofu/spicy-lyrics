import { isDev } from "../../components/Global/Defaults.ts";
import { GetExpireStore } from "../../modules/Store.ts";

export type ProcessedLyricsCacheEntry = Record<string, unknown>;

const processedLyricsStore = GetExpireStore<ProcessedLyricsCacheEntry>(
  "SpicyLyrics_LyricsStore_g1",
  2,
  {
    Unit: "Days",
    Duration: 3,
  },
  isDev as true,
);

export function readProcessedLyricsCache(
  trackId: string,
): Promise<ProcessedLyricsCacheEntry | undefined> {
  return processedLyricsStore.GetItem(trackId);
}

export async function writeProcessedLyricsCache(
  trackId: string,
  lyrics: ProcessedLyricsCacheEntry,
): Promise<void> {
  await processedLyricsStore.SetItem(trackId, lyrics);
}

export function removeProcessedLyricsCache(trackId: string): Promise<void> {
  return processedLyricsStore.RemoveItem(trackId);
}

export function clearProcessedLyricsCache(): Promise<void> {
  return processedLyricsStore.Destroy();
}
