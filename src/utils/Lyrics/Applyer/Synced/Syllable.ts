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
import Emphasize from "../Utils/Emphasize.ts";
import { IsLetterCapable } from "../Utils/IsLetterCapable.ts";
import {
  appendSyllableRomanizedBelow,
  aboveReadingSegmentsForSpan,
  isJapaneseEntry,
  packAdjacentFuriganaClusters,
  populateFuriganaReading,
  renderBaseTextWithReadings,
  shouldRenderFurigana,
  shouldRenderAboveReadings,
} from "../ReadingRenderer.ts";
import type { ReadingRenderOptions } from "../ReadingRenderer.ts";
import type { TimedSyllableEntry, TimedSyllableGroup } from "../../Reading/JapaneseReading.ts";
import { needsSyllableSpaceBefore } from "../../Processing/SyllableBoundaries.ts";
import { needsMixedScriptReadabilityGapBefore } from "../../Processing/MixedScriptReadability.ts";
import {
  timedAboveReadingGroups,
  timedFuriganaGroups,
  timedGroupContinuesAt,
  timedLogicalGroupIds,
  type TimedAboveReadingGroup,
  type TimedAboveReadingGroups,
  type TimedFuriganaGroup,
  type TimedFuriganaGroups,
} from "../../Processing/Japanese/TimedGroupIds.ts";
import { applyHanLanguageTag, createHanLanguageContext } from "../../HanLanguage.ts";
import { createInterludeLine } from "./Interlude.ts";
import { beginLyricsApply, finishLyricsApply } from "../ApplyLifecycle.ts";

// Define the data structure for syllable lyrics
type SyllableData = TimedSyllableEntry;
type LeadData = TimedSyllableGroup;
type BackgroundData = TimedSyllableGroup;

interface LineData {
  Lead: LeadData;
  Background?: BackgroundData[];
  OppositeAligned?: boolean;
}

interface LyricsData {
  Type: string;
  Content: LineData[];
  StartTime: number;
  SongWriters?: string[];
  source?: "spt" | "spl" | "aml";
  classes?: string;
  styles?: Record<string, string>;
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

const joinSyllableDisplayText = (syllables: SyllableData[]): string => {
  return syllables
    .reduce((acc, syl, index) => {
      const text = syl.Text || "";
      if (index === 0) return text;
      return `${acc}${needsSyllableSpaceBefore(syllables, index) ? " " : ""}${text}`;
    }, "")
    .trim();
};

const applyWordPositionClasses = (
  element: HTMLElement,
  syllable: SyllableData,
  index: number,
  all: SyllableData[]
): void => {
  if (index === all.length - 1) {
    element.classList.add("LastWordInLine");
  } else if (syllable.IsPartOfWord) {
    element.classList.add("PartOfWord");
  }
  if (needsMixedScriptReadabilityGapBefore(all, index)) {
    element.classList.add("MixedScriptReadabilityGapBefore");
  }
};

const registerSyllableWord = (
  element: HTMLElement,
  syllable: SyllableData,
  totalDuration: number,
  isBackground: boolean
): void => {
  const lead = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead;
  if (!lead) {
    console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
    return;
  }

  lead.push({
    HTMLElement: element,
    StartTime: ConvertTime(syllable.StartTime),
    EndTime: ConvertTime(syllable.EndTime),
    TotalTime: totalDuration,
    ...(isBackground ? { BGWord: true } : {}),
  });
};

interface SyllableWordPresentation {
  isBackground?: boolean;
}

const createSyllableWord = (
  syllable: SyllableData,
  index: number,
  all: SyllableData[],
  renderOptions: ReadingRenderOptions,
  useRomanized: boolean,
  presentation: SyllableWordPresentation = {}
): HTMLElement => {
  const isBackground = presentation.isBackground === true;
  let word = document.createElement("span");
  const totalDuration = ConvertTime(syllable.EndTime) - ConvertTime(syllable.StartTime);
  const letterLength = syllable.Text.split("").length;
  const hasFurigana = shouldRenderFurigana(syllable, renderOptions);
  const hasAboveReading = shouldRenderAboveReadings(syllable, renderOptions);
  const reservesFuriganaRow =
    hasFurigana ||
    hasAboveReading ||
    ((renderOptions.reserveFurigana === true || renderOptions.reserveAboveReading === true) && useRomanized);
  // Package-backed Japanese words need a registered word element in every
  // display mode. Letter emphasis returns before timing registration.
  const letterCapable =
    IsLetterCapable(letterLength, totalDuration) &&
    !isRtl(syllable.Text) &&
    !reservesFuriganaRow &&
    !syllable.JapaneseReading;
  const sizeVar = isBackground ? "var(--font-size)" : "var(--DefaultLyricsSize)";

  if (letterCapable) {
    word = document.createElement("div");
    Emphasize(syllable.Text.split(""), word, syllable, isBackground);
    applyWordPositionClasses(word, syllable, index, all);

    if (!$simpleLyricsMode.get()) {
      word.style.setProperty("--text-shadow-opacity", `0%`);
      word.style.setProperty("--text-shadow-blur-radius", `4px`);
      word.style.scale = IdleEmphasisGroupScale.toString();
      word.style.transform = `translateY(calc(${sizeVar} * 0.02))`;
    }

    return word;
  }

  renderBaseTextWithReadings(word, syllable, renderOptions);

  if (!$simpleLyricsMode.get()) {
    word.style.setProperty("--gradient-position", isBackground ? `0%` : `-20%`);
    word.style.setProperty("--text-shadow-opacity", `0%`);
    word.style.setProperty("--text-shadow-blur-radius", `4px`);
    word.style.scale = IdleLyricsScale.toString();
    word.style.transform = `translateY(calc(${sizeVar} * 0.01))`;
  }

  if (isBackground) word.classList.add("bg-word");
  word.classList.add("word");
  applyWordPositionClasses(word, syllable, index, all);
  registerSyllableWord(word, syllable, totalDuration, isBackground);
  return word;
};

const EMPTY_TIMED_FURIGANA: TimedFuriganaGroups = { groups: [], bySpanId: new Map() };
const EMPTY_TIMED_ABOVE_READING: TimedAboveReadingGroups = { groups: [], bySpanId: new Map() };
type TimedRubyGroup = TimedFuriganaGroup | TimedAboveReadingGroup;

/**
 * One visual ruby drawn once above several timed syllables. The group is
 * display-only: every member word keeps its own animator registration, so
 * karaoke timing ownership never changes. Provider fragments may carry
 * extra characters around the annotated kanji (e.g. one AMLL span holding
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
    isAboveReading ? "timed-above-reading-group" : "timed-furigana-group",
    isAboveReading ? "has-above-reading" : "has-furigana",
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
  group: TimedRubyGroup,
  state: TimedRubyRenderState
): void => {
  if (!state.root || group.id !== state.groupId) {
    const timedGroup = createTimedRubyGroup(group);
    lineElement.appendChild(timedGroup.root);
    const anchorOwner = "kind" in group
      ? word.querySelector(".above-reading-plain-cluster")
      : word.querySelector(".furigana-cluster");
    (anchorOwner ?? word).appendChild(timedGroup.anchor);
    state.root = timedGroup.root;
    state.groupId = group.id;

    const entry = lastRegisteredWordEntry();
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
    const entry = lastRegisteredWordEntry();
    if (entry && state.times) {
      entry.TimedGroupTimes = state.times;
      state.times.lastStart = ConvertTime(syllable.StartTime);
      state.times.end = ConvertTime(syllable.EndTime);
    }
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

export function ApplySyllableLyrics(
  data: LyricsData,
  UseRomanized: boolean = false,
  ShowProviderTranslations: boolean = false
): void {
  if (!$lyricsContainerExists.get()) return;

  const hasOppositeAligned = data.Content.some((item) => item.OppositeAligned === true);
  const hasRtlLines = data.Content.some(
    (line) =>
      line.Lead.Syllables.some((syllable) => isRtl(syllable.Text)) ||
      line.Background?.some((bg) => bg.Syllables.some((syllable) => isRtl(syllable.Text))) === true
  );
  const applyContext = beginLyricsApply("Syllable", hasOppositeAligned, hasRtlLines);
  if (!applyContext) return;
  const { lineElements } = applyContext;

  if (data.StartTime >= getLyricsBetweenShow()) {
    appendInterludeLine(lineElements, 0, data.StartTime, data.Content[0].OppositeAligned === true);
  }
  const translationPending = (data as any).TranslationPending === true;
  const romanizationPending = (data as any).RomanizationPending === true;
  const fixHanGlyphVariants = $fixHanGlyphVariants.get();
  const isJapaneseLyrics =
    (data as any).Language === "jpn" ||
    data.Content.some(
      (line) =>
        line.Lead.Syllables.some((s) => isJapaneseEntry(s)) ||
        line.Background?.some((bg) => bg.Syllables.some((s) => isJapaneseEntry(s))) === true
    );
  data.Content.forEach((line, index, arr) => {
    const lineElem = document.createElement("div");
    lineElem.classList.add("line");
    const lineWindow = {
      startTime: line.Lead.StartTime,
      endTime: line.Lead.EndTime,
    };
    const leadSourceText =
      line.Lead.JapaneseReading?.sourceText || joinSyllableDisplayText(line.Lead.Syllables);
    lineElem.dataset.spicyLyricsLineId = `lead:${index}`;
    lineElem.dataset.spicyLyricsOriginalText = leadSourceText;
    const hanLanguageContext = createHanLanguageContext(
      data,
      joinSyllableDisplayText(line.Lead.Syllables),
      fixHanGlyphVariants,
    );
    applyHanLanguageTag(lineElem, hanLanguageContext);
    const lineRenderOptions = {
      useRomanized: UseRomanized,
      romanizationPending,
      translationPending,
      showProviderTranslations: ShowProviderTranslations,
      isJapaneseLyrics,
      oppositeAligned: line.OppositeAligned,
      hanLanguageContext,
    };

    const nextLineStartTime = arr[index + 1]
      ? arr[index + 1].Lead.StartTime
      : 0;

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

    lineElements.push(lineElem);

    let currentWordGroup: HTMLSpanElement | null = null;
    let currentSemanticGroupId: string | undefined;
    const leadHasFurigana =
      shouldRenderFurigana(line.Lead, lineRenderOptions) ||
      line.Lead.Syllables.some((s) => shouldRenderFurigana(s, lineRenderOptions));
    const leadHasAboveReading = shouldRenderAboveReadings(line.Lead, lineRenderOptions);
    const leadUsesSemanticGroups =
      line.Lead.Syllables.some((s) => !!s.JapaneseReading) && !!line.Lead.ReadingRenderPlan;
    const leadRenderOptions = {
      ...lineRenderOptions,
      reserveFurigana: leadHasFurigana,
      reserveAboveReading: leadHasAboveReading,
      primaryScript: line.Lead.ReadingRenderPlan?.primaryScript,
    };
    const leadLogicalGroupIds = timedLogicalGroupIds(line.Lead.ReadingRenderPlan);
    const leadTimedFurigana = leadHasFurigana
      ? timedFuriganaGroups(line.Lead.ReadingRenderPlan)
      : EMPTY_TIMED_FURIGANA;
    const leadTimedAboveReading = leadHasAboveReading
      ? timedAboveReadingGroups(line.Lead.ReadingRenderPlan)
      : EMPTY_TIMED_ABOVE_READING;
    const leadTimedRubyLookup = {
      bySpanId: new Map<string, TimedRubyGroup>([
        ...leadTimedFurigana.bySpanId,
        ...leadTimedAboveReading.bySpanId,
      ]),
    };
    const leadTexts = line.Lead.Syllables.map((s) => s.Text || "");
    const leadTimedRubyState = createTimedRubyRenderState();

    line.Lead.Syllables.forEach((lead, iL, aL) => {
        if (isRtl(lead.Text) && !lineElem.classList.contains("rtl")) {
          lineElem.classList.add("rtl");
        }

        // Ruby crossing timed syllables is drawn once above a display-only
        // group; member words suppress only their copy of that reading but
        // keep their timing registration. The line is never collapsed.
        const timedFuriganaGroup = leadTimedFurigana.bySpanId.get(String(iL));
        const timedAboveReadingGroup = leadTimedAboveReading.bySpanId.get(String(iL));
        const timedRubyGroup = timedFuriganaGroup ?? timedAboveReadingGroup;
        const wordRenderOptions = {
          ...leadRenderOptions,
          aboveReadingSegments: aboveReadingSegmentsForSpan(
            line.Lead.ReadingRenderPlan,
            String(iL),
          ),
        };
        const word = createSyllableWord(
          lead,
          iL,
          aL,
          timedFuriganaGroup
            ? { ...wordRenderOptions, suppressedFuriganaKeys: [timedFuriganaGroup.segmentKey] }
            : wordRenderOptions,
          UseRomanized
        );
        if (timedRubyGroup) {
          appendTimedRubyMember(
            lineElem,
            word,
            lead,
            timedRubyGroup,
            leadTimedRubyState
          );
          currentWordGroup = null;
          currentSemanticGroupId = undefined;
          return;
        }
        // Authored whitespace spans between members stay inside the open group
        // so the ruby is not split into duplicates.
        if (
          leadTimedRubyState.root &&
          !(lead.Text || "").trim() &&
          timedGroupContinuesAt(
            leadTexts,
            leadTimedRubyLookup,
            iL + 1,
            leadTimedRubyState.groupId
          )
        ) {
          leadTimedRubyState.root.appendChild(word);
          currentWordGroup = null;
          currentSemanticGroupId = undefined;
          return;
        }
        resetTimedRubyRenderState(leadTimedRubyState);

        const semanticGroupId = leadLogicalGroupIds.get(String(iL));
        if (leadUsesSemanticGroups && semanticGroupId) {
          if (!currentWordGroup || semanticGroupId !== currentSemanticGroupId) {
            currentWordGroup = document.createElement("span");
            currentWordGroup.classList.add("word-group", "semantic-word-group");
            lineElem.appendChild(currentWordGroup);
            currentSemanticGroupId = semanticGroupId;
          }
          currentWordGroup.appendChild(word);
        } else {
          currentWordGroup = appendGroupedWord(lineElem, word, lead, aL[iL - 1], currentWordGroup);
        }
    });
    packAdjacentFuriganaClusters(lineElem.querySelectorAll<HTMLElement>(".lyric-base-run"));

    const leadRomanizedText = line.Lead.RomanizedText || line.Lead.TransliteratedText;
    const leadEntries = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead;
    leadLyricsLine.HasExtraSidecars = appendSyllableRomanizedBelow(
      lineElem,
      line.Lead.Syllables,
      leadSourceText,
      leadRomanizedText,
      line.Lead.ProviderTranslatedText,
      line.Lead.TranslatedText,
      leadEntries,
      line.Lead.ReadingRenderPlan,
      lineRenderOptions
    );

    if (line.Background) {
      line.Background.forEach((bg) => {
        const lineE = document.createElement("div");
        lineE.classList.add("line", "bg-line");
        const bgRenderOptions = {
          ...lineRenderOptions,
          oppositeAligned: line.OppositeAligned,
        };

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
        lineElements.push(lineE);

        let currentBGWordGroup: HTMLSpanElement | null = null;
        let currentBGSemanticGroupId: string | undefined;
        const bgHasFurigana =
          shouldRenderFurigana(bg, bgRenderOptions) ||
          bg.Syllables.some((s) => shouldRenderFurigana(s, bgRenderOptions));
        const bgHasAboveReading = shouldRenderAboveReadings(bg, bgRenderOptions);
        const bgUsesSemanticGroups =
          bg.Syllables.some((s) => !!s.JapaneseReading) && !!bg.ReadingRenderPlan;
        const bgWordRenderOptions = {
          ...bgRenderOptions,
          reserveFurigana: bgHasFurigana,
          reserveAboveReading: bgHasAboveReading,
          primaryScript: bg.ReadingRenderPlan?.primaryScript,
        };
        const bgSourceText =
          bg.JapaneseReading?.sourceText || joinSyllableDisplayText(bg.Syllables);
        const bgLogicalGroupIds = timedLogicalGroupIds(bg.ReadingRenderPlan);
        const bgTimedFurigana = bgHasFurigana
          ? timedFuriganaGroups(bg.ReadingRenderPlan)
          : EMPTY_TIMED_FURIGANA;
        const bgTimedAboveReading = bgHasAboveReading
          ? timedAboveReadingGroups(bg.ReadingRenderPlan)
          : EMPTY_TIMED_ABOVE_READING;
        const bgTimedRubyLookup = {
          bySpanId: new Map<string, TimedRubyGroup>([
            ...bgTimedFurigana.bySpanId,
            ...bgTimedAboveReading.bySpanId,
          ]),
        };
        const bgTexts = bg.Syllables.map((s) => s.Text || "");
        const bgTimedRubyState = createTimedRubyRenderState();

        bg.Syllables.forEach((bw, bI, bA) => {
          if (isRtl(bw.Text) && !lineE.classList.contains("rtl")) {
            lineE.classList.add("rtl");
          }

          const timedFuriganaGroup = bgTimedFurigana.bySpanId.get(String(bI));
          const timedAboveReadingGroup = bgTimedAboveReading.bySpanId.get(String(bI));
          const timedRubyGroup = timedFuriganaGroup ?? timedAboveReadingGroup;
          const wordRenderOptions = {
            ...bgWordRenderOptions,
            aboveReadingSegments: aboveReadingSegmentsForSpan(bg.ReadingRenderPlan, String(bI)),
          };
          const word = createSyllableWord(
            bw,
            bI,
            bA,
            timedFuriganaGroup
              ? { ...wordRenderOptions, suppressedFuriganaKeys: [timedFuriganaGroup.segmentKey] }
              : wordRenderOptions,
            UseRomanized,
            { isBackground: true }
          );
          if (timedRubyGroup) {
            appendTimedRubyMember(lineE, word, bw, timedRubyGroup, bgTimedRubyState);
            currentBGWordGroup = null;
            currentBGSemanticGroupId = undefined;
            return;
          }
          if (
            bgTimedRubyState.root &&
            !(bw.Text || "").trim() &&
            timedGroupContinuesAt(bgTexts, bgTimedRubyLookup, bI + 1, bgTimedRubyState.groupId)
          ) {
            bgTimedRubyState.root.appendChild(word);
            currentBGWordGroup = null;
            currentBGSemanticGroupId = undefined;
            return;
          }
          resetTimedRubyRenderState(bgTimedRubyState);

          const semanticGroupId = bgLogicalGroupIds.get(String(bI));
          if (bgUsesSemanticGroups && semanticGroupId) {
            if (!currentBGWordGroup || semanticGroupId !== currentBGSemanticGroupId) {
              currentBGWordGroup = document.createElement("span");
              currentBGWordGroup.classList.add("word-group", "semantic-word-group");
              lineE.appendChild(currentBGWordGroup);
              currentBGSemanticGroupId = semanticGroupId;
            }
            currentBGWordGroup.appendChild(word);
          } else {
            currentBGWordGroup = appendGroupedWord(lineE, word, bw, bA[bI - 1], currentBGWordGroup);
          }
        });
        packAdjacentFuriganaClusters(lineE.querySelectorAll<HTMLElement>(".lyric-base-run"));

        const bgRomanizedText = bg.RomanizedText || bg.TransliteratedText;
        const allEntries =
          LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead || [];
        const bgEntries = allEntries.filter((entry: any) => entry.BGWord);
        backgroundLyricsLine.HasExtraSidecars = appendSyllableRomanizedBelow(
          lineE,
          bg.Syllables,
          bgSourceText,
          bgRomanizedText,
          bg.ProviderTranslatedText,
          bg.TranslatedText,
          bgEntries,
          bg.ReadingRenderPlan,
          bgRenderOptions
        );
      });
    }
    const interludeStartTime = lineWindow.endTime;
    if (arr[index + 1] && nextLineStartTime - interludeStartTime >= getLyricsBetweenShow()) {
      appendInterludeLine(
        lineElements,
        interludeStartTime,
        nextLineStartTime,
        arr[index + 1].OppositeAligned === true
      );
    }
  });

  finishLyricsApply(applyContext, data, data.Content, UseRomanized, true);
}
