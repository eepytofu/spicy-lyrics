const LabelShapedLine = /^[^:\n]{1,48}:/u;

/**
 * Chinese-provider glyph repair is a display projection, not source recovery.
 * Preserve compact `label: value` rows exactly without trying to enumerate
 * every possible contributor role. This decision never changes timing,
 * animation, typography, or whether the row remains in the lyric timeline.
 */
export function allowsChineseProviderJapaneseRepair(text: string): boolean {
  const normalized = (text || "").normalize("NFKC").trim();
  return normalized.length > 0 && !LabelShapedLine.test(normalized);
}
