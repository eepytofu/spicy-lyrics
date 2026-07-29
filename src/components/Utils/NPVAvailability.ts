const NO_LYRICS_PREFIX = "NO_LYRICS:";

export function shouldHideNpvForMissingLyrics(
  enabled: boolean,
  currentUri: string | null | undefined,
  currentLyricsData: string,
): boolean {
  if (!enabled || !currentUri || !currentLyricsData.startsWith(NO_LYRICS_PREFIX)) return false;
  return currentLyricsData.slice(NO_LYRICS_PREFIX.length) === currentUri;
}
