export type ProviderInfoKind = "trackHeader" | "credit" | "rightsHolder" | "rightsNotice" | "providerNotice";

const PROVIDER_INFO_KINDS = new Set<ProviderInfoKind>([
  "trackHeader",
  "credit",
  "rightsHolder",
  "rightsNotice",
  "providerNotice",
]);

export function isProviderInfoKind(value: unknown): value is ProviderInfoKind {
  return PROVIDER_INFO_KINDS.has(value as ProviderInfoKind);
}

// Frozen compatibility fallback for unversioned or legacy external payloads.
// New classification belongs in the Worker and must not expand this regex.
const LEGACY_CREDIT_LINE = /^(?:作\s*[词詞曲]|编\s*曲|編\s*曲|词\s*曲|詞\s*曲|制作人|製作人|监\s*制|監\s*製|lyric(?:s|ist)?|composer|arranger|producer)\s*[:：]/iu;

export function providerInfoKind(entry: any): ProviderInfoKind | undefined {
  const kind = entry?.ProviderInfoKind;
  return isProviderInfoKind(kind) ? kind : undefined;
}

export function isProviderInfoEntry(entry: any): boolean {
  return providerInfoKind(entry) !== undefined;
}

export function isProviderInfoMatchingEvidence(entry: any, text: string): boolean {
  return isProviderInfoEntry(entry) || LEGACY_CREDIT_LINE.test(text);
}
