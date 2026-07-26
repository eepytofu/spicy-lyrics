export type BoundarySyllable = {
  Text?: string;
  IsPartOfWord?: boolean;
};

export function needsSyllableSpaceBefore(
  syllables: readonly BoundarySyllable[],
  index: number,
): boolean {
  if (index <= 0) return false;
  const previous = syllables[index - 1];
  const previousText = previous?.Text || "";
  const text = syllables[index]?.Text || "";
  if (/\s$/u.test(previousText) || /^\s/u.test(text)) return false;
  return previous?.IsPartOfWord !== true;
}
