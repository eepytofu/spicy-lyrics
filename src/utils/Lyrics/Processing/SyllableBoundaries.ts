import {
  resolveLyricBoundary,
  type BoundaryResolution,
} from "./BoundaryResolver.ts";

export type BoundarySyllable = {
  Text?: string;
  IsPartOfWord?: boolean;
  RomajiSpaceBefore?: boolean;
};

export function resolveSyllableBoundary(
  syllables: readonly BoundarySyllable[],
  index: number,
): BoundaryResolution {
  if (index <= 0) {
    return resolveLyricBoundary({
      previousText: "",
      currentText: syllables[index]?.Text || "",
      previousProviderPartOfWord: true,
    });
  }

  const previous = syllables[index - 1];
  const current = syllables[index];
  return resolveLyricBoundary({
    previousText: previous?.Text || "",
    currentText: current?.Text || "",
    previousProviderPartOfWord: previous?.IsPartOfWord,
    linguisticBoundaryBefore: current?.RomajiSpaceBefore,
  });
}

export function needsSyllableSpaceBefore(
  syllables: readonly BoundarySyllable[],
  index: number,
): boolean {
  return resolveSyllableBoundary(syllables, index).needsNormalizedSpace;
}
