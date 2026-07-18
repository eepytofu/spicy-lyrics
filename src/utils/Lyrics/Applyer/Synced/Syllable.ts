import { $fixHanGlyphVariants, $lyricsContainerExists, $minimalLyricsMode, $simpleLyricsMode } from "../../../../utils/stores.ts";
import { PageContainer } from "../../../../components/Pages/PageView.ts";
import { isSpicySidebarMode } from "../../../../components/Utils/SidebarLyrics.ts";
import { applyStyles, removeAllStyles } from "../../../CSS/Styles.ts";
import {
  ClearScrollSimplebar,
  MountScrollSimplebar,
  RecalculateScrollSimplebar,
  ScrollSimplebar,
} from "../../../Scrolling/Simplebar/ScrollSimplebar.ts";
import { IdleEmphasisLyricsScale, IdleLyricsScale } from "../../Animator/Shared.ts";
import { ConvertTime } from "../../ConvertTime.ts";
import { ClearLyricsPageContainer } from "../../fetchLyrics.ts";
import isRtl from "../../isRtl.ts";
import {
  ClearLyricsContentArrays,
  CurrentLineLyricsObject,
  LyricsObject,
  SetWordArrayInCurentLine,
  getInterludeTimePadding,
  getLyricsBetweenShow,
  setRomanizedStatus,
  type SyllableLead,
  type TimedGroupWindow,
} from "../../lyrics.ts";
import { CreateLyricsContainer, DestroyAllLyricsContainers } from "../CreateLyricsContainer.ts";
import { initLyricsVirtualizer } from "../../LyricsVirtualizer.ts";
import { ApplyIsByCommunity } from "../Credits/ApplyIsByCommunity.tsx";
import { ApplyLyricsCredits } from "../Credits/ApplyLyricsCredits.ts";
import { EmitApply, EmitNotApplyed } from "../OnApply.ts";
import Emphasize from "../Utils/Emphasize.ts";
import { IsLetterCapable } from "../Utils/IsLetterCapable.ts";
import { ApplyLyricsProvider } from "../Credits/ApplyProvider.ts";
import { ApplyProviderCredits } from "../Credits/ApplyProviderCredits.ts";
import {
  appendSyllableRomanizedBelow,
  isJapaneseEntry,
  renderBaseTextWithReadings,
  shouldRenderFurigana,
} from "../ReadingRenderer.ts";
import type { ReadingRenderOptions } from "../ReadingRenderer.ts";
import type { TimedSyllableEntry, TimedSyllableGroup } from "../../Reading/JapaneseReading.ts";
import {
  timedFuriganaGroups,
  timedGroupContinuesAt,
  timedLogicalGroupIds,
  type TimedFuriganaGroup,
  type TimedFuriganaGroups,
} from "../../Processing/Japanese/TimedGroupIds.ts";
import { applyHanLanguageTag } from "../../HanLanguage.ts";

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

const joinSyllableDisplayText = (syllables: SyllableData[]): string => {
  return syllables.reduce((acc, syl, index) => {
    const text = syl.Text || "";
    if (index === 0) return text;
    return `${acc}${syl.IsPartOfWord ? "" : " "}${text}`;
  }, "").trim();
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

const createSyllableWord = (
  syllable: SyllableData,
  index: number,
  all: SyllableData[],
  renderOptions: ReadingRenderOptions,
  useRomanized: boolean,
  isBackground: boolean = false
): HTMLElement => {
  let word = document.createElement("span");
  const totalDuration = ConvertTime(syllable.EndTime) - ConvertTime(syllable.StartTime);
  const letterLength = syllable.Text.split("").length;
  const hasFurigana = shouldRenderFurigana(syllable, renderOptions);
  const reservesFuriganaRow = hasFurigana || (renderOptions.reserveFurigana === true && useRomanized);
  // Package-backed Japanese words need a registered word element in every
  // display mode. Letter emphasis returns before timing registration.
  const letterCapable = IsLetterCapable(letterLength, totalDuration) && !isRtl(syllable.Text) && !reservesFuriganaRow && !syllable.JapaneseReading;
  const sizeVar = isBackground ? "var(--font-size)" : "var(--DefaultLyricsSize)";

  if (letterCapable) {
    word = document.createElement("div");
    Emphasize(syllable.Text.split(""), word, syllable, isBackground);
    applyWordPositionClasses(word, syllable, index, all);

    if (!$simpleLyricsMode.get()) {
      word.style.setProperty("--text-shadow-opacity", `0%`);
      word.style.setProperty("--text-shadow-blur-radius", `4px`);
      word.style.scale = IdleEmphasisLyricsScale.toString();
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

/**
 * One visual ruby drawn once above several timed syllables. The group is
 * display-only: every member word keeps its own animator registration, so
 * karaoke timing ownership never changes. Provider fragments may carry
 * extra characters around the annotated kanji (e.g. one AMLL span holding
 * エーテル麻), so the ruby is centered over the annotated range itself via
 * the group's code-point midpoint instead of over the whole group.
 */
const createTimedFuriganaGroup = (
  group: TimedFuriganaGroup
): { root: HTMLSpanElement; anchor: HTMLSpanElement } => {
  const root = document.createElement("span");
  root.classList.add("word-group", "semantic-word-group", "timed-furigana-group", "has-furigana");
  root.dataset.timedFuriganaGroup = group.id;
  // The anchor is appended INSIDE the first member word's ruby cluster, so
  // the shared ruby shares the exact rt grid row of every per-word reading
  // (same bottom edge, no line-height drift) and rides that word's per-frame
  // scale, translateY, and glow like the per-word furigana clusters do.
  const anchor = document.createElement("span");
  anchor.classList.add("timed-furigana-ruby-anchor");
  anchor.style.setProperty("--tfg-center-ch", String(group.rubyCenterCh));
  const reading = document.createElement("span");
  reading.classList.add("furigana-reading", "timed-furigana-reading");
  reading.textContent = group.reading;
  anchor.appendChild(reading);
  return { root, anchor };
};

/** Latest animator entry registered for the current line (just-created word). */
const lastRegisteredWordEntry = (): SyllableLead | undefined => {
  const lead = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead;
  return lead?.[lead.length - 1];
};

type TimedFuriganaRenderState = {
  root: HTMLSpanElement | null;
  groupId: string | undefined;
  times: TimedGroupWindow | null;
};

const createTimedFuriganaRenderState = (): TimedFuriganaRenderState => ({
  root: null,
  groupId: undefined,
  times: null,
});

const resetTimedFuriganaRenderState = (state: TimedFuriganaRenderState): void => {
  state.root = null;
  state.groupId = undefined;
  state.times = null;
};

const appendTimedFuriganaMember = (
  lineElement: HTMLElement,
  word: HTMLElement,
  syllable: SyllableData,
  group: TimedFuriganaGroup,
  state: TimedFuriganaRenderState
): void => {
  if (!state.root || group.id !== state.groupId) {
    const timedGroup = createTimedFuriganaGroup(group);
    lineElement.appendChild(timedGroup.root);
    (word.querySelector(".furigana-cluster") ?? word).appendChild(timedGroup.anchor);
    state.root = timedGroup.root;
    state.groupId = group.id;

    const entry = lastRegisteredWordEntry();
    if (entry) {
      entry.TimedRubyAnchorElement = timedGroup.anchor;
      entry.TimedRubyAnchorOffsetEm = group.rubyCenterCh - Array.from(syllable.Text || "").length / 2;
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
  EmitNotApplyed();

  DestroyAllLyricsContainers();
  const LyricsContainerParent = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .LyricsContent"
  );
  const LyricsContainerInstance = CreateLyricsContainer();
  const LyricsContainer = LyricsContainerInstance.Container;

  // Check if LyricsContainer exists
  if (!LyricsContainer) {
    console.error("LyricsContainer not found");
    return;
  }

  const hasOppositeAligned = data.Content.some(item => item.OppositeAligned === true);
  LyricsContainer.classList.toggle("HasDuetLines", hasOppositeAligned);
  const hasRtlLines = data.Content.some(line =>
    line.Lead.Syllables.some(syllable => isRtl(syllable.Text)) ||
    line.Background?.some(bg => bg.Syllables.some(syllable => isRtl(syllable.Text))) === true
  );
  LyricsContainer.classList.toggle("HasRtlLines", hasRtlLines);

  LyricsContainer.setAttribute("data-lyrics-type", "Syllable");

  ClearLyricsContentArrays();
  ClearScrollSimplebar();

  ClearLyricsPageContainer();

  const virtualContainer = document.createElement("div");
  virtualContainer.classList.add("VirtualLyricsContainer");
  LyricsContainer.appendChild(virtualContainer);

  const lineElements: HTMLElement[] = [];

  if (data.StartTime >= getLyricsBetweenShow()) {
    const musicalLine = document.createElement("div");
    musicalLine.classList.add("line");
    musicalLine.classList.add("musical-line");
    LyricsObject.Types.Syllable.Lines.push({
      HTMLElement: musicalLine,
      StartTime: 0,
      EndTime: ConvertTime(data.StartTime),
      TotalTime: ConvertTime(data.StartTime),
      DotLine: true,
    });

    SetWordArrayInCurentLine();

    if (data.Content[0].OppositeAligned) {
      musicalLine.classList.add("OppositeAligned");
    }

    const dotGroup = document.createElement("div");
    dotGroup.classList.add("dotGroup");

    const musicalDots1 = document.createElement("span");
    const musicalDots2 = document.createElement("span");
    const musicalDots3 = document.createElement("span");

    const totalTime = ConvertTime(data.StartTime);
    const baseDotTime = totalTime / 3;
    const dotPadding = getInterludeTimePadding() / 3;
    const dot1EndTime = Math.max(0, baseDotTime + dotPadding);
    const dot2EndTime = Math.max(dot1EndTime, baseDotTime * 2 + dotPadding * 2);
    const dot3EndTime = Math.max(dot2EndTime, totalTime + getInterludeTimePadding());

    musicalDots1.classList.add("word");
    musicalDots1.classList.add("dot");
    musicalDots1.textContent = "•";

    // Check if Syllables.Lead exists
    if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
      LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
        HTMLElement: musicalDots1,
        StartTime: 0,
        EndTime: dot1EndTime,
        TotalTime: dot1EndTime,
        Dot: true,
      });
    } else {
      console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
    }

    musicalDots2.classList.add("word");
    musicalDots2.classList.add("dot");
    musicalDots2.textContent = "•";

    // Check if Syllables.Lead exists
    if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
      LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
        HTMLElement: musicalDots2,
        StartTime: dot1EndTime,
        EndTime: dot2EndTime,
        TotalTime: dot2EndTime - dot1EndTime,
        Dot: true,
      });
    } else {
      console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
    }

    musicalDots3.classList.add("word");
    musicalDots3.classList.add("dot");
    musicalDots3.textContent = "•";

    // Check if Syllables.Lead exists
    if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
      LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
        HTMLElement: musicalDots3,
        StartTime: dot2EndTime,
        EndTime: dot3EndTime,
        TotalTime: dot3EndTime - dot2EndTime,
        Dot: true,
      });
    } else {
      console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
    }

    dotGroup.appendChild(musicalDots1);
    dotGroup.appendChild(musicalDots2);
    dotGroup.appendChild(musicalDots3);

    musicalLine.appendChild(dotGroup);
    lineElements.push(musicalLine);
  }
  const translationPending = (data as any).TranslationPending === true;
  const romanizationPending = (data as any).RomanizationPending === true;
  const isJapaneseLyrics =
    (data as any).Language === "jpn" ||
    data.Content.some((line) =>
      line.Lead.Syllables.some((s) => isJapaneseEntry(s)) ||
      line.Background?.some((bg) => bg.Syllables.some((s) => isJapaneseEntry(s))) === true
    );
  data.Content.forEach((line, index, arr) => {
    const lineElem = document.createElement("div");
    lineElem.classList.add("line");
    const leadSourceText = line.Lead.JapaneseReading?.sourceText || joinSyllableDisplayText(line.Lead.Syllables);
    lineElem.dataset.spicyLyricsLineId = `lead:${index}`;
    lineElem.dataset.spicyLyricsOriginalText = leadSourceText;
    applyHanLanguageTag(lineElem, joinSyllableDisplayText(line.Lead.Syllables), data, $fixHanGlyphVariants.get());
    const lineRenderOptions = {
      useRomanized: UseRomanized,
      romanizationPending,
      translationPending,
      showProviderTranslations: ShowProviderTranslations,
      isJapaneseLyrics,
      oppositeAligned: line.OppositeAligned,
    };

    const nextLineStartTime = arr[index + 1]?.Lead.StartTime ?? 0;

    const lineEndTimeAndNextLineStartTimeDistance =
      nextLineStartTime !== 0 ? nextLineStartTime - line.Lead.EndTime : 0;

    const lineEndTime =
      $minimalLyricsMode.get() || isSpicySidebarMode
        ? nextLineStartTime === 0
          ? line.Lead.EndTime
          : lineEndTimeAndNextLineStartTimeDistance < getLyricsBetweenShow() &&
              nextLineStartTime > line.Lead.EndTime
            ? nextLineStartTime
            : line.Lead.EndTime
        : line.Lead.EndTime;

    LyricsObject.Types.Syllable.Lines.push({
      HTMLElement: lineElem,
      StartTime: ConvertTime(line.Lead.StartTime),
      EndTime: ConvertTime(lineEndTime),
      TotalTime: ConvertTime(lineEndTime) - ConvertTime(line.Lead.StartTime),
    });

    SetWordArrayInCurentLine();

    if (line.OppositeAligned) {
      lineElem.classList.add("OppositeAligned");
    }

    lineElements.push(lineElem);

    let currentWordGroup: HTMLSpanElement | null = null;
    let currentSemanticGroupId: string | undefined;
    const leadHasFurigana = shouldRenderFurigana(line.Lead, lineRenderOptions) || line.Lead.Syllables.some((s) => shouldRenderFurigana(s, lineRenderOptions));
    const leadUsesSemanticGroups = line.Lead.Syllables.some((s) => !!s.JapaneseReading) && !!line.Lead.ReadingRenderPlan;
    const leadRenderOptions = { ...lineRenderOptions, reserveFurigana: leadHasFurigana };
    const leadLogicalGroupIds = timedLogicalGroupIds(line.Lead.ReadingRenderPlan);
    const leadTimedFurigana = leadHasFurigana
      ? timedFuriganaGroups(line.Lead.ReadingRenderPlan)
      : EMPTY_TIMED_FURIGANA;
    const leadTexts = line.Lead.Syllables.map((s) => s.Text || "");
    const leadTimedFuriganaState = createTimedFuriganaRenderState();

    line.Lead.Syllables.forEach((lead, iL, aL) => {
      if (isRtl(lead.Text) && !lineElem.classList.contains("rtl")) {
        lineElem.classList.add("rtl");
      }

      // Ruby crossing timed syllables is drawn once above a display-only
      // group; member words suppress only their copy of that reading but
      // keep their timing registration. The line is never collapsed.
      const timedFuriganaGroup = leadTimedFurigana.bySpanId.get(String(iL));
      const word = createSyllableWord(
        lead,
        iL,
        aL,
        timedFuriganaGroup
          ? { ...leadRenderOptions, suppressedFuriganaKeys: [timedFuriganaGroup.segmentKey] }
          : leadRenderOptions,
        UseRomanized
      );
      if (timedFuriganaGroup) {
        appendTimedFuriganaMember(lineElem, word, lead, timedFuriganaGroup, leadTimedFuriganaState);
        currentWordGroup = null;
        currentSemanticGroupId = undefined;
        return;
      }
      // Authored whitespace spans between members stay inside the open group
      // so the ruby is not split into duplicates.
      if (
        leadTimedFuriganaState.root &&
        !(lead.Text || "").trim() &&
        timedGroupContinuesAt(leadTexts, leadTimedFurigana, iL + 1, leadTimedFuriganaState.groupId)
      ) {
        leadTimedFuriganaState.root.appendChild(word);
        currentWordGroup = null;
        currentSemanticGroupId = undefined;
        return;
      }
      resetTimedFuriganaRenderState(leadTimedFuriganaState);

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

    const leadRomanizedText = line.Lead.RomanizedText || line.Lead.TransliteratedText;
    const leadEntries = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead;
    appendSyllableRomanizedBelow(
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

        LyricsObject.Types.Syllable.Lines.push({
          HTMLElement: lineE,
          StartTime: ConvertTime(bg.StartTime),
          EndTime: ConvertTime(bg.EndTime),
          TotalTime: ConvertTime(bg.EndTime) - ConvertTime(bg.StartTime),
          BGLine: true,
        });
        SetWordArrayInCurentLine();

        if (line.OppositeAligned) {
          lineE.classList.add("OppositeAligned");
        }
        lineElements.push(lineE);

        let currentBGWordGroup: HTMLSpanElement | null = null;
        let currentBGSemanticGroupId: string | undefined;
        const bgHasFurigana = shouldRenderFurigana(bg, bgRenderOptions) || bg.Syllables.some((s) => shouldRenderFurigana(s, bgRenderOptions));
        const bgUsesSemanticGroups = bg.Syllables.some((s) => !!s.JapaneseReading) && !!bg.ReadingRenderPlan;
        const bgWordRenderOptions = { ...bgRenderOptions, reserveFurigana: bgHasFurigana };
        const bgSourceText = bg.JapaneseReading?.sourceText || joinSyllableDisplayText(bg.Syllables);
        const bgLogicalGroupIds = timedLogicalGroupIds(bg.ReadingRenderPlan);
        const bgTimedFurigana = bgHasFurigana
          ? timedFuriganaGroups(bg.ReadingRenderPlan)
          : EMPTY_TIMED_FURIGANA;
        const bgTexts = bg.Syllables.map((s) => s.Text || "");
        const bgTimedFuriganaState = createTimedFuriganaRenderState();

        bg.Syllables.forEach((bw, bI, bA) => {
          if (isRtl(bw.Text) && !lineE.classList.contains("rtl")) {
            lineE.classList.add("rtl");
          }

          const timedFuriganaGroup = bgTimedFurigana.bySpanId.get(String(bI));
          const word = createSyllableWord(
            bw,
            bI,
            bA,
            timedFuriganaGroup
              ? { ...bgWordRenderOptions, suppressedFuriganaKeys: [timedFuriganaGroup.segmentKey] }
              : bgWordRenderOptions,
            UseRomanized,
            true
          );
          if (timedFuriganaGroup) {
            appendTimedFuriganaMember(lineE, word, bw, timedFuriganaGroup, bgTimedFuriganaState);
            currentBGWordGroup = null;
            currentBGSemanticGroupId = undefined;
            return;
          }
          if (
            bgTimedFuriganaState.root &&
            !(bw.Text || "").trim() &&
            timedGroupContinuesAt(bgTexts, bgTimedFurigana, bI + 1, bgTimedFuriganaState.groupId)
          ) {
            bgTimedFuriganaState.root.appendChild(word);
            currentBGWordGroup = null;
            currentBGSemanticGroupId = undefined;
            return;
          }
          resetTimedFuriganaRenderState(bgTimedFuriganaState);

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

        const bgRomanizedText = bg.RomanizedText || bg.TransliteratedText;
        const allEntries = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead || [];
        const bgEntries = allEntries.filter((entry: any) => entry.BGWord);
        appendSyllableRomanizedBelow(
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
    if (arr[index + 1] && arr[index + 1].Lead.StartTime - line.Lead.EndTime >= getLyricsBetweenShow()) {
      const musicalLine = document.createElement("div");
      musicalLine.classList.add("line");
      musicalLine.classList.add("musical-line");

      LyricsObject.Types.Syllable.Lines.push({
        HTMLElement: musicalLine,
        StartTime: ConvertTime(line.Lead.EndTime),
        EndTime: ConvertTime(arr[index + 1].Lead.StartTime),
        TotalTime:
          ConvertTime(arr[index + 1].Lead.StartTime) -
          ConvertTime(line.Lead.EndTime),
        DotLine: true,
      });

      SetWordArrayInCurentLine();

      if (arr[index + 1].OppositeAligned) {
        musicalLine.classList.add("OppositeAligned");
      }

      const dotGroup = document.createElement("div");
      dotGroup.classList.add("dotGroup");

      const musicalDots1 = document.createElement("span");
      const musicalDots2 = document.createElement("span");
      const musicalDots3 = document.createElement("span");

      const gapStartTime = ConvertTime(line.Lead.EndTime);
      const totalTime = ConvertTime(arr[index + 1].Lead.StartTime) - gapStartTime;
      const baseDotTime = totalTime / 3;
      const dotPadding = getInterludeTimePadding() / 3;
      const dot1EndTime = Math.max(gapStartTime, gapStartTime + baseDotTime + dotPadding);
      const dot2EndTime = Math.max(dot1EndTime, gapStartTime + baseDotTime * 2 + dotPadding * 2);
      const dot3EndTime = Math.max(dot2EndTime, gapStartTime + totalTime + getInterludeTimePadding());

      musicalDots1.classList.add("word");
      musicalDots1.classList.add("dot");
      musicalDots1.textContent = "•";

      // Check if Syllables.Lead exists
      if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
        LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
          HTMLElement: musicalDots1,
          StartTime: gapStartTime,
          EndTime: dot1EndTime,
          TotalTime: dot1EndTime - gapStartTime,
          Dot: true,
        });
      } else {
        console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
      }

      musicalDots2.classList.add("word");
      musicalDots2.classList.add("dot");
      musicalDots2.textContent = "•";

      // Check if Syllables.Lead exists
      if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
        LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
          HTMLElement: musicalDots2,
          StartTime: dot1EndTime,
          EndTime: dot2EndTime,
          TotalTime: dot2EndTime - dot1EndTime,
          Dot: true,
        });
      } else {
        console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
      }

      musicalDots3.classList.add("word");
      musicalDots3.classList.add("dot");
      musicalDots3.textContent = "•";

      // Check if Syllables.Lead exists
      if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
        LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
          HTMLElement: musicalDots3,
          StartTime: dot2EndTime,
          EndTime: dot3EndTime,
          TotalTime: dot3EndTime - dot2EndTime,
          Dot: true,
        });
      } else {
        console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
      }

      dotGroup.appendChild(musicalDots1);
      dotGroup.appendChild(musicalDots2);
      dotGroup.appendChild(musicalDots3);

      musicalLine.appendChild(dotGroup);
      lineElements.push(musicalLine);
    }
  });

  ApplyLyricsCredits(data, LyricsContainer);
  ApplyLyricsProvider(data, LyricsContainer);
  ApplyProviderCredits(data, LyricsContainer);
  ApplyIsByCommunity(data, LyricsContainer);

  if (LyricsContainerParent) {
    LyricsContainerInstance.Append(LyricsContainerParent);
  }

  if (ScrollSimplebar) RecalculateScrollSimplebar();
  else MountScrollSimplebar();

  const scrollEl = ScrollSimplebar?.getScrollElement() as HTMLElement | undefined;
  if (scrollEl) initLyricsVirtualizer(scrollEl, virtualContainer, lineElements);

  const LyricsStylingContainer = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .LyricsContent .simplebar-content"
  );

  // Check if LyricsStylingContainer exists
  if (LyricsStylingContainer) {
    removeAllStyles(LyricsStylingContainer);

    if (data.classes) {
      LyricsStylingContainer.className = data.classes;
    }

    if (data.styles) {
      applyStyles(LyricsStylingContainer, data.styles);
    }
  } else {
    console.warn("LyricsStylingContainer not found");
  }

  EmitApply(data.Type, data.Content);

  setRomanizedStatus(UseRomanized);
}
