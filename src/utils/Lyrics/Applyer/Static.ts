import { $fixHanGlyphVariants, $lyricsContainerExists } from "../../../utils/stores.ts";
import { type StyleProperties } from "../../CSS/Styles.ts";
import isRtl from "../isRtl.ts";
import {
  LyricsObject,
  type LyricsStatic,
} from "../lyrics.ts";
import { appendLineExtras, forceStackedLine, isJapaneseEntry, renderBaseTextWithReadings } from "./ReadingRenderer.ts";
import type { ProcessedTextEntry } from "../Reading/JapaneseReading.ts";
import { applyHanLanguageTag } from "../HanLanguage.ts";
import { beginLyricsApply, finishLyricsApply } from "./ApplyLifecycle.ts";

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

  const hasRtlLines = data.Lines.some(line => isRtl(line.Text));
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

  const isJapaneseLyrics = (data as any).Language === "jpn" || data.Lines.some((line) => isJapaneseEntry(line));

  data.Lines.forEach((line, index) => {
    const lineElem = document.createElement("div");
    lineElem.dataset.spicyLyricsLineId = `lead:${index}`;
    lineElem.dataset.spicyLyricsOriginalText = line.Text || "";
    applyHanLanguageTag(lineElem, line.Text, data, $fixHanGlyphVariants.get());
    const renderOptions = {
      useRomanized: UseRomanized,
      romanizationPending,
      translationPending,
      showProviderTranslations: ShowProviderTranslations,
      isJapaneseLyrics,
    };

    if (renderBaseTextWithReadings(lineElem, line, renderOptions)) {
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

  finishLyricsApply(applyContext, data, data.Lines, UseRomanized);
}
