import { PageContainer } from "../../../components/Pages/PageView.ts";
import { applyStyles, removeAllStyles, type StyleProperties } from "../../CSS/Styles.ts";
import {
  ClearScrollSimplebar,
  MountScrollSimplebar,
  RecalculateScrollSimplebar,
  ScrollSimplebar,
} from "../../Scrolling/Simplebar/ScrollSimplebar.ts";
import { ClearLyricsPageContainer } from "../fetchLyrics.ts";
import {
  ClearLyricsContentArrays,
  setRomanizedStatus,
  type LyricsType,
} from "../lyrics.ts";
import { initLyricsVirtualizer } from "../LyricsVirtualizer.ts";
import { CreateLyricsContainer, DestroyAllLyricsContainers } from "./CreateLyricsContainer.ts";
import { ApplyIsByCommunity } from "./Credits/ApplyIsByCommunity.tsx";
import { ApplyLyricsCredits } from "./Credits/ApplyLyricsCredits.ts";
import { ApplyLyricsProvider } from "./Credits/ApplyProvider.ts";
import { ApplyProviderCredits } from "./Credits/ApplyProviderCredits.ts";
import { EmitApply, EmitNotApplyed } from "./OnApply.ts";

export type LyricsApplyData = {
  Type: string;
  SongWriters?: string[];
  classes?: string;
  styles?: StyleProperties;
  offline?: boolean;
};

export type LyricsApplyContext = {
  lyricsContainer: HTMLElement;
  lyricsContainerParent: HTMLElement | null | undefined;
  lyricsContainerInstance: ReturnType<typeof CreateLyricsContainer>;
  virtualContainer: HTMLElement;
  lineElements: HTMLElement[];
};

export function beginLyricsApply(
  lyricsType: LyricsType,
  hasDuetLines: boolean,
  hasRtlLines: boolean,
  missingContainerMessage: string = "LyricsContainer not found",
): LyricsApplyContext | undefined {
  EmitNotApplyed();
  DestroyAllLyricsContainers();

  const lyricsContainerParent = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .LyricsContent",
  );
  const lyricsContainerInstance = CreateLyricsContainer();
  const lyricsContainer = lyricsContainerInstance.Container;
  if (!lyricsContainer) {
    console.error(missingContainerMessage);
    return undefined;
  }

  lyricsContainer.classList.toggle("HasDuetLines", hasDuetLines);
  lyricsContainer.classList.toggle("HasRtlLines", hasRtlLines);
  lyricsContainer.setAttribute("data-lyrics-type", lyricsType);

  ClearLyricsContentArrays();
  ClearScrollSimplebar();
  ClearLyricsPageContainer();

  const virtualContainer = document.createElement("div");
  virtualContainer.classList.add("VirtualLyricsContainer");
  lyricsContainer.appendChild(virtualContainer);

  return {
    lyricsContainer,
    lyricsContainerParent,
    lyricsContainerInstance,
    virtualContainer,
    lineElements: [],
  };
}

export function finishLyricsApply(
  context: LyricsApplyContext,
  data: LyricsApplyData,
  content: unknown,
  useRomanized: boolean,
  warnWhenStylingContainerMissing: boolean = false,
): void {
  const {
    lyricsContainer,
    lyricsContainerParent,
    lyricsContainerInstance,
    virtualContainer,
    lineElements,
  } = context;

  ApplyLyricsCredits(data, lyricsContainer);
  ApplyLyricsProvider(data, lyricsContainer);
  ApplyProviderCredits(data, lyricsContainer);
  ApplyIsByCommunity(data, lyricsContainer);

  if (lyricsContainerParent) lyricsContainerInstance.Append(lyricsContainerParent);

  if (ScrollSimplebar) RecalculateScrollSimplebar();
  else MountScrollSimplebar();

  const scrollElement = ScrollSimplebar?.getScrollElement() as HTMLElement | undefined;
  if (scrollElement) {
    initLyricsVirtualizer(scrollElement, virtualContainer, lineElements);
  }

  const stylingContainer = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .LyricsContent .simplebar-content",
  );
  if (stylingContainer) {
    if (data.offline) stylingContainer.classList.add("offline");
    removeAllStyles(stylingContainer);
    if (data.classes) stylingContainer.className = data.classes;
    if (data.styles) applyStyles(stylingContainer, data.styles);
  } else if (warnWhenStylingContainerMissing) {
    console.warn("LyricsStylingContainer not found");
  }

  EmitApply(data.Type, content);
  setRomanizedStatus(useRomanized);
}
