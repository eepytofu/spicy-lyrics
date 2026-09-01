const NO_LYRICS_PREFIX = "NO_LYRICS:";

/** Decide whether delayed apply recovery should refetch the current track. */
export function shouldRefetchAfterApply(
  savedLyrics: string | null | undefined,
  currentUri: string | null | undefined,
): boolean {
  if (!savedLyrics || !currentUri) return false;
  if (savedLyrics.startsWith(NO_LYRICS_PREFIX)) {
    return savedLyrics.slice(NO_LYRICS_PREFIX.length) !== currentUri;
  }

  try {
    return JSON.parse(savedLyrics)?.uri !== currentUri;
  } catch {
    return true;
  }
}
