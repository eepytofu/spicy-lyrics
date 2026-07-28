import { ConvertTime } from "../../ConvertTime.ts";
import type { LyricsLine, SyllableLead } from "../../lyrics.ts";

export type InterludeDotWindow = Readonly<{
  startTime: number;
  endTime: number;
}>;

export type InterludeLine = Readonly<{
  element: HTMLElement;
  line: LyricsLine;
  dots: readonly SyllableLead[];
}>;

export function interludeDotWindows(
  startTime: number,
  endTime: number,
  padding: number,
): readonly InterludeDotWindow[] {
  const start = ConvertTime(startTime);
  const totalTime = ConvertTime(endTime) - start;
  const baseDotTime = totalTime / 3;
  const dotPadding = padding / 3;
  const firstEnd = Math.max(start, start + baseDotTime + dotPadding);
  const secondEnd = Math.max(firstEnd, start + baseDotTime * 2 + dotPadding * 2);
  const thirdEnd = Math.max(secondEnd, start + totalTime + padding);
  return Object.freeze([
    Object.freeze({ startTime: start, endTime: firstEnd }),
    Object.freeze({ startTime: firstEnd, endTime: secondEnd }),
    Object.freeze({ startTime: secondEnd, endTime: thirdEnd }),
  ]);
}

export function createInterludeLine(
  startTime: number,
  endTime: number,
  oppositeAligned: boolean,
  padding: number,
): InterludeLine {
  const element = document.createElement("div");
  element.classList.add("line", "musical-line");
  if (oppositeAligned) element.classList.add("OppositeAligned");

  const dotGroup = document.createElement("div");
  dotGroup.classList.add("dotGroup");
  const windows = interludeDotWindows(startTime, endTime, padding);
  const dots = windows.map((window) => {
    const dotElement = document.createElement("span");
    dotElement.classList.add("word", "dot");
    dotElement.textContent = "•";
    dotGroup.appendChild(dotElement);
    return {
      HTMLElement: dotElement,
      StartTime: window.startTime,
      EndTime: window.endTime,
      TotalTime: window.endTime - window.startTime,
      Dot: true,
    } satisfies SyllableLead;
  });
  element.appendChild(dotGroup);

  const convertedStartTime = ConvertTime(startTime);
  const convertedEndTime = ConvertTime(endTime);
  return {
    element,
    line: {
      HTMLElement: element,
      StartTime: convertedStartTime,
      EndTime: convertedEndTime,
      TotalTime: convertedEndTime - convertedStartTime,
      DotLine: true,
    },
    dots,
  };
}
