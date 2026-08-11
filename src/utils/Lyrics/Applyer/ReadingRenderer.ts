/**
 * DOM renderer for lyric sidecar text: Japanese furigana, romaji, translation.
 *
 * Applyers own timing/animation registration. This module owns only display
 * decisions and stable markup so furigana does not leak into every renderer.
 */

import { $chineseTranslitMode, $japaneseReadingMode, $pinyinPlacement } from "../../uiState.ts";
import { isMeaningfullyDifferent } from "../TextCompare.ts";
import { resolveTranslationSidecars } from "../TranslationSidecar.ts";
import {
  JapaneseKanaTextTest,
  type FuriganaSegment,
  type JapaneseReadable,
  type JapaneseReading,
} from "../Reading/JapaneseReading.ts";
import type { AboveReadingSegment, RenderPlan, TextRange } from "../Processing/Model.ts";
import { renderReadingPlan } from "./ReadingPlanRenderer.ts";
import { resolveSyllableBoundary } from "../Processing/SyllableBoundaries.ts";
import {
  formatMixedScriptReadingForDisplay,
  needsMixedScriptReadabilityGapBefore,
  projectFuriganaSegmentsForReadability,
  projectMixedScriptReadability,
  type MixedScriptReadabilityProjection,
} from "../Processing/MixedScriptReadability.ts";
import {
  resolveHanLanguageTagForContext,
  splitHanLanguageRuns,
  type HanLanguageContext,
} from "../HanLanguage.ts";

export type ReadingRenderOptions = {
  useRomanized: boolean;
  romanizationPending?: boolean;
  translationPending?: boolean;
  translationLanguage?: string;
  showProviderTranslations?: boolean;
  isJapaneseLyrics?: boolean;
  oppositeAligned?: boolean;
  reservedReadingRow?: Exclude<ReadingRowPresentation["kind"], "none">;
  aboveReadingSegments?: readonly AboveReadingSegment[];
  primaryScript?: "Japanese" | "Chinese";
  chineseDocument?: boolean;
  hanLanguageContext?: HanLanguageContext;
  /** Split unannotated Above-row text into animator-sized glyph runs. */
  splitBaseRunsForEmphasis?: boolean;
  /** Full-line segment identities drawn once by an enclosing timed furigana group. */
  suppressedFuriganaKeys?: readonly string[];
};

export type ReadingRowPresentation =
  | { readonly kind: "none" }
  | {
      readonly kind: "furigana" | "pinyinAbove";
      readonly state: "rendered" | "reserved" | "pending";
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

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const plainTextSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("ja", { granularity: "word" })
    : undefined;
const OpeningPunctuation = /^[([{（［｛「『【〈《〔]+$/u;
const ClosingPunctuation = /^[)\]}）］｝」』】〉》〕、。！？!?…,:;，．：；]+$/u;
const WrapPunctuation =
  /([([{（［｛「『【〈《〔]+|[)\]}）］｝」』】〉》〕、。！？!?…,:;，．：；]+)/gu;
const WhitespaceOnlyText = /^\s+$/u;

function plainTextWrapChunks(text: string): string[] {
  const segmented = plainTextSegmenter
    ? Array.from(plainTextSegmenter.segment(text), ({ segment }) => segment)
    : Array.from(text);
  const punctuationAwareSegments = segmented.flatMap((segment) =>
    segment.split(WrapPunctuation).filter(Boolean)
  );
  const chunks: string[] = [];
  let opening = "";

  for (const segment of punctuationAwareSegments) {
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
    chunks.push(opening);
  }
  return chunks;
}

export function getJapaneseReading(
  entry: JapaneseReadable | undefined
): JapaneseReading | undefined {
  return entry?.JapaneseReading;
}

export function hasFurigana(entry: JapaneseReadable | undefined): boolean {
  return (getJapaneseReading(entry)?.furigana.length || 0) > 0;
}

export function isJapaneseEntry(
  entry: JapaneseReadable | undefined,
  isJapaneseLyrics?: boolean
): boolean {
  if (!entry) return !!isJapaneseLyrics;
  if (entry.ReadingPrimaryScript === "Chinese") return false;
  if (entry.ReadingPrimaryScript === "Japanese") return true;
  return (
    !!isJapaneseLyrics || !!entry.JapaneseReading || JapaneseKanaTextTest.test(entry.Text || "")
  );
}

export function shouldRenderFurigana(
  entry: JapaneseReadable | undefined,
  options: ReadingRenderOptions
): boolean {
  return options.useRomanized && $japaneseReadingMode.get() !== "romaji" && hasFurigana(entry);
}

export function shouldRenderRomanization(
  entry: JapaneseReadable | undefined,
  options: ReadingRenderOptions
): boolean {
  if (!options.useRomanized) return false;
  if (shouldRenderAboveReadings(entry, options)) return false;
  if (shouldReservePendingAboveReading(options)) return false;
  const isJapanese = isJapaneseEntry(entry, options.isJapaneseLyrics);
  return !isJapanese || $japaneseReadingMode.get() !== "furigana";
}

export function shouldReservePendingAboveReading(options: ReadingRenderOptions): boolean {
  return (
    options.useRomanized &&
    options.romanizationPending === true &&
    options.chineseDocument === true &&
    $chineseTranslitMode.get() === "pinyin" &&
    $pinyinPlacement.get() === "above"
  );
}

export function shouldRenderAboveReadings(
  entry: JapaneseReadable | undefined,
  options: ReadingRenderOptions
): boolean {
  if (!options.useRomanized || $chineseTranslitMode.get() !== "pinyin") return false;
  if ($pinyinPlacement.get() !== "above") return false;
  const primaryScript =
    entry?.ReadingPrimaryScript ?? entry?.ReadingRenderPlan?.primaryScript ?? options.primaryScript;
  if (primaryScript !== "Chinese") return false;
  return (
    (options.aboveReadingSegments?.length ||
      entry?.ReadingRenderPlan?.aboveReadingSegments?.length ||
      0) > 0
  );
}

export function resolveReadingRowPresentation(
  entry: JapaneseReadable | undefined,
  options: ReadingRenderOptions
): ReadingRowPresentation {
  if (shouldRenderAboveReadings(entry, options)) {
    return { kind: "pinyinAbove", state: "rendered" };
  }
  if (shouldRenderFurigana(entry, options)) {
    return { kind: "furigana", state: "rendered" };
  }
  if (
    options.useRomanized &&
    options.reservedReadingRow === "pinyinAbove" &&
    entry?.ReadingPrimaryScript === "Chinese"
  ) {
    return { kind: "pinyinAbove", state: "reserved" };
  }
  if (shouldReservePendingAboveReading(options)) {
    return { kind: "pinyinAbove", state: "pending" };
  }
  if (
    options.useRomanized &&
    $japaneseReadingMode.get() !== "romaji" &&
    options.reservedReadingRow === "furigana" &&
    isJapaneseEntry(entry, options.isJapaneseLyrics)
  ) {
    return { kind: "furigana", state: "reserved" };
  }
  if (
    options.useRomanized &&
    $japaneseReadingMode.get() !== "romaji" &&
    options.romanizationPending &&
    isJapaneseEntry(entry, options.isJapaneseLyrics)
  ) {
    return { kind: "furigana", state: "pending" };
  }
  return { kind: "none" };
}

function markReadingRowHost(
  element: HTMLElement,
  presentation: Exclude<ReadingRowPresentation, { kind: "none" }>
): void {
  element.classList.add("has-reading-row", `reading-row-${presentation.state}`);
  if (presentation.kind === "pinyinAbove") {
    element.classList.add("has-above-reading");
    if (presentation.state === "pending") element.classList.add("above-reading-pending");
    return;
  }
  if (presentation.state === "rendered" || presentation.state === "reserved") {
    element.classList.add("has-furigana");
  }
  if (presentation.state === "reserved") element.classList.add("furigana-row-reserved");
  if (presentation.state === "pending") element.classList.add("furigana-pending");
}

export function aboveReadingSegmentsForSpan(
  plan: RenderPlan | undefined,
  spanId: string
): AboveReadingSegment[] {
  const mapping = plan?.sourceUnits.find((unit) => unit.spanId === spanId);
  if (!mapping || !plan?.aboveReadingSegments?.length) return [];
  return plan.aboveReadingSegments
    .filter(
      (segment) =>
        segment.canonicalRange.startCp >= mapping.canonicalRange.startCp &&
        segment.canonicalRange.endCp <= mapping.canonicalRange.endCp
    )
    .map((segment) => ({
      ...segment,
      canonicalRange: {
        startCp: segment.canonicalRange.startCp - mapping.canonicalRange.startCp,
        endCp: segment.canonicalRange.endCp - mapping.canonicalRange.startCp,
      },
    }));
}

function appendPlainText(
  parent: HTMLElement,
  text: string,
  sourceStart = 0,
  hanLanguageContext?: HanLanguageContext,
  layout: "inline" | "furiganaRow" | "aboveReadingRow" = "inline",
  splitBaseRunsForEmphasis = false,
  syntheticGapCodePointOffsets?: ReadonlySet<number>
): void {
  if (!text) return;

  let cursor = sourceStart;
  for (const chunk of plainTextWrapChunks(text)) {
    for (const languageRun of splitHanLanguageRuns(chunk, hanLanguageContext)) {
      const displayRuns = splitBaseRunsForEmphasis
        ? Array.from(languageRun.text)
        : [languageRun.text];
      for (const displayText of displayRuns) {
        const run = document.createElement("span");
        const usesFuriganaRow = layout === "furiganaRow" && !WhitespaceOnlyText.test(displayText);
        const usesAboveReadingRow =
          layout === "aboveReadingRow" && !WhitespaceOnlyText.test(displayText);
        run.className = usesFuriganaRow
          ? "lyric-base-run furigana-plain-cluster"
          : usesAboveReadingRow
            ? "lyric-base-run furigana-plain-cluster above-reading-plain-cluster has-above-reading"
            : layout === "furiganaRow"
              ? "lyric-base-run lyric-base-plain lyric-base-whitespace"
              : layout === "aboveReadingRow"
                ? "lyric-base-run lyric-base-plain lyric-base-whitespace"
                : "lyric-base-run lyric-base-plain";
        run.dataset.sourceStart = String(cursor);
        if (
          layout === "aboveReadingRow" &&
          WhitespaceOnlyText.test(displayText) &&
          syntheticGapCodePointOffsets?.has(cursor)
        ) {
          run.classList.add("lyric-base-synthetic-gap");
        }
        cursor +=
          layout === "aboveReadingRow" ? Array.from(displayText).length : displayText.length;
        run.dataset.sourceEnd = String(cursor);
        if (languageRun.language) run.lang = languageRun.language;

        if (usesFuriganaRow || usesAboveReadingRow) {
          const base = document.createElement("span");
          base.className = usesAboveReadingRow
            ? "furigana-base above-reading-base"
            : "furigana-base";
          base.textContent = displayText;
          run.appendChild(base);
        } else {
          run.textContent = displayText;
        }
        parent.appendChild(run);
      }
    }
  }
}

const baseRunText = (run: HTMLElement): string =>
  directClusterChild(run, "furigana-base")?.textContent ?? run.textContent ?? "";

function groupWrapPunctuationRuns(parent: HTMLElement): void {
  const runs = Array.from(parent.children) as HTMLElement[];
  const grouped: HTMLElement[] = [];

  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    const text = baseRunText(run);

    if (OpeningPunctuation.test(text) && runs[index + 1]) {
      const group = document.createElement("span");
      group.className = "lyric-wrap-group";
      group.append(run, runs[index + 1]);
      grouped.push(group);
      index += 1;
      continue;
    }

    if (ClosingPunctuation.test(text) && grouped.length > 0) {
      const group = document.createElement("span");
      group.className = "lyric-wrap-group";
      group.append(grouped.pop()!, run);
      grouped.push(group);
      continue;
    }

    grouped.push(run);
  }

  parent.textContent = "";
  parent.append(...grouped);
}

/**
 * Keep the real reading as an in-flow grid child and let CSS draw only the
 * bright karaoke layer through generated content. This avoids putting a
 * background on ruby nested inside a background-clip:text lyric word, which
 * Chromium can suppress together with the annotated base text.
 */
export function populateFuriganaReading(
  element: HTMLElement,
  reading: string,
  sourceStart = 0,
  sourceEnd = 1,
  sourceLength = 1
): void {
  const safeLength = Math.max(sourceLength, 1);
  const safeStart = clamp(sourceStart, 0, safeLength);
  const safeEnd = clamp(Math.max(sourceEnd, safeStart + 1), safeStart, safeLength);
  const sourceSpan = Math.max(safeEnd - safeStart, 1);

  element.textContent = "";
  element.dataset.furigana = reading;
  element.style.setProperty("--furigana-source-start", `${(safeStart / safeLength) * 100}%`);
  element.style.setProperty("--furigana-source-scale", String(safeLength / sourceSpan));

  const textLayer = document.createElement("span");
  textLayer.className = "furigana-reading-text";
  textLayer.textContent = reading;
  element.appendChild(textLayer);
}

export function appendFuriganaText(
  parent: HTMLElement,
  text: string,
  rawSegments: FuriganaSegment[],
  hanLanguageContext?: HanLanguageContext
): void {
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
    appendPlainText(
      parent,
      text.slice(cursor, segment.start),
      cursor,
      hanLanguageContext,
      "furiganaRow"
    );

    const cluster = document.createElement("span");
    cluster.className = "lyric-base-run furigana-cluster";
    cluster.dataset.sourceStart = String(segment.start);
    cluster.dataset.sourceEnd = String(segment.end);
    const clusterLanguage = resolveHanLanguageTagForContext(
      text.slice(segment.start, segment.end),
      hanLanguageContext
    );
    if (clusterLanguage) cluster.lang = clusterLanguage;
    if (segment.provenance === "providerExplicit") {
      cluster.classList.add("reading-origin-provider-explicit");
      cluster.dataset.readingOrigin = "provider-explicit";
    }

    const reading = document.createElement("span");
    reading.className = "furigana-reading";
    if (segment.provenance === "providerExplicit")
      reading.classList.add("reading-origin-provider-explicit");
    populateFuriganaReading(reading, segment.reading, segment.start, segment.end, text.length);

    const base = document.createElement("span");
    base.className = "furigana-base";
    base.textContent = text.slice(segment.start, segment.end);

    cluster.append(reading, base);
    parent.appendChild(cluster);
    cursor = segment.end;
  }

  appendPlainText(parent, text.slice(cursor), cursor, hanLanguageContext, "furiganaRow");
  groupWrapPunctuationRuns(parent);
}

function projectAboveSegmentsForReadability(
  segments: readonly AboveReadingSegment[],
  projection: MixedScriptReadabilityProjection
): AboveReadingSegment[] {
  const beforeOrAt = (offset: number): number =>
    projection.insertedBeforeCodePoint.filter((position) => position <= offset).length;
  const strictlyBefore = (offset: number): number =>
    projection.insertedBeforeCodePoint.filter((position) => position < offset).length;
  return segments.map((segment) => ({
    ...segment,
    canonicalRange: {
      startCp: segment.canonicalRange.startCp + beforeOrAt(segment.canonicalRange.startCp),
      endCp: segment.canonicalRange.endCp + strictlyBefore(segment.canonicalRange.endCp),
    },
  }));
}

export function appendAboveReadingText(
  parent: HTMLElement,
  text: string,
  rawSegments: readonly AboveReadingSegment[],
  hanLanguageContext?: HanLanguageContext,
  splitBaseRunsForEmphasis = false,
  syntheticGapCodePointOffsets?: ReadonlySet<number>
): void {
  parent.textContent = "";
  const characters = Array.from(text);
  const segments = [...rawSegments]
    .filter(
      ({ canonicalRange, reading }) =>
        !!reading &&
        canonicalRange.startCp >= 0 &&
        canonicalRange.endCp > canonicalRange.startCp &&
        canonicalRange.endCp <= characters.length
    )
    .sort((a, b) => a.canonicalRange.startCp - b.canonicalRange.startCp);
  let cursorCp = 0;

  for (const segment of segments) {
    const { startCp, endCp } = segment.canonicalRange;
    if (startCp < cursorCp) continue;
    appendPlainText(
      parent,
      characters.slice(cursorCp, startCp).join(""),
      cursorCp,
      hanLanguageContext,
      "aboveReadingRow",
      splitBaseRunsForEmphasis,
      syntheticGapCodePointOffsets
    );

    const ruby = document.createElement("ruby");
    ruby.className = "lyric-base-run furigana-cluster above-reading-cluster has-above-reading";
    ruby.dataset.sourceStart = String(startCp);
    ruby.dataset.sourceEnd = String(endCp);
    ruby.dataset.aboveReadingKind = segment.kind;
    const baseText = characters.slice(startCp, endCp).join("");
    const language = resolveHanLanguageTagForContext(baseText, hanLanguageContext);
    if (language) ruby.lang = language;

    const base = document.createElement("span");
    base.className = "furigana-base above-reading-base";
    base.textContent = baseText;
    const annotation = document.createElement("rt");
    annotation.className = `furigana-reading above-reading-text above-reading-${segment.kind}`;
    annotation.lang = segment.kind === "mandarinPinyin" ? "zh-Latn" : "ja-Latn";
    populateFuriganaReading(annotation, segment.reading, startCp, endCp, characters.length);
    ruby.append(base, annotation);
    parent.appendChild(ruby);
    cursorCp = endCp;
  }

  appendPlainText(
    parent,
    characters.slice(cursorCp).join(""),
    cursorCp,
    hanLanguageContext,
    "aboveReadingRow",
    splitBaseRunsForEmphasis,
    syntheticGapCodePointOffsets
  );
  groupWrapPunctuationRuns(parent);
  packAdjacentFuriganaClusters(
    Array.from(parent.children).flatMap((child) =>
      child.classList.contains("lyric-wrap-group") ? Array.from(child.children) : [child]
    ) as HTMLElement[]
  );
}

const hasElementClass = (element: Element, className: string): boolean =>
  element.classList.contains(className) ||
  String(element.className).split(/\s+/u).includes(className);

const directClusterChild = (cluster: HTMLElement, className: string): HTMLElement | undefined =>
  Array.from(cluster.children).find((child) => hasElementClass(child, className)) as
    | HTMLElement
    | undefined;

/**
 * A timed provider can split adjacent kanji into separate DOM words even when
 * each word owns a local ruby. Walk every base run, not only ruby clusters, so
 * visible intervening text resets adjacency while authored whitespace can stay
 * inside a packed lexical group.
 */
export function packAdjacentFuriganaClusters(runs: Iterable<HTMLElement>): void {
  let previousRuby: HTMLElement | null = null;

  for (const run of runs) {
    const base = directClusterChild(run, "furigana-base");
    const reading = directClusterChild(run, "furigana-reading");
    const hasRuby = hasElementClass(run, "furigana-cluster") && !!reading?.textContent;

    if (hasRuby) {
      if (previousRuby) {
        previousRuby.classList.add("furigana-cluster-packed");
        run.classList.add("furigana-cluster-packed");
      }
      previousRuby = run;
    } else if ((base?.textContent ?? run.textContent)?.trim()) {
      previousRuby = null;
    }
  }
}

export function renderBaseTextWithReadings(
  element: HTMLElement,
  entry: JapaneseReadable,
  options: ReadingRenderOptions,
  resolvedPresentation?: ReadingRowPresentation
): boolean {
  const reading = getJapaneseReading(entry);
  const sourceDisplayText = reading?.displayText ?? entry.Text ?? "";
  const readabilityProjection = projectMixedScriptReadability(sourceDisplayText);
  const text = readabilityProjection.text;
  const syntheticGapCodePointOffsets = options.splitBaseRunsForEmphasis
    ? new Set(readabilityProjection.insertedBeforeCodePoint.map((offset, index) => offset + index))
    : undefined;
  const hanLanguageContext = options.hanLanguageContext
    ? {
        ...options.hanLanguageContext,
        primaryScript: entry.ReadingPrimaryScript ?? options.hanLanguageContext.primaryScript,
      }
    : undefined;

  const aboveReadingSegments =
    options.aboveReadingSegments ?? entry.ReadingRenderPlan?.aboveReadingSegments;
  const presentation =
    resolvedPresentation ??
    resolveReadingRowPresentation(entry, { ...options, aboveReadingSegments });
  if (
    presentation.kind === "pinyinAbove" &&
    presentation.state === "rendered" &&
    aboveReadingSegments
  ) {
    const segments = projectAboveSegmentsForReadability(
      aboveReadingSegments,
      readabilityProjection
    );
    markReadingRowHost(element, presentation);
    appendAboveReadingText(
      element,
      text,
      segments,
      hanLanguageContext,
      options.splitBaseRunsForEmphasis === true,
      syntheticGapCodePointOffsets
    );
    return true;
  }

  if (presentation.kind === "furigana" && presentation.state === "rendered" && reading) {
    const sourceSegments = options.suppressedFuriganaKeys?.length
      ? reading.furigana.filter(
          (segment) =>
            segment.lineSegmentKey === undefined ||
            !options.suppressedFuriganaKeys!.includes(segment.lineSegmentKey)
        )
      : reading.furigana;
    const segments = projectFuriganaSegmentsForReadability(sourceSegments, readabilityProjection);
    if (segments.length > 0) {
      markReadingRowHost(element, presentation);
      appendFuriganaText(element, text, segments, hanLanguageContext);
      packAdjacentFuriganaClusters(
        Array.from(element.children).filter((child) =>
          hasElementClass(child, "lyric-base-run")
        ) as HTMLElement[]
      );
      return true;
    }
    if (options.reservedReadingRow === "furigana") {
      markReadingRowHost(element, { kind: "furigana", state: "reserved" });
      appendPlainText(element, text, 0, hanLanguageContext, "furiganaRow");
      return true;
    }
  }

  if (presentation.kind === "pinyinAbove" && presentation.state === "reserved") {
    markReadingRowHost(element, presentation);
    appendPlainText(
      element,
      text,
      0,
      hanLanguageContext,
      "aboveReadingRow",
      options.splitBaseRunsForEmphasis === true,
      syntheticGapCodePointOffsets
    );
    return true;
  }

  if (presentation.kind === "pinyinAbove" && presentation.state === "pending") {
    markReadingRowHost(element, presentation);
    appendPlainText(
      element,
      text,
      0,
      hanLanguageContext,
      "aboveReadingRow",
      options.splitBaseRunsForEmphasis === true,
      syntheticGapCodePointOffsets
    );
    return true;
  }

  if (presentation.kind === "furigana" && presentation.state === "reserved") {
    markReadingRowHost(element, presentation);
    appendPlainText(element, text, 0, hanLanguageContext, "furiganaRow");
    return true;
  }

  if (presentation.kind === "furigana" && presentation.state === "pending") {
    markReadingRowHost(element, presentation);
  }

  element.textContent = "";
  appendPlainText(element, text, 0, hanLanguageContext);
  return false;
}

/**
 * Static and line-synced lyrics do not have per-word timing owners. Keep all
 * base runs inside one flex item so the line's shared flex layout cannot turn
 * tokenizer/readability chunks into independent layout items. Syllable lyrics
 * deliberately keep rendering inside their existing word owners instead.
 */
export function renderFullLineBaseTextWithReadings(
  lineElem: HTMLElement,
  entry: JapaneseReadable,
  options: ReadingRenderOptions
): boolean {
  const baseFlow = document.createElement("span");
  baseFlow.className = "lyric-base-flow";
  lineElem.appendChild(baseFlow);

  const renderedFurigana = renderBaseTextWithReadings(baseFlow, entry, options);
  if (baseFlow.classList.contains("furigana-pending")) {
    lineElem.classList.add("furigana-pending");
  }
  return renderedFurigana;
}

export function forceStackedLine(lineElem: HTMLElement, oppositeAligned?: boolean): void {
  lineElem.classList.add("HasExtras");
  lineElem.classList.toggle("HasOppositeAlignedExtras", oppositeAligned === true);
}

export function getRomanizedText(entry: JapaneseReadable | undefined): string | undefined {
  if (!entry) return undefined;
  return (
    entry.ReadingRenderPlan?.joinedDisplayText ||
    entry.RomanizedText ||
    entry.TransliteratedText ||
    entry.JapaneseReading?.romaji
  );
}

function appendRomanizedSegments(
  element: HTMLElement,
  reading: JapaneseReading | undefined,
  fallback: string
): void {
  const segments = reading?.romajiSegments;
  const normalizeWhitespace = (value: string): string => value.replace(/\s+/gu, " ").trim();
  if (
    !segments?.length ||
    normalizeWhitespace(segments.map((segment) => segment.text).join("")) !==
      normalizeWhitespace(fallback)
  ) {
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
  const romanizedText = formatMixedScriptReadingForDisplay(sourceText, getRomanizedText(entry));
  const hasDistinctRomanization = isMeaningfullyDifferent(romanizedText, sourceText);
  if (!hasDistinctRomanization && !options.romanizationPending) return false;

  forceStackedLine(lineElem, options.oppositeAligned);
  const romanizedElem = document.createElement("div");
  romanizedElem.className = `romanized-below${options.romanizationPending && !hasDistinctRomanization ? " romanization-placeholder" : ""}`;
  if (hasDistinctRomanization)
    appendRomanizedSegments(romanizedElem, getJapaneseReading(entry), romanizedText!);
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
): boolean {
  let appended = appendRomanizedBelow(lineElem, entry, options);
  const translations = resolveTranslationSidecars(entry);
  const providerTranslation = options.showProviderTranslations ? translations.provider : undefined;
  const appendedProviderTranslation = appendTranslatedBelow(
    lineElem,
    entry.Text || "",
    providerTranslation,
    {
      ...options,
      translationLanguage: translations.providerLanguage,
      translationPending: false,
    }
  );
  const appendedGenericTranslation = appendTranslatedBelow(
    lineElem,
    entry.Text || "",
    translations.generic,
    options
  );
  appended ||= appendedProviderTranslation || appendedGenericTranslation;
  return appended;
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
): boolean {
  let appended = false;
  const groupEntry: JapaneseReadable = {
    Text: sourceText,
    RomanizedText: groupRomanizedText,
    TransliteratedText: groupRomanizedText,
    JapaneseReading: syllables.find((s) => s.JapaneseReading)?.JapaneseReading,
    ReadingPrimaryScript: readingPlan?.primaryScript,
    ReadingRenderPlan: readingPlan,
  };

  const readabilityGapSpanIds = new Set(
    syllables.flatMap((_, index) =>
      needsMixedScriptReadabilityGapBefore(syllables, index) ? [String(index)] : []
    )
  );

  if (shouldRenderRomanization(groupEntry, options) && readingPlan?.timedReadingUnits.length) {
    forceStackedLine(lineElem, options.oppositeAligned);
    appended = true;
    renderReadingPlan(
      lineElem,
      readingPlan,
      (spanId, element, unit) => {
        const index = Number(spanId);
        const owner = Number.isInteger(index) ? animatorEntries?.[index] : undefined;
        if (!owner) return;
        owner.RomajiElement = element;
        delete owner.RomajiStartTime;
        delete owner.RomajiEndTime;

        const exactWindow = unit.animationRange
          ? projectCanonicalRangeToTiming(readingPlan, unit.animationRange, animatorEntries)
          : undefined;
        if (exactWindow) {
          owner.RomajiStartTime = exactWindow.startTime;
          owner.RomajiEndTime = exactWindow.endTime;
          return;
        }

        const animationEntries = (unit.animationTimingRefs || [])
          .map((ref) => animatorEntries?.[Number(ref)])
          .filter(
            (entry) => entry && Number.isFinite(entry.StartTime) && Number.isFinite(entry.EndTime)
          );
        if (animationEntries.length > 1) {
          owner.RomajiStartTime = Math.min(...animationEntries.map((entry) => entry!.StartTime!));
          owner.RomajiEndTime = Math.max(...animationEntries.map((entry) => entry!.EndTime!));
        }
      },
      readabilityGapSpanIds
    );
  } else if (shouldRenderRomanization(groupEntry, options)) {
    const readableGroupRomanizedText = formatMixedScriptReadingForDisplay(
      sourceText,
      groupRomanizedText
    );
    const hasDistinctRomanization = isMeaningfullyDifferent(readableGroupRomanizedText, sourceText);
    if (hasDistinctRomanization || options.romanizationPending) {
      forceStackedLine(lineElem, options.oppositeAligned);
      appended = true;
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
          if (
            syl.JapaneseReading?.romajiSegments?.some(
              (segment) => segment.provenance === "providerExplicit"
            )
          ) {
            romajiSpan.classList.add("reading-origin-provider-explicit");
            romajiSpan.dataset.readingOrigin = "provider-explicit";
          }
          if (resolveSyllableBoundary(syllables, index).needsReadingSpace) {
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
  const providerTranslation = options.showProviderTranslations ? translations.provider : undefined;
  const appendedProviderTranslation = appendTranslatedBelow(
    lineElem,
    sourceText,
    providerTranslation,
    {
      ...options,
      translationLanguage: translations.providerLanguage,
      translationPending: false,
    }
  );
  const appendedGenericTranslation = appendTranslatedBelow(
    lineElem,
    sourceText,
    translations.generic,
    options
  );
  appended ||= appendedProviderTranslation || appendedGenericTranslation;
  return appended;
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
    if (!entry || !Number.isFinite(entry.StartTime) || !Number.isFinite(entry.EndTime)) {
      return undefined;
    }

    const sourceLength = mapping.canonicalRange.endCp - mapping.canonicalRange.startCp;
    if (sourceLength <= 0) return undefined;
    const progress = clamp((offsetCp - mapping.canonicalRange.startCp) / sourceLength, 0, 1);
    return entry.StartTime! + (entry.EndTime! - entry.StartTime!) * progress;
  };

  const startTime = timeAt(range.startCp, "start");
  const endTime = timeAt(range.endCp, "end");
  return startTime !== undefined && endTime !== undefined && endTime > startTime
    ? { startTime, endTime }
    : undefined;
}
