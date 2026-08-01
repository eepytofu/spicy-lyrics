import {
  ArabicTextTest,
  type RomanizationBranch,
} from "../Fork/TextDetection.ts";
import type { ReadingProvenance } from "./Model.ts";

type ReadingEntry = {
  Text?: string;
  RomanizedText?: string;
  TransliteratedText?: string;
  ProviderRomanizedText?: string;
};

export type TimedLineReadingSelection = {
  text: string;
  provenance: ReadingProvenance;
  usesLineContext: boolean;
};

const LocalReadingTests: Partial<Record<RomanizationBranch, RegExp>> = {
  Japanese: /[\u3040-\u30ff\u4e00-\u9fff]/u,
  Chinese: /[\u4e00-\u9fff]/u,
  Korean: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u,
  Cyrillic: /[\u0400-\u052f\u2de0-\u2dff\ua640-\ua69f]/u,
};

const RemoteGeneratedReadingTests: Partial<Record<RomanizationBranch, RegExp>> = {
  Arabic: ArabicTextTest,
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

export function shouldPreferGeneratedReading(
  targetText: string,
  branches: readonly RomanizationBranch[]
): boolean {
  return shouldUseConfiguredLocalReading(targetText, branches) ||
    branches.some((branch) => RemoteGeneratedReadingTests[branch]?.test(targetText) === true);
}

export function selectTimedLineReading(
  isArabicLine: boolean,
  generatedLineReading: string | undefined,
  providerGroupReading?: string,
  providerSyllableReading?: string,
): TimedLineReadingSelection | undefined {
  if (generatedLineReading) {
    return {
      text: generatedLineReading,
      provenance: isArabicLine ? "remoteFallback" : "local",
      usesLineContext: isArabicLine,
    };
  }

  // Provider fallback was introduced for Arabic because its generated reading
  // is remote and may be unavailable. Other configured processors keep owning
  // their reading text; provider timing chunks must not silently redefine
  // Pinyin, Cyrillic, or another local reading's display boundaries.
  if (!isArabicLine) return undefined;
  if (providerGroupReading) {
    return {
      text: providerGroupReading,
      provenance: "provider",
      usesLineContext: true,
    };
  }
  if (providerSyllableReading) {
    return {
      text: providerSyllableReading,
      provenance: "provider",
      usesLineContext: false,
    };
  }
  return undefined;
}

export function preserveProviderReading(entry: ReadingEntry): string | undefined {
  const existing = readingText(entry.ProviderRomanizedText);
  if (existing) return existing;

  const current = readingText(entry.RomanizedText) ?? readingText(entry.TransliteratedText);
  if (current) entry.ProviderRomanizedText = current;
  return current;
}

export function preserveProviderReadingWithoutResidual(
  entry: ReadingEntry,
  residualScript: RegExp,
): string | undefined {
  const reading = preserveProviderReading(entry);
  if (!reading || !residualScript.test(reading)) return reading;
  // Keep the exact provider value as evidence, but do not leave a same-script
  // echo in the display aliases where it can masquerade as a reading.
  delete entry.RomanizedText;
  delete entry.TransliteratedText;
  return undefined;
}

export function restoreProviderReading(entry: ReadingEntry): boolean {
  const provider = readingText(entry.ProviderRomanizedText);
  if (!provider) return false;
  entry.RomanizedText = provider;
  entry.TransliteratedText = provider;
  return true;
}

export function restoreProviderReadingWithoutResidual(
  entry: ReadingEntry,
  residualScript: RegExp,
): boolean {
  const provider = readingText(entry.ProviderRomanizedText);
  if (!provider || residualScript.test(provider)) return false;
  entry.RomanizedText = provider;
  entry.TransliteratedText = provider;
  return true;
}
