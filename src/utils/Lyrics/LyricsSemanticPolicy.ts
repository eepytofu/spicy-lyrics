import {
  isProviderInfoEntry,
  isProviderInfoMatchingEvidence,
  providerInfoKind,
} from "./ProviderInfo.ts";
import { isVocalCueEntry } from "./VocalSemantics.ts";

export function shouldExcludeFromLyricsMatching(entry: any, text: string): boolean {
  return isProviderInfoMatchingEvidence(entry, text) || isVocalCueEntry(entry);
}

export function shouldSkipGeneratedLyricsProcessing(entry: any): boolean {
  return isProviderInfoEntry(entry) || isVocalCueEntry(entry);
}

export type LyricsDisplayPolicy = {
  hideProviderInfo: boolean;
  showVocalistLabels: boolean;
};

export type LyricsCopyPolicy = {
  hideProviderInfo: boolean;
  showVocalistLabels: boolean;
};

function shouldSuppressProviderInfo(entry: any, hideProviderInfo: boolean): boolean {
  const kind = providerInfoKind(entry);
  return kind === "providerNotice" || (hideProviderInfo && kind !== undefined);
}

export function shouldHideLyricsDisplayEntry(entry: any, policy: LyricsDisplayPolicy): boolean {
  return shouldSuppressProviderInfo(entry, policy.hideProviderInfo)
    || (!policy.showVocalistLabels && isVocalCueEntry(entry));
}

export function shouldExcludeLyricsCopyEntry(entry: any, policy: LyricsCopyPolicy): boolean {
  return shouldSuppressProviderInfo(entry, policy.hideProviderInfo)
    || (!policy.showVocalistLabels && isVocalCueEntry(entry));
}

export type IndexedLyricsEntry<T> = {
  entry: T;
  sourceIndex: number;
};

export function indexedVisibleLyricsEntries<T>(
  entries: readonly T[],
  semanticEntry: (entry: T) => any,
  policy: LyricsDisplayPolicy,
): IndexedLyricsEntry<T>[] {
  return entries.flatMap((entry, sourceIndex) =>
    shouldHideLyricsDisplayEntry(semanticEntry(entry), policy)
      ? []
      : [{ entry, sourceIndex }]);
}
