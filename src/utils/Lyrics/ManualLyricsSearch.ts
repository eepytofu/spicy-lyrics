import type { LyricsSourceProviderId } from "./LyricsSourcePreferences.ts";

export type LyricsSearchOverrides = {
  title?: string;
  artist?: string;
};

export type CompleteLyricsSearchOverrides = {
  title: string;
  artist: string;
};

const TRACK_ID_ONLY_PROVIDERS = new Set<LyricsSourceProviderId>([
  "spicy",
  "apple",
  "spotify",
]);

export function normalizeLyricsSearchOverrides(
  overrides: LyricsSearchOverrides = {},
): LyricsSearchOverrides {
  const title = overrides.title?.trim();
  const artist = overrides.artist?.trim();
  return {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
  };
}

export function completeLyricsSearchOverrides(
  overrides: LyricsSearchOverrides = {},
): CompleteLyricsSearchOverrides | null {
  const normalized = normalizeLyricsSearchOverrides(overrides);
  return normalized.title && normalized.artist
    ? { title: normalized.title, artist: normalized.artist }
    : null;
}

export function manualLyricsSearchProviders(
  order: LyricsSourceProviderId[],
): LyricsSourceProviderId[] {
  return order.filter((provider) => !TRACK_ID_ONLY_PROVIDERS.has(provider));
}
