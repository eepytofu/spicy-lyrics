export function shouldVerifyLyricsScroll(instant: boolean, targetAlreadyMounted: boolean): boolean {
  return instant || !targetAlreadyMounted;
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
