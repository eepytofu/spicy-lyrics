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
import type { RenderPlan, TextRange } from "../Processing/Model.ts";
import { renderReadingPlan } from "./ReadingPlanRenderer.ts";
import { resolveSyllableBoundary } from "../Processing/SyllableBoundaries.ts";
import {
  formatMixedScriptReadingForDisplay,
  needsMixedScriptReadabilityGapBefore,
  projectFuriganaSegmentsForReadability,
  projectMixedScriptReadability,
} from "../Processing/MixedScriptReadability.ts";

export type ReadingRenderOptions = {
  useRomanized: boolean;
  romanizationPending?: boolean;
  translationPending?: boolean;
  translationLanguage?: string;
  showProviderTranslations?: boolean;
  isJapaneseLyrics?: boolean;
  oppositeAligned?: boolean;
  reserveFurigana?: boolean;
  /** Full-line segment identities drawn once by an enclosing timed furigana group. */
  suppressedFuriganaKeys?: readonly string[];
};

type SyllableLike = JapaneseReadable & {
  IsPartOfWord?: boolean;
  RomajiSpaceBefore?: boolean;
};

type RomajiAnimatorEntry = {
  RomajiElement?: HTMLElement;
  RomajiStartTime?: number;
  RomajiEndTime?: number;
  StartTime?: number;
  EndTime?: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const plainTextSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("ja", { granularity: "word" })
  : undefined;
const OpeningPunctuation = /^[([{（［｛「『【〈《〔]+$/u;
const ClosingPunctuation = /^[)\]}）］｝」』】〉》〕、。！？!?…,:;]+$/u;

function plainTextWrapChunks(text: string): string[] {
  const segmented = plainTextSegmenter
    ? Array.from(plainTextSegmenter.segment(text), ({ segment }) => segment)
    : Array.from(text);
  const chunks: string[] = [];
  let opening = "";

  for (const segment of segmented) {
    if (OpeningPunctuation.test(segment)) {
      opening += segment;
      continue;
    }
    if (ClosingPunctuation.test(segment) && chunks.length > 0 && opening === "") {
      chunks[chunks.length - 1] += segment;
      continue;
    }
    chunks.push(`${opening}${segment}`);
    opening = "";
  }

  if (opening) {
    if (chunks.length > 0) chunks[chunks.length - 1] += opening;
    else chunks.push(opening);
  }
  return chunks;
}

export function getJapaneseReading(entry: JapaneseReadable | undefined): JapaneseReading | undefined {
  return entry?.JapaneseReading;
}

export function hasFurigana(entry: JapaneseReadable | undefined): boolean {
  return (getJapaneseReading(entry)?.furigana.length || 0) > 0;
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

  for (const chunk of plainTextWrapChunks(text)) {
    const cluster = document.createElement("span");
    cluster.className = "furigana-cluster furigana-plain-cluster";

    const reading = document.createElement("span");
    reading.className = "furigana-reading furigana-placeholder";
    reading.textContent = "\u00a0";

    const base = document.createElement("span");
    base.className = "furigana-base";
    base.textContent = chunk;

    cluster.append(reading, base);
    parent.appendChild(cluster);
  }
}

export function appendFuriganaText(parent: HTMLElement, text: string, rawSegments: FuriganaSegment[]): void {
  parent.textContent = "";

  const segments = [...rawSegments]
    .map((segment) => ({
      start: clamp(segment.start, 0, text.length),
      end: clamp(Math.max(segment.end, segment.start + 1), 0, text.length),
      reading: segment.reading,
      provenance: segment.provenance,
    }))
    .filter((segment) => segment.reading && segment.start < segment.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let cursor = 0;
  for (const segment of segments) {
    if (segment.start < cursor) continue;
    appendPlainText(parent, text.slice(cursor, segment.start));

    const cluster = document.createElement("span");
    cluster.className = "furigana-cluster";
    if (segment.provenance === "providerExplicit") {
      cluster.classList.add("reading-origin-provider-explicit");
      cluster.dataset.readingOrigin = "provider-explicit";
    }

    const reading = document.createElement("span");
    reading.className = "furigana-reading";
    if (segment.provenance === "providerExplicit") reading.classList.add("reading-origin-provider-explicit");
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

const hasElementClass = (element: Element, className: string): boolean =>
  element.classList.contains(className) || String(element.className).split(/\s+/u).includes(className);

const directClusterChild = (cluster: HTMLElement, className: string): HTMLElement | undefined =>
  Array.from(cluster.children).find((child) => hasElementClass(child, className)) as HTMLElement | undefined;

/**
 * A timed provider can split adjacent kanji into separate DOM words even when
 * each word owns a local ruby. Pack those neighboring ruby clusters exactly
 * like adjacent segments rendered inside one word so their overhangs cannot
 * collide. Authored whitespace remains a source boundary but does not provide
 * enough visual width for long readings, so only visible non-whitespace text
 * resets ruby adjacency.
 */
export function packAdjacentFuriganaClusters(clusters: Iterable<HTMLElement>): void {
  let previousRuby: HTMLElement | null = null;

  for (const cluster of clusters) {
    const base = directClusterChild(cluster, "furigana-base");
    const reading = directClusterChild(cluster, "furigana-reading");
    const hasRuby = !!reading &&
      !hasElementClass(reading, "furigana-placeholder") &&
      !!reading.textContent;

    if (hasRuby) {
      if (previousRuby) {
        previousRuby.classList.add("furigana-cluster-packed");
        cluster.classList.add("furigana-cluster-packed");
      }
      previousRuby = cluster;
    } else if (base?.textContent?.trim()) {
      previousRuby = null;
    }
  }
}

export function renderBaseTextWithReadings(
  element: HTMLElement,
  entry: JapaneseReadable,
  options: ReadingRenderOptions
): boolean {
  const reading = getJapaneseReading(entry);
  const sourceDisplayText = reading?.displayText ?? entry.Text ?? "";
  const readabilityProjection = projectMixedScriptReadability(sourceDisplayText);
  const text = readabilityProjection.text;

  if (shouldRenderFurigana(entry, options) && reading) {
    const sourceSegments = options.suppressedFuriganaKeys?.length
      ? reading.furigana.filter((segment) =>
          segment.lineSegmentKey === undefined
          || !options.suppressedFuriganaKeys!.includes(segment.lineSegmentKey)
        )
      : reading.furigana;
    const segments = projectFuriganaSegmentsForReadability(
      sourceSegments,
      readabilityProjection,
    );
    if (segments.length > 0) {
      element.classList.add("has-furigana");
      appendFuriganaText(element, text, segments);
      packAdjacentFuriganaClusters(
        Array.from(element.children)
          .filter((child) => hasElementClass(child, "furigana-cluster")) as HTMLElement[],
      );
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

function appendRomanizedSegments(element: HTMLElement, reading: JapaneseReading | undefined, fallback: string): void {
  const segments = reading?.romajiSegments;
  const normalizeWhitespace = (value: string): string => value.replace(/\s+/gu, " ").trim();
  if (!segments?.length || normalizeWhitespace(segments.map((segment) => segment.text).join("")) !== normalizeWhitespace(fallback)) {
    element.textContent = fallback;
    return;
  }
  for (const segment of segments) {
    const span = document.createElement("span");
    span.textContent = segment.text;
    if (segment.provenance === "providerExplicit") {
      span.classList.add("reading-origin-provider-explicit");
      span.dataset.readingOrigin = "provider-explicit";
    }
    element.appendChild(span);
  }
}

export function appendRomanizedBelow(
  lineElem: HTMLElement,
  entry: JapaneseReadable,
  options: ReadingRenderOptions
): boolean {
  if (!shouldRenderRomanization(entry, options)) return false;

  const sourceText = entry.JapaneseReading?.displayText ?? entry.Text ?? "";
  const romanizedText = formatMixedScriptReadingForDisplay(
    sourceText,
    getRomanizedText(entry),
  );
  const hasDistinctRomanization = isMeaningfullyDifferent(romanizedText, sourceText);
  if (!hasDistinctRomanization && !options.romanizationPending) return false;

  forceStackedLine(lineElem, options.oppositeAligned);
  const romanizedElem = document.createElement("div");
  romanizedElem.className = `romanized-below${options.romanizationPending && !hasDistinctRomanization ? " romanization-placeholder" : ""}`;
  if (hasDistinctRomanization) appendRomanizedSegments(romanizedElem, getJapaneseReading(entry), romanizedText!);
  else romanizedElem.textContent = "";
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
  animatorEntries: RomajiAnimatorEntry[] | undefined,
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

  const readabilityGapSpanIds = new Set(
    syllables.flatMap((_, index) =>
      needsMixedScriptReadabilityGapBefore(syllables, index)
        ? [String(index)]
        : []
    ),
  );

  if (shouldRenderRomanization(groupEntry, options) && readingPlan?.timedReadingUnits.length) {
    forceStackedLine(lineElem, options.oppositeAligned);
    renderReadingPlan(lineElem, readingPlan, (spanId, element, unit) => {
      const index = Number(spanId);
      const owner = Number.isInteger(index) ? animatorEntries?.[index] : undefined;
      if (!owner) return;
      owner.RomajiElement = element;
      delete owner.RomajiStartTime;
      delete owner.RomajiEndTime;

      const exactWindow = unit.animationRange
        ? projectCanonicalRangeToTiming(
            readingPlan,
            unit.animationRange,
            animatorEntries
          )
        : undefined;
      if (exactWindow) {
        owner.RomajiStartTime = exactWindow.startTime;
        owner.RomajiEndTime = exactWindow.endTime;
        return;
      }

      const animationEntries = (unit.animationTimingRefs || [])
        .map((ref) => animatorEntries?.[Number(ref)])
        .filter((entry) =>
          entry &&
          Number.isFinite(entry.StartTime) &&
          Number.isFinite(entry.EndTime)
        );
      if (animationEntries.length > 1) {
        owner.RomajiStartTime = Math.min(...animationEntries.map((entry) => entry!.StartTime!));
        owner.RomajiEndTime = Math.max(...animationEntries.map((entry) => entry!.EndTime!));
      }
    }, readabilityGapSpanIds);
  } else if (shouldRenderRomanization(groupEntry, options)) {
    const readableGroupRomanizedText = formatMixedScriptReadingForDisplay(
      sourceText,
      groupRomanizedText,
    );
    const hasDistinctRomanization = isMeaningfullyDifferent(readableGroupRomanizedText, sourceText);
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
          if (syl.JapaneseReading?.romajiSegments?.some((segment) => segment.provenance === "providerExplicit")) {
            romajiSpan.classList.add("reading-origin-provider-explicit");
            romajiSpan.dataset.readingOrigin = "provider-explicit";
          }
          if (
            resolveSyllableBoundary(syllables, index).needsReadingSpace
          ) {
            romajiSpan.style.marginLeft = "0.25em";
          }
          romanizedDiv.appendChild(romajiSpan);
          if (animatorEntries?.[index]) animatorEntries[index].RomajiElement = romajiSpan;
        });
      } else {
        romanizedDiv.textContent = readableGroupRomanizedText || "";
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

function projectCanonicalRangeToTiming(
  plan: RenderPlan,
  range: TextRange,
  animatorEntries: RomajiAnimatorEntry[] | undefined
): { startTime: number; endTime: number } | undefined {
  if (!animatorEntries || range.endCp <= range.startCp) return undefined;

  const timeAt = (offsetCp: number, edge: "start" | "end"): number | undefined => {
    const mapping = plan.sourceUnits.find(({ canonicalRange }) =>
      edge === "start"
        ? offsetCp >= canonicalRange.startCp && offsetCp < canonicalRange.endCp
        : offsetCp > canonicalRange.startCp && offsetCp <= canonicalRange.endCp
    );
    if (!mapping) return undefined;

    const entry = animatorEntries[Number(mapping.spanId)];
    if (
      !entry ||
      !Number.isFinite(entry.StartTime) ||
      !Number.isFinite(entry.EndTime)
    ) {
      return undefined;
    }

    const sourceLength =
      mapping.canonicalRange.endCp - mapping.canonicalRange.startCp;
    if (sourceLength <= 0) return undefined;
    const progress = clamp(
      (offsetCp - mapping.canonicalRange.startCp) / sourceLength,
      0,
      1
    );
    return entry.StartTime! + (entry.EndTime! - entry.StartTime!) * progress;
  };

  const startTime = timeAt(range.startCp, "start");
  const endTime = timeAt(range.endCp, "end");
  return (
    startTime !== undefined &&
    endTime !== undefined &&
    endTime > startTime
  )
    ? { startTime, endTime }
    : undefined;
}
