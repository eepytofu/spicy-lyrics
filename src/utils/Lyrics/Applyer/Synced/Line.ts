import { $fixHanGlyphVariants, $lyricsContainerExists, $simpleLyricsMode } from "../../../../utils/stores.ts";
import { ConvertTime } from "../../ConvertTime.ts";
import isRtl from "../../isRtl.ts";
import {
  LINE_SYNCED_CurrentLineLyricsObject,
  LyricsObject,
  SetWordArrayInCurentLine_LINE_SYNCED,
  getInterludeTimePadding,
  getLyricsBetweenShow,
} from "../../lyrics.ts";
import { appendLineExtras, forceStackedLine, isJapaneseEntry, renderFullLineBaseTextWithReadings } from "../ReadingRenderer.ts";
import type { TimedTextEntry } from "../../Reading/JapaneseReading.ts";
import { applyHanLanguageTag, createHanLanguageContext } from "../../HanLanguage.ts";
import { createInterludeLine } from "./Interlude.ts";
import { beginLyricsApply, finishLyricsApply } from "../ApplyLifecycle.ts";
import { $hideEmbeddedProviderInfo } from "../../../uiState.ts";
import { indexedVisibleLyricsEntries } from "../../ProviderInfo.ts";
import { isNonLyricSemanticEntry } from "../../VocalSemantics.ts";
import { applyVocalPresentation, type VocalPresentationState } from "../VocalPresentation.ts";

// Define the data structure for lyrics
type LyricsLineData = TimedTextEntry & { Background?: TimedTextEntry[] };

interface LyricsData {
  Type: string;
  Content: LyricsLineData[];
  StartTime: number;
  SongWriters?: string[];
  source?: "spt" | "spl" | "aml";
  classes?: string;
  styles?: Record<string, string>;
  VocalAgents?: Record<string, { Type?: string; Names: string[] }>;
}

const appendInterludeLine = (
  lineElements: HTMLElement[],
  startTime: number,
  endTime: number,
  oppositeAligned: boolean,
): void => {
  const interlude = createInterludeLine(
    startTime,
    endTime,
    oppositeAligned,
    getInterludeTimePadding(),
  );
  LyricsObject.Types.Line.Lines.push(interlude.line);
  SetWordArrayInCurentLine_LINE_SYNCED();
  const lead =
    LyricsObject.Types.Line.Lines[LINE_SYNCED_CurrentLineLyricsObject]?.Syllables?.Lead;
  if (lead) lead.push(...interlude.dots);
  else console.warn("Syllables.Lead is undefined for LINE_SYNCED_CurrentLineLyricsObject");
  lineElements.push(interlude.element);
};

export function ApplyLineLyrics(
  data: LyricsData,
  UseRomanized: boolean = false,
  ShowProviderTranslations: boolean = false
): void {
  if (!$lyricsContainerExists.get()) return;

  const visibleLines = indexedVisibleLyricsEntries(
    data.Content,
    (line) => line,
    $hideEmbeddedProviderInfo.get(),
  );
  const hasOppositeAligned = visibleLines.some(({ entry }) => entry.OppositeAligned === true);
  const hasRtlLines = visibleLines.some(({ entry }) =>
    isRtl(entry.Text) || entry.Background?.some((background) => isRtl(background.Text))
  );
  const applyContext = beginLyricsApply("Line", hasOppositeAligned, hasRtlLines);
  if (!applyContext) return;
  const { lineElements } = applyContext;

  const firstVisibleLine = visibleLines[0]?.entry;
  if (firstVisibleLine && firstVisibleLine.StartTime >= getLyricsBetweenShow()) {
    appendInterludeLine(
      lineElements,
      0,
      firstVisibleLine.StartTime,
      firstVisibleLine.OppositeAligned === true,
    );
  }

  const translationPending = (data as any).TranslationPending === true;
  const romanizationPending = (data as any).RomanizationPending === true;
  const fixHanGlyphVariants = $fixHanGlyphVariants.get();

  const isJapaneseLyrics = (data as any).Language === "jpn"
    || visibleLines.some(({ entry }) =>
      isJapaneseEntry(entry) || entry.Background?.some((background) => isJapaneseEntry(background))
    );
  const vocalPresentationState: VocalPresentationState = {};

  visibleLines.forEach(({ entry: line, sourceIndex }, index, arr) => {
    const nonLyricSemantic = isNonLyricSemanticEntry(line);
    const lineElem = document.createElement("div");
    lineElem.dataset.spicyLyricsLineId = `lead:${sourceIndex}`;
    lineElem.dataset.spicyLyricsOriginalText = line.Text || "";
    const hanLanguageContext = createHanLanguageContext(
      data,
      line.Text,
      fixHanGlyphVariants,
      line.ReadingPrimaryScript,
    );
    applyHanLanguageTag(lineElem, hanLanguageContext);
    applyVocalPresentation(lineElem, data, line, vocalPresentationState);
    const renderOptions = {
      useRomanized: nonLyricSemantic ? false : UseRomanized,
      romanizationPending: nonLyricSemantic ? false : romanizationPending,
      chineseDocument: (data as any).DetectedChinese === true,
      translationPending: nonLyricSemantic ? false : translationPending,
      showProviderTranslations: nonLyricSemantic ? false : ShowProviderTranslations,
      isJapaneseLyrics,
      oppositeAligned: line.OppositeAligned,
      hanLanguageContext,
    };

    const hasFurigana = renderFullLineBaseTextWithReadings(lineElem, line, renderOptions);
    if (hasFurigana) {
      forceStackedLine(lineElem, line.OppositeAligned);
    }
    const hasExtraSidecars = appendLineExtras(lineElem, line, renderOptions);

    lineElem.classList.add("line");

    if (isRtl(line.Text) && !lineElem.classList.contains("rtl")) {
      lineElem.classList.add("rtl");
    }

    const nextLineStartTime = arr[index + 1]?.entry.StartTime ?? 0;

    const lineEndTimeAndNextLineStartTimeDistance =
      nextLineStartTime !== 0 ? nextLineStartTime - line.EndTime : 0;

    const lineEndTime = $simpleLyricsMode.get()
      ? nextLineStartTime === 0
        ? line.EndTime
        : lineEndTimeAndNextLineStartTimeDistance < getLyricsBetweenShow() &&
            nextLineStartTime > line.EndTime
          ? nextLineStartTime
          : line.EndTime
      : line.EndTime;

    LyricsObject.Types.Line.Lines.push({
      HTMLElement: lineElem,
      StartTime: ConvertTime(line.StartTime),
      EndTime: ConvertTime(lineEndTime),
      TotalTime: ConvertTime(lineEndTime) - ConvertTime(line.StartTime),
      HasExtraSidecars: hasExtraSidecars,
    });

    if (line.OppositeAligned) {
      lineElem.classList.add("OppositeAligned");
    }

    lineElements.push(lineElem);

    line.Background?.forEach((background, backgroundIndex) => {
      const backgroundElement = document.createElement("div");
      backgroundElement.classList.add("line", "bg-line");
      backgroundElement.dataset.spicyLyricsLineId = `background:${sourceIndex}:${backgroundIndex}`;
      backgroundElement.dataset.spicyLyricsOriginalText = background.Text || "";
      const backgroundContext = createHanLanguageContext(
        data,
        background.Text,
        fixHanGlyphVariants,
        background.ReadingPrimaryScript,
      );
      applyHanLanguageTag(backgroundElement, backgroundContext);
      const backgroundOptions = {
        ...renderOptions,
        hanLanguageContext: backgroundContext,
      };
      if (renderFullLineBaseTextWithReadings(backgroundElement, background, backgroundOptions)) {
        forceStackedLine(backgroundElement, line.OppositeAligned);
      }
      const hasBackgroundExtras = appendLineExtras(
        backgroundElement,
        background,
        backgroundOptions,
      );
      if (isRtl(background.Text)) backgroundElement.classList.add("rtl");
      if (line.OppositeAligned) backgroundElement.classList.add("OppositeAligned");
      LyricsObject.Types.Line.Lines.push({
        HTMLElement: backgroundElement,
        StartTime: ConvertTime(background.StartTime),
        EndTime: ConvertTime(background.EndTime),
        TotalTime: ConvertTime(background.EndTime) - ConvertTime(background.StartTime),
        HasExtraSidecars: hasBackgroundExtras,
        BGLine: true,
      });
      lineElements.push(backgroundElement);
    });
    if (arr[index + 1] && arr[index + 1].entry.StartTime - line.EndTime >= getLyricsBetweenShow()) {
      appendInterludeLine(
        lineElements,
        line.EndTime,
        arr[index + 1].entry.StartTime,
        arr[index + 1].entry.OppositeAligned === true,
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
