import { $fixHanGlyphVariants, $lyricsContainerExists } from "../../../utils/stores.ts";
import { type StyleProperties } from "../../CSS/Styles.ts";
import isRtl from "../isRtl.ts";
import {
  LyricsObject,
  type LyricsStatic,
} from "../lyrics.ts";
import { appendLineExtras, forceStackedLine, isJapaneseEntry, renderFullLineBaseTextWithReadings } from "./ReadingRenderer.ts";
import type { ProcessedTextEntry } from "../Reading/JapaneseReading.ts";
import { applyHanLanguageTag, createHanLanguageContext } from "../HanLanguage.ts";
import { beginLyricsApply, finishLyricsApply } from "./ApplyLifecycle.ts";
import { $hideEmbeddedProviderInfo } from "../../uiState.ts";
import { indexedVisibleLyricsEntries, isProviderInfoEntry } from "../ProviderInfo.ts";

/**
 * Interface for static lyrics data
 */
export interface StaticLyricsData {
  Type: string;
  Lines: ProcessedTextEntry[];
  offline?: boolean;
  classes?: string;
  styles?: StyleProperties;
  source?: "spt" | "spl" | "aml";
}

/**
 * Apply static lyrics to the lyrics container
 * @param data - Static lyrics data
 */
export function ApplyStaticLyrics(
  data: StaticLyricsData,
  UseRomanized: boolean = false,
  ShowProviderTranslations: boolean = false
): void {
  if (!$lyricsContainerExists.get()) return;

  const visibleLines = indexedVisibleLyricsEntries(
    data.Lines,
    (line) => line,
    $hideEmbeddedProviderInfo.get(),
  );
  const hasRtlLines = visibleLines.some(({ entry }) => isRtl(entry.Text));
  const applyContext = beginLyricsApply(
    "Static",
    false,
    hasRtlLines,
    "Cannot apply static lyrics: LyricsContainer not found",
  );
  if (!applyContext) return;
  const { lineElements } = applyContext;

  const translationPending = (data as any).TranslationPending === true;
  const romanizationPending = (data as any).RomanizationPending === true;
  const fixHanGlyphVariants = $fixHanGlyphVariants.get();

  const isJapaneseLyrics = (data as any).Language === "jpn"
    || visibleLines.some(({ entry }) => isJapaneseEntry(entry));

  visibleLines.forEach(({ entry: line, sourceIndex }) => {
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
      hanLanguageContext,
    };

    if (renderFullLineBaseTextWithReadings(lineElem, line, renderOptions)) {
      forceStackedLine(lineElem);
    }
    appendLineExtras(lineElem, line, renderOptions);

    if (isRtl(line.Text) && !lineElem.classList.contains("rtl")) {
      lineElem.classList.add("rtl");
    }

    lineElem.classList.add("line");
    lineElem.classList.add("static");

    // Add the line element to the lyrics object
    const staticLine: LyricsStatic = {
      HTMLElement: lineElem,
    };

    LyricsObject.Types.Static.Lines.push(staticLine);
    lineElements.push(lineElem);
  });

  finishLyricsApply(applyContext, data, visibleLines.map(({ entry }) => entry), UseRomanized);
}
