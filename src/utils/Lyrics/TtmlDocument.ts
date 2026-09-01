import { TTMLParser, type LyricLine, type Syllable, type SubLyricContent } from "@applemusic-like-lyrics/ttml";
import type { ProviderRubyTag } from "./ProviderRuby.ts";
import type { ProviderLineSemantics, ProviderSidecar } from "./TtmlSemantics.ts";
import type { VocalAgents } from "./VocalSemantics.ts";

type NativeSyllable = {
  Text: string;
  StartTime: number;
  EndTime: number;
  IsPartOfWord: boolean;
  ProviderRuby?: ProviderRubyTag[];
};

type NativeGroup = ProviderLineSemantics & {
  StartTime: number;
  EndTime: number;
  Syllables: NativeSyllable[];
  ProviderTranslatedText?: string;
  ProviderTranslationLanguage?: string;
  ProviderRomanizedText?: string;
  RomanizedText?: string;
  TransliteratedText?: string;
};

type NativeLine = ProviderLineSemantics & {
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

function toSidecar(contents: readonly SubLyricContent[] | undefined): ProviderSidecar[] | undefined {
  if (!contents?.length) return undefined;
  return contents.map((entry) => {
    const Words = entry.words?.filter((word) => word.text).map((word) => ({
      Text: word.text,
      StartTime: seconds(word.startTime),
      EndTime: seconds(word.endTime),
      IsPartOfWord: word.endsWithSpace !== true,
    }));
    return {
      Text: entry.text,
      ...(entry.language ? { Language: entry.language } : {}),
      ...(Words?.length ? { Words } : {}),
    };
  });
}

function toSyllables(words: readonly Syllable[]): NativeSyllable[] {
  return words
    .filter((word) => word.text)
    .map((word) => ({
      Text: word.text,
      StartTime: seconds(word.startTime),
      EndTime: seconds(word.endTime),
      IsPartOfWord: word.endsWithSpace !== true,
      ...(word.ruby?.length
        ? {
            ProviderRuby: word.ruby.map((tag) => ({
              Text: tag.text,
              StartTime: seconds(tag.startTime),
              EndTime: seconds(tag.endTime),
            })),
          }
        : {}),
    }));
}

function applySidecars(target: Record<string, unknown>, line: { translations?: SubLyricContent[]; romanizations?: SubLyricContent[] }): void {
  const translations = toSidecar(line.translations);
  if (translations) target.ProviderTranslations = translations;
  const translation = preferred(line.translations);
  if (translation) {
    target.ProviderTranslatedText = translation.text;
    if (translation.language) target.ProviderTranslationLanguage = translation.language;
  }
  const romanizations = toSidecar(line.romanizations);
  if (romanizations) target.ProviderRomanizations = romanizations;
  const romanization = preferred(line.romanizations);
  if (romanization) {
    target.ProviderRomanizedText = romanization.text;
    target.RomanizedText = romanization.text;
    target.TransliteratedText = romanization.text;
  }
}

function applyLineSemantics(
  target: Record<string, unknown>,
  line: LyricLine,
  syntheticLineIds: ReadonlySet<string>,
): void {
  if (line.id && !syntheticLineIds.has(line.id)) target.ProviderLineId = line.id;
  if (line.songPart) target.SongPart = line.songPart;
  if (typeof line.blockIndex === "number" && Number.isFinite(line.blockIndex)) {
    target.SongPartBlockIndex = line.blockIndex;
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

function syllableContent(
  lines: readonly LyricLine[],
  alignments: readonly boolean[],
  syntheticLineIds: ReadonlySet<string>,
): Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [];
  lines.forEach((line, index) => {
    const Lead = toGroup(line);
    if (!Lead) return;
    const entry: Record<string, unknown> = {
      Type: "Vocal",
      OppositeAligned: alignments[index],
      Lead,
    };
    applyLineSemantics(entry, line, syntheticLineIds);
    if (line.agentId) entry.VocalAgentId = line.agentId;
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

function lineContent(
  lines: readonly LyricLine[],
  alignments: readonly boolean[],
  syntheticLineIds: ReadonlySet<string>,
): NativeLine[] {
  const content: NativeLine[] = [];
  lines.forEach((line, index) => {
    const entry = toLine(line);
    if (!entry) return;
    applyLineSemantics(entry as unknown as Record<string, unknown>, line, syntheticLineIds);
    entry.OppositeAligned = alignments[index];
    if (line.agentId) entry.VocalAgentId = line.agentId;
    const background = line.backgroundVocal ? toLine(line.backgroundVocal) : undefined;
    if (background) entry.Background = [background];
    content.push(entry);
  });
  return content;
}

function staticContent(
  lines: readonly LyricLine[],
  syntheticLineIds: ReadonlySet<string>,
): Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [];
  for (const line of lines) {
    const timed = toLine(line);
    if (!timed) continue;
    const {
      Type: _type,
      StartTime: _startTime,
      EndTime: _endTime,
      OppositeAligned: _oppositeAligned,
      Background: _background,
      ...entry
    } = timed;
    applyLineSemantics(entry, line, syntheticLineIds);
    if (line.agentId) entry.VocalAgentId = line.agentId;
    content.push(entry);
  }
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

function withLineKeys(ttml: string): { source: string; syntheticLineIds: Set<string> } {
  const used = new Set(
    [...ttml.matchAll(/\situnes:key\s*=\s*(["'])(.*?)\1/giu)].map((match) => match[2]),
  );
  let index = 1;
  const syntheticLineIds = new Set<string>();
  const nextKey = (): string => {
    let key = `spicy-local-${index++}`;
    while (used.has(key)) key = `spicy-local-${index++}`;
    used.add(key);
    syntheticLineIds.add(key);
    return key;
  };
  const keyed = ttml.replace(/<p(\s[^>]*)?>/gu, (tag, attributes = "") => {
    return /\situnes:key\s*=/u.test(tag)
      ? tag
      : `<p${attributes} itunes:key="${nextKey()}">`;
  });
  return {
    source: /xmlns:itunes\s*=/u.test(keyed)
      ? keyed
      : keyed.replace(/<tt(\s|>)/u, `<tt ${ITUNES_NS}$1`),
    syntheticLineIds,
  };
}

function hasUnkeyedLines(ttml: string): boolean {
  return [...ttml.matchAll(/<p(?:\s[^>]*)?>/gu)].some((match) => !/\situnes:key\s*=/u.test(match[0]));
}

const TTM_NS = "http://www.w3.org/ns/ttml#metadata";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

function extractVocalAgents(
  ttml: string,
  domParser?: ConstructorParameters<typeof TTMLParser>[0] extends { domParser?: infer P } ? P : never,
): VocalAgents | undefined {
  const parser = domParser ?? (typeof DOMParser !== "undefined" ? new DOMParser() : undefined);
  if (!parser) return undefined;
  const document = parser.parseFromString(ttml, "application/xml");
  const agents: VocalAgents = {};
  for (const element of Array.from(document.getElementsByTagNameNS(TTM_NS, "agent"))) {
    const id = element.getAttributeNS(XML_NS, "id") || element.getAttribute("xml:id") || "";
    if (!id) continue;
    const type = element.getAttribute("type") || element.getAttributeNS(TTM_NS, "type") || undefined;
    const Names = Array.from(element.getElementsByTagNameNS(TTM_NS, "name"))
      .map((name) => name.textContent?.trim() ?? "")
      .filter(Boolean);
    agents[id] = {
      ...(type ? { Type: type } : {}),
      Names,
    };
  }
  return Object.keys(agents).length ? agents : undefined;
}

function extractAuthoredTimingMode(
  ttml: string,
  domParser?: ConstructorParameters<typeof TTMLParser>[0] extends { domParser?: infer P } ? P : never,
): string | undefined {
  const parser = domParser ?? (typeof DOMParser !== "undefined" ? new DOMParser() : undefined);
  if (!parser) return undefined;
  const document = parser.parseFromString(ttml, "application/xml");
  return document.documentElement?.getAttribute("itunes:timing") ?? undefined;
}

/**
 * Converts a TTML document into the native lyric model, or `null` when it carries no
 * usable lines. A malformed document is a rejected candidate, never a degraded one.
 */
export function parseTtmlDocument(
  ttml: string,
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

  const keyed = hasUnkeyedLines(ttml)
    ? withLineKeys(ttml)
    : { source: ttml, syntheticLineIds: new Set<string>() };
  const source = keyed.source;
  const result = read(source);
  if (!result) return null;
  const VocalAgents = extractVocalAgents(source, domParser);
  const authoredTimingMode = extractAuthoredTimingMode(source, domParser);

  const lines = result.lines ?? [];
  if (authoredTimingMode?.toLowerCase() === "none") {
    const Lines = staticContent(lines, keyed.syntheticLineIds);
    if (!Lines.length) return null;
    const includesTranslation = carries(Lines, "ProviderTranslatedText");
    const includesRomanization = carries(Lines, "ProviderRomanizedText");
    const document: Record<string, unknown> = {
      Type: "Static",
      Lines,
      IncludesTranslation: includesTranslation,
      HasProviderTranslations: includesTranslation,
      IncludesRomanization: includesRomanization,
      HasTransliterations: includesRomanization,
    };
    if (result.metadata.songwriters?.length) document.SongWriters = result.metadata.songwriters;
    if (result.metadata.language) document.ProviderLanguage = result.metadata.language;
    if (VocalAgents) document.VocalAgents = VocalAgents;
    return document;
  }

  const alignments = oppositeAlignment(lines, result.metadata.agents);
  const isLineTimed = result.metadata.timingMode === "Line"
    || lines.every((line) => !(line.words ?? []).length);
  const Content = isLineTimed
    ? lineContent(lines, alignments, keyed.syntheticLineIds)
    : syllableContent(lines, alignments, keyed.syntheticLineIds);
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
  if (result.metadata.language) document.ProviderLanguage = result.metadata.language;
  if (VocalAgents) document.VocalAgents = VocalAgents;
  return document;
}
