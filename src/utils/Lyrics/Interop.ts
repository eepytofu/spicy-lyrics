export const SPICY_LYRICS_INTEROP_VERSION = 1;

export type SpicyLyricsInteropWord = {
  text: string;
  startTime: number;
  endTime: number;
  isPartOfWord: boolean;
};

export type SpicyLyricsInteropLine = {
  id: string;
  index: number;
  originalText: string;
  readingText?: string;
  startTime: number;
  endTime: number;
  words?: SpicyLyricsInteropWord[];
};

export type SpicyLyricsInteropSnapshot = {
  version: typeof SPICY_LYRICS_INTEROP_VERSION;
  trackUri: string;
  trackId: string;
  lyricsType: "Static" | "Line" | "Syllable";
  language?: string;
  languageISO2?: string;
  lines: SpicyLyricsInteropLine[];
};

type ReadingEntry = {
  Text?: string;
  RomanizedText?: string;
  TransliteratedText?: string;
  JapaneseReading?: { romaji?: string };
  ReadingRenderPlan?: { joinedDisplayText?: string };
};

let currentSnapshot: SpicyLyricsInteropSnapshot | null = null;

const clean = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();

function cloneSnapshot(snapshot: SpicyLyricsInteropSnapshot | null): SpicyLyricsInteropSnapshot | null {
  return snapshot ? JSON.parse(JSON.stringify(snapshot)) as SpicyLyricsInteropSnapshot : null;
}

function readingText(entry: ReadingEntry | null | undefined): string | undefined {
  if (!entry) return undefined;
  const source = clean(entry.Text);
  const reading = clean(
    entry.ReadingRenderPlan?.joinedDisplayText ||
    entry.RomanizedText ||
    entry.TransliteratedText ||
    entry.JapaneseReading?.romaji
  );
  return reading && reading !== source ? reading : undefined;
}

function joinSyllableText(syllables: any[]): string {
  return syllables.reduce((result, syllable, index) => {
    const text = String(syllable?.Text ?? "");
    if (index === 0) return text;
    return `${result}${syllable?.IsPartOfWord ? "" : " "}${text}`;
  }, "").replace(/\s+/g, " ").trim();
}

function syllableReading(group: any, syllables: any[]): string | undefined {
  const groupReading = readingText({
    ...group,
    Text: group?.Text || group?.JapaneseReading?.sourceText || joinSyllableText(syllables),
  });
  if (groupReading) return groupReading;

  const chunks = syllables.map((syllable) =>
    clean(
      syllable?.ReadingRenderPlan?.joinedDisplayText ||
      syllable?.RomanizedText ||
      syllable?.TransliteratedText ||
      syllable?.JapaneseReading?.romaji ||
      syllable?.Text
    )
  );
  if (!chunks.some((chunk, index) => chunk && chunk !== clean(syllables[index]?.Text))) return undefined;

  return chunks.reduce((result, chunk, index) => {
    if (!chunk) return result;
    if (!result) return chunk;
    return `${result}${syllables[index]?.IsPartOfWord ? "" : " "}${chunk}`;
  }, "").replace(/\s+/g, " ").trim() || undefined;
}

export function buildLyricsInteropSnapshot(lyrics: any): SpicyLyricsInteropSnapshot | null {
  if (!lyrics || !["Static", "Line", "Syllable"].includes(lyrics.Type)) return null;

  const trackUri = clean(lyrics.uri);
  const trackId = clean(lyrics.id || trackUri.split(":").at(-1));
  if (!trackUri && !trackId) return null;

  const lines: SpicyLyricsInteropLine[] = [];
  const pushLine = (line: Omit<SpicyLyricsInteropLine, "index">): void => {
    if (!line.originalText) return;
    lines.push({ ...line, index: lines.length });
  };

  if (lyrics.Type === "Static") {
    (lyrics.Lines || []).forEach((line: any, sourceIndex: number) => {
      const originalText = clean(line?.Text);
      pushLine({
        id: `lead:${sourceIndex}`,
        originalText,
        readingText: readingText(line),
        startTime: 0,
        endTime: 0,
      });
    });
  } else if (lyrics.Type === "Line") {
    (lyrics.Content || []).forEach((line: any, sourceIndex: number) => {
      if (line?.Type === "Instrumental") return;
      const originalText = clean(line?.Text ?? line?.Lead?.Text);
      pushLine({
        id: `lead:${sourceIndex}`,
        originalText,
        readingText: readingText(line?.Text !== undefined ? line : line?.Lead),
        startTime: Number(line?.StartTime ?? line?.Lead?.StartTime ?? 0),
        endTime: Number(line?.EndTime ?? line?.Lead?.EndTime ?? 0),
      });
    });
  } else {
    (lyrics.Content || []).forEach((group: any, sourceIndex: number) => {
      if (group?.Type === "Instrumental") return;
      const lead = group?.Lead;
      const syllables = Array.isArray(lead?.Syllables) ? lead.Syllables : [];
      const originalText = clean(lead?.JapaneseReading?.sourceText || joinSyllableText(syllables));
      pushLine({
        id: `lead:${sourceIndex}`,
        originalText,
        readingText: syllableReading(lead, syllables),
        startTime: Number(lead?.StartTime ?? group?.StartTime ?? 0),
        endTime: Number(lead?.EndTime ?? group?.EndTime ?? 0),
        words: syllables.map((syllable: any) => ({
          text: clean(syllable?.Text),
          startTime: Number(syllable?.StartTime ?? 0),
          endTime: Number(syllable?.EndTime ?? 0),
          isPartOfWord: syllable?.IsPartOfWord === true,
        })),
      });
    });
  }

  return {
    version: SPICY_LYRICS_INTEROP_VERSION,
    trackUri,
    trackId,
    lyricsType: lyrics.Type,
    language: clean(lyrics.Language) || undefined,
    languageISO2: clean(lyrics.LanguageISO2) || undefined,
    lines,
  };
}

export function publishLyricsInteropSnapshot(lyrics: any): void {
  const snapshot = buildLyricsInteropSnapshot(lyrics);
  if (!snapshot) return;
  currentSnapshot = snapshot;

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("spicy-lyrics:interop-update", {
      detail: cloneSnapshot(snapshot),
    }));
  }
}

const interopApi = Object.freeze({
  version: SPICY_LYRICS_INTEROP_VERSION,
  getSnapshot: (): SpicyLyricsInteropSnapshot | null => cloneSnapshot(currentSnapshot),
});

if (typeof window !== "undefined") {
  (window as any).SpicyLyricsInterop = interopApi;
}
