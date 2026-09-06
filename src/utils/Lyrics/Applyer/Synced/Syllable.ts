import {
  $fixHanGlyphVariants,
  $lyricsContainerExists,
  $minimalLyricsMode,
  $simpleLyricsMode,
} from "../../../../utils/stores.ts";
import { IdleEmphasisGroupScale, IdleLyricsScale } from "../../Animator/Shared.ts";
import { ConvertTime } from "../../ConvertTime.ts";
import isRtl from "../../isRtl.ts";
import {
  CurrentLineLyricsObject,
  LyricsObject,
  SetWordArrayInCurentLine,
  getInterludeTimePadding,
  getLyricsBetweenShow,
  type LyricsSyllable,
  type SyllableLead,
  type TimedGroupWindow,
} from "../../lyrics.ts";
import Emphasize, { EmphasizeRenderedUnits } from "../Utils/Emphasize.ts";
import { IsLetterCapable } from "../Utils/IsLetterCapable.ts";
import {
  appendSyllableRomanizedBelow,
  isJapaneseEntry,
  packAdjacentFuriganaClusters,
  populateFuriganaReading,
  renderBaseTextWithReadings,
} from "../ReadingRenderer.ts";
import type { ReadingRenderOptions, ReadingRowPresentation } from "../ReadingRenderer.ts";
import type { TimedSyllableEntry, TimedSyllableGroup } from "../../Reading/JapaneseReading.ts";
import { suppressJapaneseCjkProviderGapAfter } from "../../Processing/TtmlDisplaySemantics.ts";
import { needsMixedScriptReadabilityGapBefore } from "../../Processing/MixedScriptReadability.ts";
import { timedGroupContinuesAt } from "../../Processing/Japanese/TimedGroupIds.ts";
import {
  joinSyllableDisplayText,
  prepareSyllableGroupRenderPlan,
  type SyllableGroupRenderPlan,
  type SyllableWordTiming,
  type TimedRubyGroup,
} from "./SyllableGroupRenderPlan.ts";
import { applyHanLanguageTag, createHanLanguageContext } from "../../HanLanguage.ts";
import { createInterludeLine } from "./Interlude.ts";
import { beginLyricsApply, finishLyricsApply } from "../ApplyLifecycle.ts";
import {
  $hideEmbeddedProviderInfo,
  $showSongSections,
  $showVocalistLabels,
} from "../../../uiState.ts";
import {
  indexedVisibleLyricsEntries,
  shouldSkipGeneratedLyricsProcessing,
} from "../../LyricsSemanticPolicy.ts";
import { isVocalCueEntry } from "../../VocalSemantics.ts";
import { applyVocalPresentation, type VocalPresentationState } from "../VocalPresentation.ts";

// Define the data structure for syllable lyrics
type SyllableData = TimedSyllableEntry;
type LeadData = TimedSyllableGroup;
type BackgroundData = TimedSyllableGroup;

interface LineData {
  Lead: LeadData;
  Background?: BackgroundData[];
  OppositeAligned?: boolean;
  VocalAgentId?: string;
  ProviderLineId?: string;
  SongPart?: string;
  SongPartBlockIndex?: number;
}

interface LyricsData {
  Type: string;
  Content: LineData[];
  StartTime: number;
  SongWriters?: string[];
  source?: string;
  classes?: string;
  styles?: Record<string, string>;
  VocalAgents?: Record<string, { Type?: string; Names: string[] }>;
  ProviderLanguage?: string;
}

const appendInterludeLine = (
  lineElements: HTMLElement[],
  startTime: number,
  endTime: number,
  oppositeAligned: boolean
): void => {
  const interlude = createInterludeLine(
    startTime,
    endTime,
    oppositeAligned,
    getInterludeTimePadding()
  );
  LyricsObject.Types.Syllable.Lines.push(interlude.line);
  SetWordArrayInCurentLine();
  const lead = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead;
  if (lead) lead.push(...interlude.dots);
  else console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
  lineElements.push(interlude.element);
};

const applyWordPositionClasses = (
  element: HTMLElement,
  syllable: SyllableData,
  index: number,
  all: SyllableData[],
  providerLanguage?: string,
  source?: string,
): void => {
  if (index === all.length - 1) {
    element.classList.add("LastWordInLine");
  } else if (syllable.IsPartOfWord) {
    element.classList.add("PartOfWord");
  }
  if (needsMixedScriptReadabilityGapBefore(all, index)) {
    element.classList.add("MixedScriptReadabilityGapBefore");
  }
  if (suppressJapaneseCjkProviderGapAfter(all, index, providerLanguage, source)) {
    element.classList.add("TtmlJapaneseCjkBoundary");
  }
};

const registerSyllableWord = (
  element: HTMLElement,
  timing: SyllableWordTiming,
  isBackground: boolean
): void => {
  const lead = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead;
  if (!lead) {
    console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
    return;
  }

  lead.push({
    HTMLElement: element,
    StartTime: timing.startTime,
    EndTime: timing.endTime,
    TotalTime: timing.totalDuration,
    ...(isBackground ? { BGWord: true } : {}),
  });
};

interface SyllableWordPresentation {
  readingRow: ReadingRowPresentation;
  timing: SyllableWordTiming;
  isBackground?: boolean;
  timedFuriganaBaseSweepRange?: { start: number; end: number };
  providerLanguage?: string;
  source?: string;
}

const renderedEmphasisUnits = (word: HTMLElement) =>
  Array.from(word.querySelectorAll<HTMLElement>(".lyric-base-run"))
    .filter((run) => !run.classList.contains("lyric-base-synthetic-gap"))
    .map((run) => {
      const base = Array.from(run.children).find((child) =>
        child.classList.contains("furigana-base")
      ) as HTMLElement | undefined;
      const length = Array.from(base?.textContent ?? run.textContent ?? "").length;
      return { HTMLElement: run, Length: length };
    })
    .filter((unit) => unit.Length > 0);

const createSyllableWord = (
  syllable: SyllableData,
  index: number,
  all: SyllableData[],
  renderOptions: ReadingRenderOptions,
  presentation: SyllableWordPresentation
): HTMLElement => {
  const isBackground = presentation.isBackground === true;
  let word = document.createElement("span");
  const totalDuration = presentation.timing.totalDuration;
  const letterLength = Array.from(syllable.Text).length;
  const readingRow = presentation.readingRow;
  const reservesReadingRow = readingRow.kind !== "none";
  const rendersEmphasisWithReadings = reservesReadingRow || !!syllable.JapaneseReading;
  const letterCapable =
    !presentation.timedFuriganaBaseSweepRange &&
    IsLetterCapable(letterLength, totalDuration) &&
    !isRtl(syllable.Text);
  const sizeVar = isBackground ? "var(--font-size)" : "var(--DefaultLyricsSize)";

  if (letterCapable) {
    word = document.createElement("div");
    if (rendersEmphasisWithReadings) {
      renderBaseTextWithReadings(
        word,
        syllable,
        {
          ...renderOptions,
          splitBaseRunsForEmphasis: true,
        },
        readingRow
      );
      EmphasizeRenderedUnits(renderedEmphasisUnits(word), word, syllable, isBackground);
    } else {
      Emphasize(syllable.Text.split(""), word, syllable, isBackground);
    }
    applyWordPositionClasses(
      word,
      syllable,
      index,
      all,
      presentation.providerLanguage,
      presentation.source,
    );

    if (!$simpleLyricsMode.get()) {
      word.style.setProperty("--text-shadow-opacity", `0%`);
      word.style.setProperty("--text-shadow-blur-radius", `4px`);
      word.style.scale = IdleEmphasisGroupScale.toString();
      word.style.transform = `translateY(calc(${sizeVar} * 0.02))`;
    }

    return word;
  }

  renderBaseTextWithReadings(word, syllable, renderOptions, readingRow);

  if (presentation.timedFuriganaBaseSweepRange) {
    word.classList.add("timed-furigana-base-sweep-member");
  }

  if (!$simpleLyricsMode.get()) {
    word.style.setProperty("--gradient-position", isBackground ? `0%` : `-20%`);
    word.style.setProperty("--text-shadow-opacity", `0%`);
    word.style.setProperty("--text-shadow-blur-radius", `4px`);
    word.style.scale = IdleLyricsScale.toString();
    word.style.transform = `translateY(calc(${sizeVar} * 0.01))`;
  }

  if (isBackground) word.classList.add("bg-word");
  word.classList.add("word");
  applyWordPositionClasses(
    word,
    syllable,
    index,
    all,
    presentation.providerLanguage,
    presentation.source,
  );
  registerSyllableWord(word, presentation.timing, isBackground);
  return word;
};

/**
 * One visual ruby drawn once above several timed syllables. Every member
 * keeps its exact provider registration. An exact full-owner Furigana group
 * may additionally project the existing group sweep across its base; partial-
 * owner and above-reading groups do not. Provider fragments may carry extra
 * characters around the annotated kanji (e.g. one AMLL span holding
 * エーテル麻), so the ruby is centered over the annotated range itself via
 * the group's code-point midpoint instead of over the whole group.
 */
const createTimedRubyGroup = (
  group: TimedRubyGroup
): { root: HTMLSpanElement; anchor: HTMLSpanElement } => {
  const isAboveReading = "kind" in group;
  const root = document.createElement("span");
  root.classList.add(
    "word-group",
    "semantic-word-group",
    "has-reading-row",
    "reading-row-rendered",
    isAboveReading ? "timed-above-reading-group" : "timed-furigana-group",
    isAboveReading ? "has-above-reading" : "has-furigana"
  );
  if (isAboveReading) root.dataset.timedAboveReadingGroup = group.id;
  else root.dataset.timedFuriganaGroup = group.id;
  // The anchor is appended INSIDE the first member word's ruby cluster, so
  // the shared ruby shares the exact rt grid row of every per-word reading
  // (same bottom edge, no line-height drift) and rides that word's per-frame
  // scale, translateY, and glow like the per-word furigana clusters do.
  const anchor = document.createElement("span");
  anchor.classList.add("timed-furigana-ruby-anchor");
  anchor.style.setProperty("--tfg-center-ch", String(group.rubyCenterCh));
  const reading = document.createElement("span");
  reading.classList.add("furigana-reading", "timed-furigana-reading");
  if (isAboveReading) {
    reading.classList.add("above-reading-text", `above-reading-${group.kind}`);
    reading.lang = group.kind === "mandarinPinyin" ? "zh-Latn" : "ja-Latn";
  }
  if (group.provenance === "providerExplicit") {
    reading.classList.add("reading-origin-provider-explicit");
    reading.dataset.readingOrigin = "provider-explicit";
  }
  populateFuriganaReading(reading, group.reading);
  anchor.appendChild(reading);
  return { root, anchor };
};

/** Latest animator entry registered for the current line (just-created word). */
const lastRegisteredWordEntry = (): SyllableLead | undefined => {
  const lead = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead;
  return lead?.[lead.length - 1];
};

type TimedRubyRenderState = {
  root: HTMLSpanElement | null;
  groupId: string | undefined;
  times: TimedGroupWindow | null;
};

const createTimedRubyRenderState = (): TimedRubyRenderState => ({
  root: null,
  groupId: undefined,
  times: null,
});

const resetTimedRubyRenderState = (state: TimedRubyRenderState): void => {
  state.root = null;
  state.groupId = undefined;
  state.times = null;
};

const appendTimedRubyMember = (
  lineElement: HTMLElement,
  word: HTMLElement,
  syllable: SyllableData,
  spanId: string,
  group: TimedRubyGroup,
  state: TimedRubyRenderState
): void => {
  const timedFuriganaBaseSweepRange =
    "kind" in group ? undefined : group.baseSweepRanges.get(spanId);
  const entry = lastRegisteredWordEntry();
  if (!state.root || group.id !== state.groupId) {
    const timedGroup = createTimedRubyGroup(group);
    lineElement.appendChild(timedGroup.root);
    const anchorOwner =
      "kind" in group
        ? word.querySelector(".above-reading-plain-cluster")
        : word.querySelector(".furigana-cluster");
    (anchorOwner ?? word).appendChild(timedGroup.anchor);
    state.root = timedGroup.root;
    state.groupId = group.id;

    if (entry) {
      entry.TimedRubyAnchorElement = timedGroup.anchor;
      entry.TimedRubyAnchorOffsetEm =
        group.rubyCenterCh - Array.from(syllable.Text || "").length / 2;
      state.times = {
        start: entry.StartTime,
        firstEnd: entry.EndTime,
        lastStart: entry.StartTime,
        end: entry.EndTime,
      };
      entry.TimedGroupTimes = state.times;
    }
  } else {
    if (entry && state.times) {
      entry.TimedGroupTimes = state.times;
      state.times.lastStart = ConvertTime(syllable.StartTime);
      state.times.end = ConvertTime(syllable.EndTime);
    }
  }

  if (entry && timedFuriganaBaseSweepRange) {
    entry.TimedFuriganaBaseSweepRange = timedFuriganaBaseSweepRange;
  }

  state.root.appendChild(word);
};

const appendGroupedWord = (
  lineElement: HTMLElement,
  word: HTMLElement,
  syllable: SyllableData,
  previous: SyllableData | undefined,
  currentGroup: HTMLSpanElement | null
): HTMLSpanElement | null => {
  if (syllable.IsPartOfWord || (previous?.IsPartOfWord && currentGroup)) {
    const group = currentGroup ?? document.createElement("span");
    if (!currentGroup) {
      group.classList.add("word-group");
      lineElement.appendChild(group);
    }

    group.appendChild(word);
    return !syllable.IsPartOfWord && previous?.IsPartOfWord ? null : group;
  }

  lineElement.appendChild(word);
  return null;
};

type SyllableGroupKind = "lead" | "background";

const assembleSyllableGroup = (
  kind: SyllableGroupKind,
  lineElement: HTMLElement,
  group: TimedSyllableGroup,
  plan: SyllableGroupRenderPlan,
  renderOptions: ReadingRenderOptions,
  providerLanguage?: string,
  source?: string
): boolean => {
  const isBackground = kind === "background";
  if (plan.hasRtl) lineElement.classList.add("rtl");

  let currentWordGroup: HTMLSpanElement | null = null;
  let currentSemanticGroupId: string | undefined;
  const timedRubyState = createTimedRubyRenderState();

  for (const wordPlan of plan.words) {
    const { syllable, index } = wordPlan;
    const word = createSyllableWord(
      syllable,
      index,
      group.Syllables,
      wordPlan.renderOptions,
      {
        readingRow: wordPlan.readingRow,
        timing: wordPlan.timing,
        isBackground,
        providerLanguage,
        source,
        timedFuriganaBaseSweepRange: wordPlan.timedFuriganaBaseSweepRange,
      }
    );

    // Ruby crossing timed syllables is drawn once above a display group.
    // Exact full-owner Furigana compounds project the existing group sweep
    // across their base; source timing and partial-owner geometry stay
    // unchanged. The line is never collapsed.
    if (wordPlan.timedRubyGroup) {
      appendTimedRubyMember(
        lineElement,
        word,
        syllable,
        String(index),
        wordPlan.timedRubyGroup,
        timedRubyState
      );
      currentWordGroup = null;
      currentSemanticGroupId = undefined;
      continue;
    }

    // Authored whitespace spans between members stay inside the open group
    // so the ruby is not split into duplicates.
    if (
      timedRubyState.root &&
      !(syllable.Text || "").trim() &&
      timedGroupContinuesAt(
        plan.texts,
        plan.timedRubyLookup,
        index + 1,
        timedRubyState.groupId
      )
    ) {
      timedRubyState.root.appendChild(word);
      currentWordGroup = null;
      currentSemanticGroupId = undefined;
      continue;
    }
    resetTimedRubyRenderState(timedRubyState);

    const semanticGroupId = wordPlan.semanticGroupId;
    if (plan.usesSemanticGroups && semanticGroupId) {
      if (!currentWordGroup || semanticGroupId !== currentSemanticGroupId) {
        currentWordGroup = document.createElement("span");
        currentWordGroup.classList.add("word-group", "semantic-word-group");
        lineElement.appendChild(currentWordGroup);
        currentSemanticGroupId = semanticGroupId;
      }
      currentWordGroup.appendChild(word);
    } else {
      currentWordGroup = appendGroupedWord(
        lineElement,
        word,
        syllable,
        group.Syllables[index - 1],
        currentWordGroup
      );
    }
  }

  packAdjacentFuriganaClusters(lineElement.querySelectorAll<HTMLElement>(".lyric-base-run"));

  const registeredEntries =
    LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead || [];
  const sidecarEntries = isBackground
    ? registeredEntries.filter((entry) => entry.BGWord)
    : registeredEntries;
  return appendSyllableRomanizedBelow(
    lineElement,
    group.Syllables,
    plan.sourceText,
    plan.romanizedText,
    group.ProviderTranslatedText,
    group.TranslatedText,
    sidecarEntries,
    group.ReadingRenderPlan,
    {
      ...renderOptions,
      translationLanguage: group.TranslatedTextLanguage,
      providerTranslationLanguage: group.ProviderTranslationLanguage,
    }
  );
};

export function ApplySyllableLyrics(
  data: LyricsData,
  UseRomanized: boolean = false,
  ShowProviderTranslations: boolean = false
): void {
  if (!$lyricsContainerExists.get()) return;

  const showVocalistLabels = $showVocalistLabels.get();
  const showSongSections = $showSongSections.get();
  const visibleLines = indexedVisibleLyricsEntries(
    data.Content,
    (line) => line.Lead,
    {
      hideProviderInfo: $hideEmbeddedProviderInfo.get(),
      showVocalistLabels,
    },
  );
  const hasOppositeAligned = visibleLines.some(({ entry }) => entry.OppositeAligned === true);
  const hasRtlLines = visibleLines.some(
    ({ entry }) =>
      entry.Lead.Syllables.some((syllable) => isRtl(syllable.Text)) ||
      entry.Background?.some((bg) => bg.Syllables.some((syllable) => isRtl(syllable.Text))) === true
  );
  const applyContext = beginLyricsApply("Syllable", hasOppositeAligned, hasRtlLines);
  if (!applyContext) return;
  const { lineElements } = applyContext;

  const firstVisibleLine = visibleLines[0]?.entry;
  if (firstVisibleLine && firstVisibleLine.Lead.StartTime >= getLyricsBetweenShow()) {
    appendInterludeLine(
      lineElements,
      0,
      firstVisibleLine.Lead.StartTime,
      firstVisibleLine.OppositeAligned === true,
    );
  }
  const translationPending = (data as any).TranslationPending === true;
  const romanizationPending = (data as any).RomanizationPending === true;
  const fixHanGlyphVariants = $fixHanGlyphVariants.get();
  const isJapaneseLyrics =
    (data as any).Language === "jpn" ||
    visibleLines.some(
      ({ entry }) =>
        entry.Lead.Syllables.some((s) => isJapaneseEntry(s)) ||
        entry.Background?.some((bg) => bg.Syllables.some((s) => isJapaneseEntry(s))) === true
    );
  const vocalPresentationState: VocalPresentationState = {};
  visibleLines.forEach(({ entry: line, sourceIndex }, index, arr) => {
    const skipGeneratedProcessing = shouldSkipGeneratedLyricsProcessing(line.Lead);
    const lineElem = document.createElement("div");
    lineElem.classList.add("line");
    const lineWindow = {
      startTime: line.Lead.StartTime,
      endTime: line.Lead.EndTime,
    };
    const leadDisplayText = joinSyllableDisplayText(line.Lead.Syllables);
    const leadSourceText = line.Lead.JapaneseReading?.sourceText || leadDisplayText;
    lineElem.dataset.spicyLyricsLineId = `lead:${sourceIndex}`;
    lineElem.dataset.spicyLyricsOriginalText = leadSourceText;
    const hanLanguageContext = createHanLanguageContext(
      data,
      leadDisplayText,
      fixHanGlyphVariants
    );
    applyHanLanguageTag(lineElem, hanLanguageContext);
    applyVocalPresentation(
      lineElem,
      data,
      isVocalCueEntry(line.Lead) ? line.Lead : line,
      vocalPresentationState,
      { showSongSections, showVocalistLabels },
    );
    const lineRenderOptions = {
      useRomanized: skipGeneratedProcessing ? false : UseRomanized,
      romanizationPending: skipGeneratedProcessing ? false : romanizationPending,
      chineseDocument: (data as any).DetectedChinese === true,
      translationPending: skipGeneratedProcessing ? false : translationPending,
      showProviderTranslations: skipGeneratedProcessing ? false : ShowProviderTranslations,
      isJapaneseLyrics,
      oppositeAligned: line.OppositeAligned,
      hanLanguageContext,
    };

    const nextLineStartTime = arr[index + 1]?.entry.Lead.StartTime ?? 0;

    const lineEndTimeAndNextLineStartTimeDistance =
      nextLineStartTime !== 0 ? nextLineStartTime - lineWindow.endTime : 0;

    const lineEndTime = $minimalLyricsMode.get()
      ? nextLineStartTime === 0
        ? lineWindow.endTime
        : lineEndTimeAndNextLineStartTimeDistance < getLyricsBetweenShow() &&
            nextLineStartTime > lineWindow.endTime
          ? nextLineStartTime
          : lineWindow.endTime
      : lineWindow.endTime;

    const leadLyricsLine = {
      HTMLElement: lineElem,
      StartTime: ConvertTime(lineWindow.startTime),
      EndTime: ConvertTime(lineEndTime),
      TotalTime: ConvertTime(lineEndTime) - ConvertTime(lineWindow.startTime),
    } satisfies LyricsSyllable;
    LyricsObject.Types.Syllable.Lines.push(leadLyricsLine);

    SetWordArrayInCurentLine();

    if (line.OppositeAligned) {
      lineElem.classList.add("OppositeAligned");
    }

    const leadPlan = prepareSyllableGroupRenderPlan(
      line.Lead,
      lineRenderOptions,
      leadSourceText
    );
    leadLyricsLine.HasExtraSidecars = assembleSyllableGroup(
      "lead",
      lineElem,
      line.Lead,
      leadPlan,
      lineRenderOptions,
      data.ProviderLanguage,
      data.source
    );
    lineElements.push(lineElem);

    if (line.Background) {
      line.Background.forEach((bg) => {
        const lineE = document.createElement("div");
        lineE.classList.add("line", "bg-line");
        const bgRenderOptions = {
          ...lineRenderOptions,
          oppositeAligned: line.OppositeAligned,
        };
        const bgPlan = prepareSyllableGroupRenderPlan(bg, bgRenderOptions);

        const backgroundLyricsLine = {
          HTMLElement: lineE,
          StartTime: ConvertTime(bg.StartTime),
          EndTime: ConvertTime(bg.EndTime),
          TotalTime: ConvertTime(bg.EndTime) - ConvertTime(bg.StartTime),
          BGLine: true,
        } satisfies LyricsSyllable;
        LyricsObject.Types.Syllable.Lines.push(backgroundLyricsLine);
        SetWordArrayInCurentLine();

        if (line.OppositeAligned) {
          lineE.classList.add("OppositeAligned");
        }
        backgroundLyricsLine.HasExtraSidecars = assembleSyllableGroup(
          "background",
          lineE,
          bg,
          bgPlan,
          bgRenderOptions,
          data.ProviderLanguage,
          data.source
        );
        lineElements.push(lineE);
      });
    }
    const interludeStartTime = lineWindow.endTime;
    if (arr[index + 1] && nextLineStartTime - interludeStartTime >= getLyricsBetweenShow()) {
      appendInterludeLine(
        lineElements,
        interludeStartTime,
        nextLineStartTime,
        arr[index + 1].entry.OppositeAligned === true
      );
    }
  });

  finishLyricsApply(
    applyContext,
    data,
    visibleLines.map(({ entry }) => entry),
    UseRomanized,
    true,
  );
}
