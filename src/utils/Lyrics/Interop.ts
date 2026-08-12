import { needsSyllableSpaceBefore } from "./Processing/SyllableBoundaries.ts";
import {
  formatMixedScriptReadingForDisplay,
  projectMixedScriptReadability,
} from "./Processing/MixedScriptReadability.ts";
import { ensureSourceLyricDocument } from "./Processing/SourceLyricDocument.ts";

export const SPICY_LYRICS_INTEROP_VERSION = 1;

export type SpicyLyricsInteropWord = {
  text: string;
  providerText: string;
  displayText: string;
  startTime: number;
  endTime: number;
  isPartOfWord: boolean;
};

export type SpicyLyricsInteropLine = {
  id: string;
  index: number;
  originalText: string;
  providerText: string;
  displayText: string;
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

const clean = (value: unknown): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const exact = (value: unknown): string => String(value ?? "");
const readableDisplay = (value: unknown): string =>
  clean(projectMixedScriptReadability(exact(value)).text);

function cloneSnapshot(
  snapshot: SpicyLyricsInteropSnapshot | null
): SpicyLyricsInteropSnapshot | null {
  return snapshot ? (JSON.parse(JSON.stringify(snapshot)) as SpicyLyricsInteropSnapshot) : null;
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
  const readable = clean(formatMixedScriptReadingForDisplay(source, reading));
  return readable && readable !== source ? readable : undefined;
}

function joinSyllableText(syllables: any[]): string {
  return syllables
    .reduce((result, syllable, index) => {
      const text = String(syllable?.Text ?? "");
      if (index === 0) return text;
      return `${result}${needsSyllableSpaceBefore(syllables, index) ? " " : ""}${text}`;
    }, "")
    .replace(/\s+/g, " ")
    .trim();
}

function syllableReading(group: any, syllables: any[]): string | undefined {
  const sourceText = clean(group?.JapaneseReading?.sourceText || joinSyllableText(syllables));
  const groupReading = readingText({
    ...group,
    Text: group?.Text || sourceText,
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
  if (!chunks.some((chunk, index) => chunk && chunk !== clean(syllables[index]?.Text)))
    return undefined;

  const reading =
    chunks
      .reduce((result, chunk, index) => {
        if (!chunk) return result;
        if (!result) return chunk;
        return `${result}${needsSyllableSpaceBefore(syllables, index) ? " " : ""}${chunk}`;
      }, "")
      .replace(/\s+/g, " ")
      .trim() || undefined;
  return clean(formatMixedScriptReadingForDisplay(sourceText, reading)) || undefined;
}

function joinSyllableDisplayText(syllables: any[]): string {
  const joined = syllables.reduce((result, syllable, index) => {
    const text = syllable?.JapaneseReading?.displayText ?? syllable?.Text ?? "";
    if (index === 0) return text;
    return `${result}${needsSyllableSpaceBefore(syllables, index) ? " " : ""}${text}`;
  }, "");
  return readableDisplay(joined);
}

export function buildLyricsInteropSnapshot(lyrics: any): SpicyLyricsInteropSnapshot | null {
  if (!lyrics || !["Static", "Line", "Syllable"].includes(lyrics.Type)) return null;

  const trackUri = clean(lyrics.uri);
  const trackId = clean(lyrics.id || trackUri.split(":").at(-1));
  if (!trackUri && !trackId) return null;
  const sourceDocument = ensureSourceLyricDocument(lyrics).document;
  const sourceLines = new Map(sourceDocument?.lines.map((line) => [line.id, line]));

  const lines: SpicyLyricsInteropLine[] = [];
  const pushLine = (line: Omit<SpicyLyricsInteropLine, "index">): void => {
    if (!line.originalText) return;
    lines.push({ ...line, index: lines.length });
  };

  if (lyrics.Type === "Static") {
    (lyrics.Lines || []).forEach((line: any, sourceIndex: number) => {
      const id = `lead:${sourceIndex}`;
      const providerText = sourceLines.get(id)?.exactText ?? exact(line?.Text);
      const originalText = clean(providerText);
      pushLine({
        id,
        originalText,
        providerText,
        displayText: readableDisplay(line?.JapaneseReading?.displayText ?? line?.Text),
        readingText: readingText(line),
        startTime: 0,
        endTime: 0,
      });
    });
  } else if (lyrics.Type === "Line") {
    (lyrics.Content || []).forEach((line: any, sourceIndex: number) => {
      if (line?.Type === "Instrumental") return;
      const id = `lead:${sourceIndex}`;
      const entry = line?.Text !== undefined ? line : line?.Lead;
      const providerText = sourceLines.get(id)?.exactText ?? exact(entry?.Text);
      const originalText = clean(providerText);
      pushLine({
        id,
        originalText,
        providerText,
        displayText: readableDisplay(entry?.JapaneseReading?.displayText ?? entry?.Text),
        readingText: readingText(entry),
        startTime: Number(line?.StartTime ?? line?.Lead?.StartTime ?? 0),
        endTime: Number(line?.EndTime ?? line?.Lead?.EndTime ?? 0),
      });
    });
  } else {
    (lyrics.Content || []).forEach((group: any, sourceIndex: number) => {
      if (group?.Type === "Instrumental") return;
      const lead = group?.Lead;
      const syllables = Array.isArray(lead?.Syllables) ? lead.Syllables : [];
      const id = `lead:${sourceIndex}`;
      const evidence = sourceLines.get(id);
      const providerText =
        evidence?.exactText ??
        exact(
          lead?.JapaneseReading?.sourceText ||
            syllables.map((syllable: any) => syllable?.Text ?? "").join("")
        );
      const originalText = clean(providerText);
      const groupDisplayText = exact(lead?.JapaneseReading?.displayText);
      const canProjectGroupDisplay =
        !!groupDisplayText && groupDisplayText.length === providerText.length;
      let groupDisplayOffset = 0;
      pushLine({
        id,
        originalText,
        providerText,
        displayText: lead?.JapaneseReading?.displayText
          ? readableDisplay(lead.JapaneseReading.displayText)
          : joinSyllableDisplayText(syllables),
        readingText: syllableReading(lead, syllables),
        startTime: Number(lead?.StartTime ?? group?.StartTime ?? 0),
        endTime: Number(lead?.EndTime ?? group?.EndTime ?? 0),
        words: syllables.map((syllable: any, wordIndex: number) => {
          const wordProviderText =
            evidence?.timingOwners[wordIndex]?.exactText ?? exact(syllable?.Text);
          const projectedGroupDisplay = canProjectGroupDisplay
            ? groupDisplayText.slice(
                groupDisplayOffset,
                groupDisplayOffset + wordProviderText.length
              )
            : undefined;
          groupDisplayOffset += wordProviderText.length;
          return {
            text: clean(wordProviderText),
            providerText: wordProviderText,
            displayText: readableDisplay(
              syllable?.JapaneseReading?.displayText ?? projectedGroupDisplay ?? syllable?.Text
            ),
            startTime: Number(syllable?.StartTime ?? 0),
            endTime: Number(syllable?.EndTime ?? 0),
            isPartOfWord: syllable?.IsPartOfWord === true,
          };
        }),
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
    window.dispatchEvent(
      new CustomEvent("spicy-lyrics:interop-update", {
        detail: cloneSnapshot(snapshot),
      })
    );
  }
}

const interopApi = Object.freeze({
  version: SPICY_LYRICS_INTEROP_VERSION,
  getSnapshot: (): SpicyLyricsInteropSnapshot | null => cloneSnapshot(currentSnapshot),
});

if (typeof window !== "undefined") {
  (window as any).SpicyLyricsInterop = interopApi;
}
