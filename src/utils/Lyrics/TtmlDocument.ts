import { TTMLParser, type LyricLine, type Syllable, type SubLyricContent } from "@applemusic-like-lyrics/ttml";

/**
 * Replaces the remote `parseTTML` operation. The field contract mirrors
 * `worker/src/convert.ts` so every provider reaches processing in one shape.
 *
 * @fork-feature Local TTML parsing
 */

type NativeSyllable = {
  Text: string;
  StartTime: number;
  EndTime: number;
  IsPartOfWord: boolean;
};

type NativeGroup = {
  StartTime: number;
  EndTime: number;
  Syllables: NativeSyllable[];
  ProviderTranslatedText?: string;
  ProviderTranslationLanguage?: string;
  ProviderRomanizedText?: string;
  RomanizedText?: string;
  TransliteratedText?: string;
};

type NativeLine = {
  Type: "Vocal";
  Text: string;
  StartTime: number;
  EndTime: number;
  OppositeAligned?: boolean;
  Background?: NativeLine[];
  ProviderTranslatedText?: string;
  ProviderTranslationLanguage?: string;
  ProviderRomanizedText?: string;
  RomanizedText?: string;
  TransliteratedText?: string;
};

const seconds = (ms: number): number => ms / 1000;

function preferred(contents: readonly SubLyricContent[] | undefined): SubLyricContent | undefined {
  return contents?.find((entry) => entry.text.trim()) ?? undefined;
}

/** Ruby `text` is the written base, so it stays; its readings need an owner in `Processing/Japanese/`. */
function toSyllables(words: readonly Syllable[]): NativeSyllable[] {
  return words
    .filter((word) => word.text)
    .map((word) => ({
      Text: word.text,
      StartTime: seconds(word.startTime),
      EndTime: seconds(word.endTime),
      IsPartOfWord: word.endsWithSpace !== true,
    }));
}

function applySidecars(target: Record<string, unknown>, line: { translations?: SubLyricContent[]; romanizations?: SubLyricContent[] }): void {
  const translation = preferred(line.translations);
  if (translation) {
    target.ProviderTranslatedText = translation.text;
    if (translation.language) target.ProviderTranslationLanguage = translation.language;
  }
  const romanization = preferred(line.romanizations);
  if (romanization) {
    target.ProviderRomanizedText = romanization.text;
    target.RomanizedText = romanization.text;
    target.TransliteratedText = romanization.text;
  }
}

function toGroup(line: LyricLine | NonNullable<LyricLine["backgroundVocal"]>): NativeGroup | undefined {
  const Syllables = toSyllables(line.words ?? []);
  if (!Syllables.length) return undefined;
  const group: NativeGroup = {
    StartTime: seconds(line.startTime),
    EndTime: seconds(line.endTime),
    Syllables,
  };
  applySidecars(group as Record<string, unknown>, line);
  return group;
}

function oppositeAlignment(lines: readonly LyricLine[], agents: Record<string, { type?: string }> | undefined): boolean[] {
  let previousPerson: string | undefined;
  let previousOpposite = false;
  return lines.map((line) => {
    const agentId = line.agentId || "v1";
    const agentType = agents?.[agentId]?.type;
    if (agentType === "group") return false;
    if (previousPerson === undefined) {
      previousPerson = agentId;
      previousOpposite = agentType === "other";
    } else if (previousPerson !== agentId) {
      previousPerson = agentId;
      previousOpposite = !previousOpposite;
    }
    return previousOpposite;
  });
}

function syllableContent(lines: readonly LyricLine[], alignments: readonly boolean[]): Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [];
  lines.forEach((line, index) => {
    const Lead = toGroup(line);
    if (!Lead) return;
    const entry: Record<string, unknown> = {
      Type: "Vocal",
      OppositeAligned: alignments[index],
      Lead,
    };
    const background = line.backgroundVocal ? toGroup(line.backgroundVocal) : undefined;
    if (background) entry.Background = [background];
    content.push(entry);
  });
  return content;
}

function toLine(line: LyricLine | NonNullable<LyricLine["backgroundVocal"]>): NativeLine | undefined {
  const Text = line.text?.trim() ? line.text : (line.words ?? []).map((word) => word.text).join("");
  if (!Text.trim()) return undefined;
  const entry: NativeLine = {
    Type: "Vocal",
    Text,
    StartTime: seconds(line.startTime),
    EndTime: seconds(line.endTime),
  };
  applySidecars(entry as unknown as Record<string, unknown>, line);
  return entry;
}

function lineContent(lines: readonly LyricLine[], alignments: readonly boolean[]): NativeLine[] {
  const content: NativeLine[] = [];
  lines.forEach((line, index) => {
    const entry = toLine(line);
    if (!entry) return;
    entry.OppositeAligned = alignments[index];
    const background = line.backgroundVocal ? toLine(line.backgroundVocal) : undefined;
    if (background) entry.Background = [background];
    content.push(entry);
  });
  return content;
}

/** Syllable entries carry their window on `Lead`; line entries carry it directly. */
function entryTime(entry: Record<string, unknown>, edge: "StartTime" | "EndTime"): number {
  const lead = entry.Lead as NativeGroup | undefined;
  return (lead ? lead[edge] : entry[edge]) as number;
}

function carries(entries: Record<string, unknown>[], field: string): boolean {
  return entries.some((entry) => field in entry || field in ((entry.Lead ?? {}) as object));
}

const ITUNES_NS = 'xmlns:itunes="http://music.apple.com/lyric-ttml-internal"';

function withLineKeys(ttml: string): string {
  const used = new Set(
    [...ttml.matchAll(/\situnes:key\s*=\s*(["'])(.*?)\1/giu)].map((match) => match[2]),
  );
  let index = 1;
  const nextKey = (): string => {
    let key = `spicy-local-${index++}`;
    while (used.has(key)) key = `spicy-local-${index++}`;
    used.add(key);
    return key;
  };
  const keyed = ttml.replace(/<p(\s[^>]*)?>/gu, (tag, attributes = "") => {
    return /\situnes:key\s*=/u.test(tag)
      ? tag
      : `<p${attributes} itunes:key="${nextKey()}">`;
  });
  return /xmlns:itunes\s*=/u.test(keyed) ? keyed : keyed.replace(/<tt(\s|>)/u, `<tt ${ITUNES_NS}$1`);
}

function hasUnkeyedLines(ttml: string): boolean {
  return [...ttml.matchAll(/<p(?:\s[^>]*)?>/gu)].some((match) => !/\situnes:key\s*=/u.test(match[0]));
}

/**
 * Converts a TTML document into the native lyric model, or `null` when it carries no
 * usable lines. A malformed document is a rejected candidate, never a degraded one.
 */
export function parseTtmlDocument(
  ttml: string,
  // The browser supplies DOMParser; tests inject one because Node has none.
  domParser?: ConstructorParameters<typeof TTMLParser>[0] extends { domParser?: infer P } ? P : never
): Record<string, unknown> | null {
  const parser = new TTMLParser(domParser ? { domParser } : undefined);
  const read = (source: string) => {
    try {
      return parser.parse(source);
    } catch {
      return undefined;
    }
  };

  const result = read(hasUnkeyedLines(ttml) ? withLineKeys(ttml) : ttml);
  if (!result) return null;

  const lines = result.lines ?? [];
  const alignments = oppositeAlignment(lines, result.metadata.agents);
  const isLineTimed = result.metadata.timingMode === "Line"
    || lines.every((line) => !(line.words ?? []).length);
  const Content = isLineTimed
    ? lineContent(lines, alignments)
    : syllableContent(lines, alignments);
  if (!Content.length) return null;

  const includesTranslation = carries(Content, "ProviderTranslatedText");
  const includesRomanization = carries(Content, "ProviderRomanizedText");

  const document: Record<string, unknown> = {
    Type: isLineTimed ? "Line" : "Syllable",
    StartTime: entryTime(Content[0], "StartTime"),
    EndTime: entryTime(Content[Content.length - 1], "EndTime"),
    Content,
    IncludesTranslation: includesTranslation,
    HasProviderTranslations: includesTranslation,
    IncludesRomanization: includesRomanization,
    HasTransliterations: includesRomanization,
  };
  if (result.metadata.songwriters?.length) document.SongWriters = result.metadata.songwriters;
  return document;
}
