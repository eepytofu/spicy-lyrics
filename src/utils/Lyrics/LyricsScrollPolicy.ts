export function shouldVerifyLyricsScroll(instant: boolean, targetAlreadyMounted: boolean): boolean {
  return instant || !targetAlreadyMounted;
}

type TimedScrollLine = {
  StartTime?: number;
  EndTime?: number;
  BGLine?: boolean;
};

/** Keep a lead line anchored while its background vocals finish before the lookahead line. */
export function chooseScrollLineIndex(
  lines: readonly TimedScrollLine[],
  position: number,
  pinLookahead = 2,
): number | null {
  const activeIndices: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      typeof line.StartTime === "number" &&
      typeof line.EndTime === "number" &&
      line.StartTime <= position &&
      line.EndTime >= position
    ) {
      activeIndices.push(index);
    }
  }
  if (activeIndices.length === 0) return null;

  const isBackgroundLine = (index: number) => lines[index]?.BGLine === true;
  const resolveLeadIndex = (index: number) => {
    let leadIndex = index;
    while (leadIndex > 0 && isBackgroundLine(leadIndex)) leadIndex -= 1;
    return leadIndex;
  };
  const anchorIndex = resolveLeadIndex(activeIndices[0]);

  let remaining = pinLookahead;
  let lookaheadIndex: number | null = null;
  for (let index = anchorIndex + 1; index < lines.length; index += 1) {
    if (isBackgroundLine(index)) continue;
    if (--remaining === 0) {
      lookaheadIndex = index;
      break;
    }
  }

  let groupEndTime = lines[anchorIndex].EndTime;
  for (let index = anchorIndex + 1; index < lines.length && isBackgroundLine(index); index += 1) {
    const endTime = lines[index].EndTime;
    if (typeof endTime === "number" && (typeof groupEndTime !== "number" || endTime > groupEndTime)) {
      groupEndTime = endTime;
    }
  }
  if (lookaheadIndex === null || (
    typeof groupEndTime === "number" &&
    typeof lines[lookaheadIndex].StartTime === "number" &&
    groupEndTime <= lines[lookaheadIndex].StartTime
  )) {
    return anchorIndex;
  }

  const firstIndex = activeIndices[0];
  const lastIndex = activeIndices[activeIndices.length - 1];
  return resolveLeadIndex(lastIndex - firstIndex <= 1 ? firstIndex : lastIndex);
}

type VerticalBorderBoxEntry = {
  borderBoxSize?: ReadonlyArray<{ blockSize: number }> | { blockSize: number };
};

export function measuredVerticalSize(
  element: { offsetHeight: number },
  entry?: VerticalBorderBoxEntry,
): number {
  const borderBoxSize = entry?.borderBoxSize;
  const box = Array.isArray(borderBoxSize) ? borderBoxSize[0] : borderBoxSize;
  return box && Number.isFinite(box.blockSize) ? Math.round(box.blockSize) : element.offsetHeight;
}
