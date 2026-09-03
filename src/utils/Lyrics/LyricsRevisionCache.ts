import { GetExpireStore } from "../../modules/Store.ts";
import { isLyricRevision } from "./LyricRevision.ts";

export const LyricsRevisionStore = GetExpireStore<any>("SpicyLyrics_LyricsRevisionStore_g1", 1, {
  Unit: "Days",
  Duration: 3,
});

export function removeLyricsRevisionCache(revisionId: string): Promise<void> {
  return LyricsRevisionStore.RemoveItem(revisionId);
}

export function clearLyricsRevisionCache(): Promise<void> {
  return LyricsRevisionStore.Destroy();
}

export function isLyricsRevisionCacheCompatible(lyrics: unknown, revisionId: string): boolean {
  if (!lyrics || typeof lyrics !== "object" || Array.isArray(lyrics)) return false;
  const entry = lyrics as Record<string, unknown>;
  return isLyricRevision(entry.LyricRevision) && entry.LyricRevision.id === revisionId;
}
