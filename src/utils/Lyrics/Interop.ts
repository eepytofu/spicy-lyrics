import { needsSyllableSpaceBefore } from "./Processing/SyllableBoundaries.ts";
import {
  isJapaneseProviderLanguage,
  needsTtmlDisplaySpaceBefore,
} from "./Processing/TtmlDisplaySemantics.ts";
import {
  formatMixedScriptReadingForDisplay,
  projectMixedScriptReadability,
} from "./Processing/MixedScriptReadability.ts";
import {
  ensureSourceLyricDocument,
  type SourceDocumentLine,
} from "./Processing/SourceLyricDocument.ts";
import { providerInfoKind, type ProviderInfoKind } from "./ProviderInfo.ts";
import type { ProviderSidecar } from "./TtmlSemantics.ts";
import {
  vocalAgentId,
  vocalCue,
  type VocalAgents,
  type VocalCue,
} from "./VocalSemantics.ts";
import { isLyricRevision } from "./LyricRevision.ts";

export const SPICY_LYRICS_INTEROP_VERSION = 6;

export type SpicyLyricsInteropSidecar = {
  text: string;
  language?: string;
  words?: SpicyLyricsInteropWord[];
};

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
  providerTranslations?: SpicyLyricsInteropSidecar[];
  providerRomanizations?: SpicyLyricsInteropSidecar[];
  providerLineId?: string;
  songPart?: string;
  songPartBlockIndex?: number;
  providerInfoKind?: ProviderInfoKind;
  vocalCue?: VocalCue;
  vocalAgentId?: string;
  startTime: number;
  endTime: number;
  words?: SpicyLyricsInteropWord[];
};

export type SpicyLyricsInteropSnapshot = {
  version: typeof SPICY_LYRICS_INTEROP_VERSION;
  trackUri: string;
  trackId: string;
  lyricRevisionId?: string;
  providerId?: string;
  sourceCandidateId?: string;
  lyricsType: "Static" | "Line" | "Syllable";
  language?: string;
  languageISO2?: string;
  providerLanguage?: string;
  vocalAgents?: Readonly<VocalAgents>;
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

function interopSidecars(
  sidecars: readonly ProviderSidecar[] | undefined,
): SpicyLyricsInteropSidecar[] | undefined {
  if (!sidecars) return undefined;
  return sidecars.map((sidecar) => ({
    text: sidecar.Text,
    ...(sidecar.Language ? { language: sidecar.Language } : {}),
    ...(sidecar.Words
      ? {
          words: sidecar.Words.map((word) => ({
            text: clean(word.Text),
            providerText: word.Text,
            displayText: readableDisplay(word.Text),
            startTime: word.StartTime,
            endTime: word.EndTime,
            isPartOfWord: word.IsPartOfWord,
          })),
        }
      : {}),
  }));
}

function sourceLineSemantics(line: SourceDocumentLine | undefined): Partial<SpicyLyricsInteropLine> {
  const providerTranslations = interopSidecars(line?.providerTranslations);
  const providerRomanizations = interopSidecars(line?.providerRomanizations);
  return {
    ...(providerTranslations ? { providerTranslations } : {}),
    ...(providerRomanizations ? { providerRomanizations } : {}),
    ...(line?.providerLineId ? { providerLineId: line.providerLineId } : {}),
    ...(line?.songPart ? { songPart: line.songPart } : {}),
    ...(line?.songPartBlockIndex !== undefined
      ? { songPartBlockIndex: line.songPartBlockIndex }
      : {}),
  };
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

function joinSyllableDisplayText(
  syllables: any[],
  providerLanguage?: string,
  source?: string,
): string {
  const joined = syllables.reduce((result, syllable, index) => {
    const text = syllable?.JapaneseReading?.displayText ?? syllable?.Text ?? "";
    if (index === 0) return text;
    return `${result}${needsTtmlDisplaySpaceBefore(syllables, index, providerLanguage, source) ? " " : ""}${text}`;
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
  const revision = isLyricRevision(lyrics.LyricRevision) ? lyrics.LyricRevision : undefined;
  const providerId = revision?.providerId
    || clean(sourceDocument?.provider?.id || lyrics.fetchProvider || lyrics.source)
    || undefined;
  const sourceCandidateId = revision?.candidateId
    || clean(lyrics.SourceCandidateId)
    || undefined;

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
        ...sourceLineSemantics(sourceLines.get(id)),
        ...(sourceLines.get(id)?.providerInfoKind || providerInfoKind(line)
          ? { providerInfoKind: sourceLines.get(id)?.providerInfoKind ?? providerInfoKind(line) }
          : {}),
        ...(sourceLines.get(id)?.vocalCue || vocalCue(line)
          ? { vocalCue: sourceLines.get(id)?.vocalCue ?? vocalCue(line) }
          : {}),
        ...(sourceLines.get(id)?.vocalAgentId || vocalAgentId(line)
          ? { vocalAgentId: sourceLines.get(id)?.vocalAgentId ?? vocalAgentId(line) }
          : {}),
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
        ...sourceLineSemantics(sourceLines.get(id)),
        ...(sourceLines.get(id)?.providerInfoKind || providerInfoKind(entry)
          ? { providerInfoKind: sourceLines.get(id)?.providerInfoKind ?? providerInfoKind(entry) }
          : {}),
        ...(sourceLines.get(id)?.vocalCue || vocalCue(entry)
          ? { vocalCue: sourceLines.get(id)?.vocalCue ?? vocalCue(entry) }
          : {}),
        ...(sourceLines.get(id)?.vocalAgentId || vocalAgentId(line) || vocalAgentId(entry)
          ? { vocalAgentId: sourceLines.get(id)?.vocalAgentId ?? vocalAgentId(line) ?? vocalAgentId(entry) }
          : {}),
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
            && !isJapaneseProviderLanguage(lyrics.ProviderLanguage)
          ? readableDisplay(lead.JapaneseReading.displayText)
          : joinSyllableDisplayText(syllables, lyrics.ProviderLanguage, lyrics.source),
        readingText: syllableReading(lead, syllables),
        ...sourceLineSemantics(evidence),
        ...(evidence?.providerInfoKind || providerInfoKind(lead)
          ? { providerInfoKind: evidence?.providerInfoKind ?? providerInfoKind(lead) }
          : {}),
        ...(evidence?.vocalCue || vocalCue(lead)
          ? { vocalCue: evidence?.vocalCue ?? vocalCue(lead) }
          : {}),
        ...(evidence?.vocalAgentId || vocalAgentId(group)
          ? { vocalAgentId: evidence?.vocalAgentId ?? vocalAgentId(group) }
          : {}),
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
    ...(revision ? { lyricRevisionId: revision.id } : {}),
    ...(providerId ? { providerId } : {}),
    ...(sourceCandidateId ? { sourceCandidateId } : {}),
    lyricsType: lyrics.Type,
    language: clean(lyrics.Language) || undefined,
    languageISO2: clean(lyrics.LanguageISO2) || undefined,
    ...(sourceDocument?.providerLanguage
      ? { providerLanguage: sourceDocument.providerLanguage }
      : {}),
    ...(sourceDocument?.vocalAgents ? { vocalAgents: sourceDocument.vocalAgents } : {}),
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
