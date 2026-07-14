import type { RomanizationBranch } from "../Fork/TextDetection.ts";

type ReadingEntry = {
  Text?: string;
  RomanizedText?: string;
  TransliteratedText?: string;
  ProviderRomanizedText?: string;
};

const LocalReadingTests: Partial<Record<RomanizationBranch, RegExp>> = {
  Japanese: /[\u3040-\u30ff\u4e00-\u9fff]/u,
  Chinese: /[\u4e00-\u9fff]/u,
  Korean: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u,
  Cyrillic: /[\u0400-\u052f\u2de0-\u2dff\ua640-\ua69f]/u,
};

function readingText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function shouldUseConfiguredLocalReading(
  targetText: string,
  branches: readonly RomanizationBranch[]
): boolean {
  return branches.some((branch) => LocalReadingTests[branch]?.test(targetText) === true);
}

export function preserveProviderReading(entry: ReadingEntry): string | undefined {
  const existing = readingText(entry.ProviderRomanizedText);
  if (existing) return existing;

  const current = readingText(entry.RomanizedText) ?? readingText(entry.TransliteratedText);
  if (current) entry.ProviderRomanizedText = current;
  return current;
}

export function restoreProviderReading(entry: ReadingEntry): boolean {
  const provider = readingText(entry.ProviderRomanizedText);
  if (!provider) return false;
  entry.RomanizedText = provider;
  entry.TransliteratedText = provider;
  return true;
}
