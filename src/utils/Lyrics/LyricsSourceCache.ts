export function isLyricsSourceCacheCompatible(
  lyrics: unknown,
  currentSourceSignature: string,
  translationSidecarSchemaVersion: number
): boolean {
  if (!lyrics || typeof lyrics !== "object") return false;
  const entry = lyrics as Record<string, unknown>;

  if (typeof entry.fetchProvider === "string") {
    return entry.LyricsSourceCacheSignature === currentSourceSignature;
  }
  if (entry.source === "ldb") {
    return entry.TranslationSidecarSchemaVersion === translationSidecarSchemaVersion;
  }
  return false;
}
