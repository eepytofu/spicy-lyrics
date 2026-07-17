/**
 * DOM renderer for lyric sidecar text: Japanese furigana, romaji, translation.
 *
 * Applyers own timing/animation registration. This module owns only display
 * decisions and stable markup so furigana does not leak into every renderer.
 */

import { $japaneseReadingMode } from "../../uiState.ts";
import { isMeaningfullyDifferent } from "../TextCompare.ts";
import { resolveTranslationSidecars } from "../TranslationSidecar.ts";
import {
  JapaneseKanaTextTest,
  type FuriganaSegment,
  type JapaneseReadable,
  type JapaneseReading,
} from "../Reading/JapaneseReading.ts";
import type { RenderPlan } from "../Processing/Model.ts";
import { renderExperimentalReadingPlan } from "./ExperimentalReadingPlanRenderer.ts";

export type ReadingRenderOptions = {
  useRomanized: boolean;
  romanizationPending?: boolean;
  translationPending?: boolean;
  translationLanguage?: string;
  showProviderTranslations?: boolean;
  isJapaneseLyrics?: boolean;
  oppositeAligned?: boolean;
  reserveFurigana?: boolean;
  /** Readings drawn once by an enclosing timed furigana group; member words skip their own copy. */
  suppressedRubyReadings?: readonly string[];
};

type SyllableLike = JapaneseReadable & {
  IsPartOfWord?: boolean;
  RomajiSpaceBefore?: boolean;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function getJapaneseReading(entry: JapaneseReadable | undefined): JapaneseReading | undefined {
  return entry?.JapaneseReading;
}

export function hasFurigana(entry: JapaneseReadable | undefined): boolean {
  return (getJapaneseReading(entry)?.furigana.length || 0) > 0;
}

/**
 * Ruby geometry belongs to the complete Japanese line, not karaoke fragments.
 * A renderer can safely re-base only ruby fully contained by one timed source
 * unit. Crossing ruby must use the whole-line path; otherwise its full reading
 * is drawn once for every intersecting fragment.
 */
export function hasFuriganaCrossingTimedUnits(readingPlan: RenderPlan | undefined): boolean {
  const ruby = (readingPlan?.furigana || []) as Array<{
    start?: number;
    end?: number;
    canonicalRange?: { startCp: number; endCp: number };
  }>;
  const sourceUnits = readingPlan?.sourceUnits || [];
  return ruby.some((segment) => {
    // Accept both raw {start,end} segments and annotation {canonicalRange} segments.
    const start = segment.canonicalRange?.startCp ?? segment.start;
    const end = segment.canonicalRange?.endCp ?? segment.end;
    if (typeof start !== "number" || typeof end !== "number") return false;
    return !sourceUnits.some((unit) => start >= unit.canonicalRange.startCp && end <= unit.canonicalRange.endCp);
  });
}

export function isJapaneseEntry(entry: JapaneseReadable | undefined, isJapaneseLyrics?: boolean): boolean {
  if (!entry) return !!isJapaneseLyrics;
  if (entry.ReadingPrimaryScript === "Chinese") return false;
  if (entry.ReadingPrimaryScript === "Japanese") return true;
  return !!isJapaneseLyrics || !!entry.JapaneseReading || JapaneseKanaTextTest.test(entry.Text || "");
}

export function shouldRenderFurigana(entry: JapaneseReadable | undefined, options: ReadingRenderOptions): boolean {
  return options.useRomanized && $japaneseReadingMode.get() !== "romaji" && hasFurigana(entry);
}

export function shouldRenderRomanization(entry: JapaneseReadable | undefined, options: ReadingRenderOptions): boolean {
  if (!options.useRomanized) return false;
  const isJapanese = isJapaneseEntry(entry, options.isJapaneseLyrics);
  return !isJapanese || $japaneseReadingMode.get() !== "furigana";
}

function appendPlainText(parent: HTMLElement, text: string): void {
  if (!text) return;

  const cluster = document.createElement("span");
  cluster.className = "furigana-cluster furigana-plain-cluster";

  const reading = document.createElement("span");
  reading.className = "furigana-reading furigana-placeholder";
  reading.textContent = "\u00a0";

  const base = document.createElement("span");
  base.className = "furigana-base";
  base.textContent = text;

  cluster.append(reading, base);
  parent.appendChild(cluster);
}

export function appendFuriganaText(parent: HTMLElement, text: string, rawSegments: FuriganaSegment[]): void {
  parent.textContent = "";

  const segments = [...rawSegments]
    .map((segment) => ({
      start: clamp(segment.start, 0, text.length),
      end: clamp(Math.max(segment.end, segment.start + 1), 0, text.length),
      reading: segment.reading,
    }))
    .filter((segment) => segment.reading && segment.start < segment.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let cursor = 0;
  for (const segment of segments) {
    if (segment.start < cursor) continue;
    appendPlainText(parent, text.slice(cursor, segment.start));

    const cluster = document.createElement("span");
    cluster.className = "furigana-cluster";

    const reading = document.createElement("span");
    reading.className = "furigana-reading";
    reading.textContent = segment.reading;

    const base = document.createElement("span");
    base.className = "furigana-base";
    base.textContent = text.slice(segment.start, segment.end);

    cluster.append(reading, base);
    parent.appendChild(cluster);
    cursor = segment.end;
  }

  appendPlainText(parent, text.slice(cursor));
}

export function renderBaseTextWithReadings(
  element: HTMLElement,
  entry: JapaneseReadable,
  options: ReadingRenderOptions
): boolean {
  const text = entry.Text || "";
  const reading = getJapaneseReading(entry);

  if (shouldRenderFurigana(entry, options) && reading) {
    const segments = options.suppressedRubyReadings?.length
      ? reading.furigana.filter((segment) => !options.suppressedRubyReadings!.includes(segment.reading))
      : reading.furigana;
    if (segments.length > 0) {
      element.classList.add("has-furigana");
      appendFuriganaText(element, text, segments);
      return true;
    }
  }

  if (
    options.useRomanized &&
    $japaneseReadingMode.get() !== "romaji" &&
    options.reserveFurigana &&
    isJapaneseEntry(entry, options.isJapaneseLyrics)
  ) {
    element.classList.add("has-furigana");
    appendPlainText(element, text);
    return true;
  }

  if (
    options.useRomanized &&
    $japaneseReadingMode.get() !== "romaji" &&
    options.romanizationPending &&
    isJapaneseEntry(entry, options.isJapaneseLyrics)
  ) {
    element.classList.add("furigana-pending");
  }

  element.textContent = text;
  return false;
}

export function forceStackedLine(lineElem: HTMLElement, oppositeAligned?: boolean): void {
  lineElem.classList.add("HasExtras");
  lineElem.classList.toggle("HasOppositeAlignedExtras", oppositeAligned === true);
}

export function getRomanizedText(entry: JapaneseReadable | undefined): string | undefined {
  if (!entry) return undefined;
  return entry.ReadingRenderPlan?.joinedDisplayText || entry.RomanizedText || entry.TransliteratedText || entry.JapaneseReading?.romaji;
}

export function appendRomanizedBelow(
  lineElem: HTMLElement,
  entry: JapaneseReadable,
  options: ReadingRenderOptions
): boolean {
  if (!shouldRenderRomanization(entry, options)) return false;

  const sourceText = entry.Text || "";
  const romanizedText = getRomanizedText(entry);
  const hasDistinctRomanization = isMeaningfullyDifferent(romanizedText, sourceText);
  if (!hasDistinctRomanization && !options.romanizationPending) return false;

  forceStackedLine(lineElem, options.oppositeAligned);
  const romanizedElem = document.createElement("div");
  romanizedElem.className = `romanized-below${options.romanizationPending && !hasDistinctRomanization ? " romanization-placeholder" : ""}`;
  romanizedElem.textContent = hasDistinctRomanization ? romanizedText! : "";
  lineElem.appendChild(romanizedElem);
  return true;
}

export function appendTranslatedBelow(
  lineElem: HTMLElement,
  sourceText: string,
  translatedText: string | undefined,
  options: ReadingRenderOptions
): boolean {
  const hasDistinctTranslation = isMeaningfullyDifferent(translatedText, sourceText);
  if (!hasDistinctTranslation && !options.translationPending) return false;

  forceStackedLine(lineElem, options.oppositeAligned);
  const translatedElem = document.createElement("div");
  translatedElem.className = `translated-below${options.translationPending && !hasDistinctTranslation ? " translation-placeholder" : ""}`;
  translatedElem.textContent = hasDistinctTranslation ? translatedText! : "";
  if (hasDistinctTranslation && options.translationLanguage) {
    translatedElem.lang = options.translationLanguage;
  }
  lineElem.appendChild(translatedElem);
  return true;
}

export function appendLineExtras(
  lineElem: HTMLElement,
  entry: JapaneseReadable & { TranslatedText?: string },
  options: ReadingRenderOptions
): void {
  appendRomanizedBelow(lineElem, entry, options);
  const translations = resolveTranslationSidecars(entry);
  const providerTranslation = options.showProviderTranslations
    ? translations.provider
    : undefined;
  appendTranslatedBelow(lineElem, entry.Text || "", providerTranslation, {
    ...options,
    translationLanguage: translations.providerLanguage,
    translationPending: false,
  });
  appendTranslatedBelow(lineElem, entry.Text || "", translations.generic, options);
}

export function appendSyllableRomanizedBelow(
  lineElem: HTMLElement,
  syllables: SyllableLike[],
  sourceText: string,
  groupRomanizedText: string | undefined,
  groupProviderTranslatedText: string | undefined,
  groupTranslatedText: string | undefined,
  animatorEntries: Array<{ RomajiElement?: HTMLElement }> | undefined,
  readingPlan: RenderPlan | undefined,
  options: ReadingRenderOptions
): void {
  const groupEntry: JapaneseReadable = {
    Text: sourceText,
    RomanizedText: groupRomanizedText,
    TransliteratedText: groupRomanizedText,
    JapaneseReading: syllables.find((s) => s.JapaneseReading)?.JapaneseReading,
    ReadingPrimaryScript: readingPlan?.primaryScript,
  };

  if (shouldRenderRomanization(groupEntry, options) && readingPlan?.timedReadingUnits.length) {
    forceStackedLine(lineElem, options.oppositeAligned);
    renderExperimentalReadingPlan(lineElem, readingPlan, (spanId, element) => {
      const index = Number(spanId);
      if (Number.isInteger(index) && animatorEntries?.[index]) animatorEntries[index].RomajiElement = element;
    });
  } else if (shouldRenderRomanization(groupEntry, options)) {
    const hasDistinctRomanization = isMeaningfullyDifferent(groupRomanizedText, sourceText);
    if (hasDistinctRomanization || options.romanizationPending) {
      forceStackedLine(lineElem, options.oppositeAligned);
      const romanizedDiv = document.createElement("div");
      romanizedDiv.className = "romanized-below";

      if (options.romanizationPending && !hasDistinctRomanization) {
        romanizedDiv.classList.add("romanization-placeholder");
      } else if (syllables.some((s) => getRomanizedText(s))) {
        syllables.forEach((syl, index) => {
          const romaji = getRomanizedText(syl);
          if (!isMeaningfullyDifferent(romaji, syl.Text)) return;

          const romajiSpan = document.createElement("span");
          romajiSpan.textContent = romaji;
          romajiSpan.className = "romanized-syllable";
          if (syl.RomajiSpaceBefore || (!syl.IsPartOfWord && index > 0)) {
            romajiSpan.style.marginLeft = "0.25em";
          }
          romanizedDiv.appendChild(romajiSpan);
          if (animatorEntries?.[index]) animatorEntries[index].RomajiElement = romajiSpan;
        });
      } else {
        romanizedDiv.textContent = groupRomanizedText || "";
      }

      lineElem.appendChild(romanizedDiv);
    }
  }

  const translations = resolveTranslationSidecars({
    ProviderTranslatedText: groupProviderTranslatedText,
    TranslatedText: groupTranslatedText,
  });
  const providerTranslation = options.showProviderTranslations
    ? translations.provider
    : undefined;
  appendTranslatedBelow(lineElem, sourceText, providerTranslation, {
    ...options,
    translationLanguage: translations.providerLanguage,
    translationPending: false,
  });
  appendTranslatedBelow(lineElem, sourceText, translations.generic, options);
}
