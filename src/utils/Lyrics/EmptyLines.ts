import { cleanInvisiblesPreserveEdges } from "./Fork/TextDetection.ts";

export const hasLyricsText = (text: unknown): boolean =>
  typeof text === "string" && cleanInvisiblesPreserveEdges(text).trim() !== "";

/**
 * A source row remains displayable when either its authored text or a reading
 * lane can fill the base slot. Translation-only rows are not lyrics rows.
 */
export const displayBaseText = (entry: any): string => {
  const candidates = [
    entry?.JapaneseReading?.displayText,
    entry?.Text,
    entry?.ReadingRenderPlan?.joinedDisplayText,
    entry?.RomanizedText,
    entry?.TransliteratedText,
    entry?.ProviderRomanizedText,
    entry?.JapaneseReading?.romaji,
  ];
  return candidates.find(hasLyricsText) ?? "";
};

export const hasRenderableText = (entry: any): boolean =>
  hasLyricsText(displayBaseText(entry));

const hasAuthoredWhitespace = (entry: any): boolean => {
  if (typeof entry?.Text !== "string") return false;
  const text = cleanInvisiblesPreserveEdges(entry.Text);
  return text !== "" && /^\s+$/u.test(text);
};

const keepTimingOwner = (entry: any): boolean =>
  hasRenderableText(entry) || hasAuthoredWhitespace(entry);

export const isEmptySyllableGroup = (group: any): boolean =>
  !Array.isArray(group?.Syllables) ||
  !group.Syllables.some((syllable: any) => hasRenderableText(syllable));

export const isEmptyLyricsLine = (line: any): boolean => {
  if (line?.Lead !== undefined) {
    return (
      isEmptySyllableGroup(line.Lead) &&
      !(Array.isArray(line.Background) &&
        line.Background.some((background: any) => !isEmptySyllableGroup(background)))
    );
  }

  return (
    !hasRenderableText(line) &&
    !(Array.isArray(line?.Background) &&
      line.Background.some((background: any) => hasRenderableText(background)))
  );
};

export const removeEmptyLyricsLines = <T>(lines: readonly T[] | undefined | null): T[] =>
  Array.isArray(lines) ? lines.filter((line) => !isEmptyLyricsLine(line)) : [];

/**
 * Mutate only the working presentation document. Callers capture immutable
 * SourceEvidence before invoking this function.
 */
export const stripEmptyLyricsLines = (lyrics: any): void => {
  if (!lyrics || typeof lyrics !== "object") return;

  if (Array.isArray(lyrics.Lines)) {
    lyrics.Lines = removeEmptyLyricsLines(lyrics.Lines);
  }

  if (!Array.isArray(lyrics.Content)) return;
  lyrics.Content = removeEmptyLyricsLines(lyrics.Content);

  for (const line of lyrics.Content) {
    if (Array.isArray(line?.Lead?.Syllables)) {
      line.Lead.Syllables = line.Lead.Syllables.filter(keepTimingOwner);
    }
    if (!Array.isArray(line?.Background)) continue;

    if (line?.Lead !== undefined) {
      line.Background = line.Background
        .filter((background: any) => !isEmptySyllableGroup(background))
        .map((background: any) => {
          background.Syllables = background.Syllables.filter(keepTimingOwner);
          return background;
        });
    } else {
      line.Background = line.Background.filter((background: any) =>
        hasRenderableText(background),
      );
    }

    if (line.Background.length === 0) delete line.Background;
  }
};

/** Recognised lyric payloads with no renderable root row are empty. */
export const hasRenderableLyrics = (lyrics: any): boolean => {
  if (!lyrics || typeof lyrics !== "object") return false;
  if (lyrics.Type === "Static") {
    return Array.isArray(lyrics.Lines) &&
      lyrics.Lines.some((line: any) => !isEmptyLyricsLine(line));
  }
  if (lyrics.Type === "Line" || lyrics.Type === "Syllable") {
    if (!Array.isArray(lyrics.Content)) return false;
    return lyrics.Content.some((line: any) => !isEmptyLyricsLine(line));
  }
  return false;
};

export const isEmptyLyrics = (lyrics: any): boolean => {
  if (!lyrics || typeof lyrics !== "object") return true;
  const lines = Array.isArray(lyrics.Lines) ? lyrics.Lines : undefined;
  const content = Array.isArray(lyrics.Content) ? lyrics.Content : undefined;
  if (lines === undefined && content === undefined) return false;
  return (lines?.length ?? 0) === 0 && (content?.length ?? 0) === 0;
};
