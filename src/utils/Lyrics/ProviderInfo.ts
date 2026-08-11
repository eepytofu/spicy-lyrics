export type ProviderInfoKind = "credit" | "rightsNotice" | "trackHeader";

const PROVIDER_INFO_KINDS = new Set<ProviderInfoKind>([
  "credit",
  "rightsNotice",
  "trackHeader",
]);

const LEGACY_CREDIT_LINE = /^(?:作\s*[词詞曲]|编\s*曲|編\s*曲|词\s*曲|詞\s*曲|制作人|製作人|监\s*制|監\s*製|lyric(?:s|ist)?|composer|arranger|producer)\s*[:：]/iu;

export function providerInfoKind(entry: any): ProviderInfoKind | undefined {
  const kind = entry?.ProviderInfoKind;
  return PROVIDER_INFO_KINDS.has(kind) ? kind : undefined;
}

export function isProviderInfoEntry(entry: any): boolean {
  return providerInfoKind(entry) !== undefined;
}

export function isProviderInfoEvidence(entry: any, text: string): boolean {
  if (isProviderInfoEntry(entry)) return true;
  return LEGACY_CREDIT_LINE.test(text);
}

export type IndexedLyricsEntry<T> = {
  entry: T;
  sourceIndex: number;
};

export function indexedVisibleLyricsEntries<T>(
  entries: readonly T[],
  infoEntry: (entry: T) => any,
  hideProviderInfo: boolean,
): IndexedLyricsEntry<T>[] {
  return entries.flatMap((entry, sourceIndex) =>
    hideProviderInfo && isProviderInfoEntry(infoEntry(entry))
      ? []
      : [{ entry, sourceIndex }]);
}
