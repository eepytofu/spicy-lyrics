export interface EmphasisTimingWindow {
  StartTime: number;
  EndTime: number;
}

/** Preserve per-source-glyph timing when one rendered unit owns several glyphs. */
export function distributeEmphasisTiming(
  startTime: number,
  endTime: number,
  lengths: readonly number[]
): EmphasisTimingWindow[] {
  const weights = lengths.map((length) => Math.max(1, length));
  const totalLength = weights.reduce((sum, length) => sum + length, 0);
  let elapsedLength = 0;
  return weights.map((length) => {
    const StartTime = startTime + (elapsedLength / totalLength) * (endTime - startTime);
    elapsedLength += length;
    const EndTime = startTime + (elapsedLength / totalLength) * (endTime - startTime);
    return { StartTime, EndTime };
  });
}
