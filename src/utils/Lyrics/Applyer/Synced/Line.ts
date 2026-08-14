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
import { indexedVisibleLyricsEntries, isProviderInfoEntry } from "../../ProviderInfo.ts";

// Define the data structure for lyrics
type LyricsLineData = TimedTextEntry;

interface LyricsData {
  Type: string;
  Content: LyricsLineData[];
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
  const hasRtlLines = visibleLines.some(({ entry }) => isRtl(entry.Text));
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
    || visibleLines.some(({ entry }) => isJapaneseEntry(entry));

  visibleLines.forEach(({ entry: line, sourceIndex }, index, arr) => {
    const providerInfo = isProviderInfoEntry(line);
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
    const renderOptions = {
      useRomanized: providerInfo ? false : UseRomanized,
      romanizationPending: providerInfo ? false : romanizationPending,
      chineseDocument: (data as any).DetectedChinese === true,
      translationPending: providerInfo ? false : translationPending,
      showProviderTranslations: providerInfo ? false : ShowProviderTranslations,
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
