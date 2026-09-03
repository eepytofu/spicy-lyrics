import { SpotifyPlayer } from "../components/Global/SpotifyPlayer.ts";
import PageView from "../components/Pages/PageView.ts";
import { toast } from "sonner";
import fetchLyrics, { invalidateLyricsPipeline } from "./Lyrics/fetchLyrics.ts";
import ApplyLyrics from "./Lyrics/Global/Applyer.ts";
import {
  clearAllManualLyricsSelections,
  clearManualLyricsSelection,
} from "./Lyrics/ManualLyricsSelection.ts";
import { $currentLyricsData } from "./stores.ts";
import {
  performCacheOperation,
  type CacheOperationOutcome,
} from "./CacheOperation.ts";
import {
  clearProcessedLyricsCache,
  removeProcessedLyricsCache,
} from "./Lyrics/ProcessedLyricsCache.ts";

let cacheOperation: Promise<CacheOperationOutcome> | null = null;

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
  refreshFailureMessage: string,
  ui: boolean
): Promise<void> {
  if (cacheOperation) {
    if (ui) toast.info("A lyrics cache refresh is already running");
    await cacheOperation;
    return;
  }

  const task = performCacheOperation(
    async () => {
      invalidateLyricsPipeline();
      await operation();
      $currentLyricsData.set("");
    },
    refetchCurrentLyrics,
  );

  cacheOperation = task;
  try {
    const outcome = await task;
    if (outcome.kind === "success") {
      if (ui) toast.success(successMessage);
      return;
    }
    if (outcome.kind === "operation-failed") {
      if (ui) toast.error(failureMessage);
      console.error("SpicyLyrics: cache operation failed", outcome.error);
      return;
    }
    if (ui) toast.warning(refreshFailureMessage);
    console.error("SpicyLyrics: post-clear lyrics refresh failed", outcome.error);
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
        removeProcessedLyricsCache(currentSongId),
        clearManualLyricsSelection(currentUri),
      ]);
    },
    "Cleared cached lyrics for the current song",
    "Could not clear cached lyrics for the current song. Check the console for details.",
    "Cleared cached lyrics, but could not refresh the current song. Check the console for details.",
    ui
  );
};

export const RemoveLyricsCache = async (ui: boolean = false) => {
  await runCacheOperation(
    async () => {
      await Promise.all([
        clearProcessedLyricsCache(),
        clearAllManualLyricsSelections(),
      ]);
    },
    "Cleared the stored lyrics cache",
    "Could not clear the stored lyrics cache. Check the console for details.",
    "Cleared the stored lyrics cache, but could not refresh the current song. Check the console for details.",
    ui
  );
};

export const RemoveCurrentLyrics_StateCache = async (ui: boolean = false) => {
  await runCacheOperation(
    async () => {},
    "Cleared the current lyrics state",
    "Could not clear the current lyrics state. Check the console for details.",
    "Cleared the current lyrics state, but could not refresh the song. Check the console for details.",
    ui
  );
};
