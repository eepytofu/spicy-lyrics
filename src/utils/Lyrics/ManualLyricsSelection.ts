import { GetExpireStore } from "../../modules/Store.ts";
import {
  completeLyricsSearchOverrides,
  type CompleteLyricsSearchOverrides,
} from "./ManualLyricsSearch.ts";

export type ManualLyricsSelection = {
  trackUri: string;
  revisionId: string;
  automaticRevisionId: string | null;
  searchOverrides?: CompleteLyricsSearchOverrides;
};

export const ManualLyricsSelectionStore = GetExpireStore<ManualLyricsSelection>(
  "SpicyLyrics_ManualLyricsSelectionStore_g1",
  1,
  { Unit: "Days", Duration: 3 },
);

function trackKey(uri: string): string | null {
  const match = /^spotify:track:([^:]+)$/.exec(uri);
  return match?.[1] ?? null;
}

function normalizeManualLyricsSelection(
  value: unknown,
  trackUri: string,
): ManualLyricsSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    entry.trackUri !== trackUri
    || typeof entry.revisionId !== "string"
    || entry.revisionId.length === 0
    || !(
      entry.automaticRevisionId === null
      || (typeof entry.automaticRevisionId === "string" && entry.automaticRevisionId.length > 0)
    )
  ) return null;

  const rawSearchOverrides = entry.searchOverrides && typeof entry.searchOverrides === "object"
    && !Array.isArray(entry.searchOverrides)
    ? entry.searchOverrides as Record<string, unknown>
    : null;
  const searchOverrides = completeLyricsSearchOverrides({
    title: typeof rawSearchOverrides?.title === "string" ? rawSearchOverrides.title : undefined,
    artist: typeof rawSearchOverrides?.artist === "string" ? rawSearchOverrides.artist : undefined,
  });
  return {
    trackUri,
    revisionId: entry.revisionId,
    automaticRevisionId: entry.automaticRevisionId,
    ...(searchOverrides ? { searchOverrides } : {}),
  };
}

export async function getManualLyricsSelection(
  trackUri: string,
): Promise<ManualLyricsSelection | null> {
  const key = trackKey(trackUri);
  if (!key) return null;
  const stored = await ManualLyricsSelectionStore.GetItem(key);
  const selection = normalizeManualLyricsSelection(stored, trackUri);
  if (selection) return selection;
  if (stored !== undefined) await ManualLyricsSelectionStore.RemoveItem(key);
  return null;
}

export async function rememberManualLyricsSelection(
  selection: ManualLyricsSelection,
): Promise<void> {
  const key = trackKey(selection.trackUri);
  const normalized = normalizeManualLyricsSelection(selection, selection.trackUri);
  if (!key || !normalized) return;
  await ManualLyricsSelectionStore.SetItem(key, normalized);
}

export async function clearManualLyricsSelection(trackUri: string): Promise<void> {
  const key = trackKey(trackUri);
  if (!key) return;
  await ManualLyricsSelectionStore.RemoveItem(key);
}

export async function clearAllManualLyricsSelections(): Promise<void> {
  await ManualLyricsSelectionStore.Destroy();
}
