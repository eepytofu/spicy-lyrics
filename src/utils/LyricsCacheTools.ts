import { SpotifyPlayer } from "../components/Global/SpotifyPlayer.ts";
import PageView from "../components/Pages/PageView.ts";
import { toast } from "sonner";
import fetchLyrics, { invalidateLyricsPipeline, LyricsStore } from "./Lyrics/fetchLyrics.ts";
import ApplyLyrics from "./Lyrics/Global/Applyer.ts";
import {
  clearAllManualLyricsSelections,
  clearManualLyricsSelection,
} from "./Lyrics/ManualLyricsSelection.ts";
import { $currentLyricsData } from "./stores.ts";

let cacheOperation: Promise<void> | null = null;

async function refetchCurrentLyrics(): Promise<void> {
  if (!PageView.IsOpened) return;
  const uri = SpotifyPlayer.GetUri();
  if (!uri) return;
  const result = await fetchLyrics(uri);
  if (result) await ApplyLyrics(result);
}

async function runCacheOperation(
  operation: () => Promise<void>,
  successMessage: string,
  failureMessage: string,
  ui: boolean
): Promise<void> {
  if (cacheOperation) {
    if (ui) toast.info("A lyrics cache refresh is already running");
    return cacheOperation;
  }

  const task = (async () => {
    invalidateLyricsPipeline();
    await operation();
    $currentLyricsData.set("");
    if (ui) toast.success(successMessage);
    await refetchCurrentLyrics();
  })();

  cacheOperation = task;
  try {
    await task;
  } catch (error) {
    if (ui) toast.error(failureMessage);
    console.error("SpicyLyrics:", error);
  } finally {
    if (cacheOperation === task) cacheOperation = null;
  }
}

export const RemoveCurrentLyrics_AllCaches = async (ui: boolean = false) => {
  const currentSongId = SpotifyPlayer.GetId();
  const currentUri = SpotifyPlayer.GetUri();
  if (!currentSongId || !currentUri) {
    if (ui) toast.error("The current song id could not be retrieved");
    return;
  }

  await runCacheOperation(
    async () => {
      await Promise.all([
        LyricsStore.RemoveItem(currentSongId),
        clearManualLyricsSelection(currentUri),
      ]);
    },
    "Cleared cached lyrics for the current song",
    "Could not clear cached lyrics for the current song. Check the console for details.",
    ui
  );
};

export const RemoveLyricsCache = async (ui: boolean = false) => {
  await runCacheOperation(
    async () => {
      await Promise.all([
        LyricsStore.Destroy(),
        clearAllManualLyricsSelections(),
      ]);
    },
    "Cleared the stored lyrics cache",
    "Could not clear the stored lyrics cache. Check the console for details.",
    ui
  );
};

export const RemoveCurrentLyrics_StateCache = async (ui: boolean = false) => {
  await runCacheOperation(
    async () => {},
    "Cleared the current lyrics state",
    "Could not clear the current lyrics state. Check the console for details.",
    ui
  );
};
