import { AES, ECB, Hex, Latin1, MD5, Utf8 } from "crypto-es";
import { attachSidecars, parseLrc, toLineLyricsFromRows, toStaticLyricsFromRows, toSyllableLyrics, type LineLyricsRow, type StaticLyricsRow } from "../convert";
import { cleanCreditName, dedupeProviderCredits, extractByCredit } from "../credits";
import { providerLineSemanticContext } from "../provider-info";
import type { LyricsProvider, ProviderCredit, ProviderCreditRole, TimedLine } from "../types";
import { assessAndRankCandidates, assessCandidate, fetchWithTimeout, hasInstrumentalVersionConflict, isAcceptableCandidate, isStrongCandidate, matchMetadata, readResponseJson, searchQueries, throwIfAborted, throwIfProviderRequestFailed } from "./shared";
import { lyricOffset, parseLeadingTimedWords } from "./timed";

const EAPI_KEY = Latin1.parse("e82ckenh8dichen8");

export function encryptEapi(path: string, payload: unknown): string {
  const json = JSON.stringify(payload);
  const digest = MD5(`nobody${path}use${json}md5forencrypt`).toString();
  const plain = `${path}-36cd479b6b5-${json}-36cd479b6b5-${digest}`;
  const encrypted = AES.encrypt(Utf8.parse(plain), EAPI_KEY, { mode: ECB });
  if (!encrypted.ciphertext) throw new Error("NetEase Cloud Music EAPI encryption produced no ciphertext");
  return encrypted.ciphertext.toString(Hex).toUpperCase();
}

async function eapi<T>(endpoint: string, path: string, payload: unknown, signal?: AbortSignal): Promise<T | undefined> {
  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://music.163.com", Referer: "https://music.163.com", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      body: new URLSearchParams({ params: encryptEapi(path, payload) }).toString(),
      signal,
    });
    return response.ok ? await readResponseJson<T>(response) : undefined;
  } catch (error) {
    throwIfProviderRequestFailed(error, signal);
    return undefined;
  }
}

type Song = {
  id: number;
  name: string;
  titleAliases?: string[];
  artists: string[];
  artistAliases?: string[];
  album: string;
  durationMs?: number;
  searchMethod: "batch-search" | "cloud-search";
};
function assessSong(track: Parameters<LyricsProvider>[0], song: Song) {
  return assessCandidate(track, {
    title: song.name,
    titleAliases: song.titleAliases,
    artists: song.artists,
    artistAliases: song.artistAliases,
    album: song.album,
    durationMs: song.durationMs,
  });
}

function metadataNames(...values: unknown[]): string[] {
  return [...new Set(values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
}

function neteaseSong(value: any, searchMethod: Song["searchMethod"]): Song | undefined {
  if (!value?.id || !value?.name) return undefined;
  const name = String(value.name);
  const titleAliases = metadataNames(value.tns, value.transNames, value.alia, value.alias)
    .filter((alias) => alias !== name);
  const artistValues = value.ar ?? value.artists ?? [];
  const artists = artistValues.map((artist: any) => String(artist?.name ?? "").trim()).filter(Boolean);
  const artistAliases = metadataNames(...artistValues.flatMap((artist: any) => [
    artist?.alias,
    artist?.tns,
    artist?.trans,
    artist?.transNames,
  ])).filter((alias) => !artists.includes(alias));
  return {
    id: Number(value.id),
    name,
    ...(titleAliases.length ? { titleAliases } : {}),
    artists,
    ...(artistAliases.length ? { artistAliases } : {}),
    album: String((value.al ?? value.album)?.name ?? ""),
    durationMs: Number(value.dt ?? value.duration) || undefined,
    searchMethod,
  };
}

function addNeteaseSongs(found: Map<number, Song>, values: any[], searchMethod: Song["searchMethod"]): void {
  for (const value of values) {
    const song = neteaseSong(value, searchMethod);
    if (!song) continue;
    const existing = found.get(song.id);
    if (!existing) {
      found.set(song.id, song);
      continue;
    }
    const titleAliases = metadataNames(existing.titleAliases, song.titleAliases)
      .filter((alias) => alias !== existing.name);
    const artistAliases = metadataNames(existing.artistAliases, song.artistAliases)
      .filter((alias) => !existing.artists.includes(alias));
    found.set(song.id, {
      ...existing,
      ...(titleAliases.length ? { titleAliases } : {}),
      ...(artistAliases.length ? { artistAliases } : {}),
    });
  }
}

async function searchNeteaseAssessed(track: Parameters<LyricsProvider>[0], signal?: AbortSignal) {
  const found = new Map<number, Song>();
  let assessed = assessAndRankCandidates(found.values(), (song) => assessSong(track, song));
  for (const keyword of searchQueries(track)) {
    throwIfAborted(signal);
    const batch = await eapi<any>("https://interface.music.163.com/eapi/batch", "/api/search/song/list/page", {
      keyword, needCorrect: "1", channel: "typing", offset: 0, scene: "normal", total: true, limit: 10,
    }, signal);
    addNeteaseSongs(
      found,
      (batch?.data?.resources ?? []).map((resource: any) => resource?.baseInfo?.simpleSongData).filter(Boolean),
      "batch-search",
    );
    assessed = assessAndRankCandidates(found.values(), (song) => assessSong(track, song));
    if (!assessed.some(({ assessment }) => isStrongCandidate(assessment))) {
      // Lyricify's newer search path exposes 30 results and works outside
      // mainland China. Keep the newer Spicy batch route primary, then merge
      // this HTTPS catalog only when the primary has not found a strong match.
      const cloud = await eapi<any>("https://interface.music.163.com/eapi/cloudsearch/pc", "/api/cloudsearch/pc", {
        s: keyword, type: "1", limit: "30", offset: "0", total: "true",
      }, signal);
      addNeteaseSongs(found, cloud?.result?.songs ?? [], "cloud-search");
      assessed = assessAndRankCandidates(found.values(), (song) => assessSong(track, song));
    }
    if (assessed.some(({ assessment }) => isStrongCandidate(assessment))) break;
  }
  return assessed;
}

export async function searchNetease(track: Parameters<LyricsProvider>[0], signal?: AbortSignal): Promise<Song[]> {
  return (await searchNeteaseAssessed(track, signal)).map(({ candidate }) => candidate);
}

export type ParsedNeteaseYrc = {
  lines: TimedLine[];
  songWriters: string[];
};

type ParsedYrcRow = {
  line: TimedLine;
  structured: boolean;
  writerSegments: string[];
};

function structuredYrcRow(row: string, offset: number): ParsedYrcRow | undefined {
  let value: any;
  try { value = JSON.parse(row.trim()); } catch { return undefined; }
  const startMs = Number(value?.t);
  if (!Number.isFinite(startMs) || !Array.isArray(value?.c)) return undefined;
  const segments = value.c
    .map((segment: any) => typeof segment?.tx === "string" ? segment.tx : "")
    .filter((segment: string) => segment.length > 0);
  const text = segments.join("");
  if (!text) return undefined;
  const labelIndex = segments.findIndex((segment: string) => /^作[词詞]\s*[:：]\s*$/u.test(segment));
  const writerSegments = labelIndex < 0 ? [] : segments
    .slice(labelIndex + 1)
    .map((segment: string) => segment.trim())
    .filter((segment: string) => segment && !/^[/／]$/u.test(segment));
  const adjustedStart = Math.max(0, startMs + offset);
  return {
    structured: true,
    writerSegments,
    line: {
      startMs: adjustedStart,
      durationMs: 0,
      words: [{ text, startMs: adjustedStart, durationMs: 0 }],
    },
  };
}

function parseYrcDocument(value: string, classifyStructuredInfo: boolean): ParsedNeteaseYrc {
  const rows: ParsedYrcRow[] = [];
  const offset = lyricOffset(value);
  for (const row of value.split(/\r?\n/)) {
    const structured = structuredYrcRow(row, offset);
    if (structured) {
      rows.push(structured);
      continue;
    }
    const header = /^\[(\d+),(\d+)\](.*)$/.exec(row.trim()); if (!header) continue;
    const words = parseLeadingTimedWords(header[3], /\((\d+),(\d+),(?:\d+)\)/g, offset);
    if (words.length) rows.push({
      structured: false,
      writerSegments: [],
      line: {
        startMs: Math.max(0, Number(header[1]) + offset),
        durationMs: Number(header[2]),
        words,
      },
    });
  }
  const songWriters: string[] = [];
  const lines = rows.map((row) => {
    const authoritativeInfo = classifyStructuredInfo && row.structured;
    if (!authoritativeInfo) return row.line;
    for (const writer of row.writerSegments) {
      if (!songWriters.includes(writer)) songWriters.push(writer);
    }
    return { ...row.line, providerInfoKind: "credit" as const };
  });
  return { lines, songWriters };
}

export function parseYrc(value: string): TimedLine[] {
  return parseYrcDocument(value, false).lines;
}

export function parseNeteaseYrc(value: string): ParsedNeteaseYrc {
  return parseYrcDocument(value, true);
}

export type ParsedNeteaseLrc = {
  lines: LineLyricsRow[];
  staticLines: StaticLyricsRow[];
  songWriters: string[];
};

type ParsedNeteaseLrcRow = {
  lines: LineLyricsRow[];
  structured: boolean;
  writerSegments: string[];
  plainText?: string;
};

const NETEASE_LRC_METADATA_TAG = /^\s*\[(?:ar|al|ti|by|offset|manualoffset|language|re|ve|length|id|hash|sign|qq|total)\s*:/iu;

export function parseNeteaseLrc(value: string): ParsedNeteaseLrc {
  const rows: ParsedNeteaseLrcRow[] = [];
  const offset = lyricOffset(value);
  for (const row of value.split(/\r?\n/)) {
    const structured = structuredYrcRow(row, offset);
    if (structured) {
      rows.push({
        structured: true,
        writerSegments: structured.writerSegments,
        lines: [{
          startMs: structured.line.startMs,
          text: structured.line.words.map((word) => word.text).join(""),
        }],
      });
      continue;
    }
    const lines = parseLrc(`${offset ? `[offset:${offset}]\n` : ""}${row}`);
    if (lines.length) {
      rows.push({ structured: false, writerSegments: [], lines });
      continue;
    }
    const plainText = row.trim();
    if (plainText && !NETEASE_LRC_METADATA_TAG.test(row)) {
      rows.push({ structured: false, writerSegments: [], lines: [], plainText });
    }
  }

  const songWriters: string[] = [];
  const authoritative = rows.map((row) => row.structured);
  rows.forEach((row, index) => {
    if (!authoritative[index]) return;
    for (const writer of row.writerSegments) {
      if (!songWriters.includes(writer)) songWriters.push(writer);
    }
  });
  const hasTimedOrdinary = rows.some((row) => !row.structured && row.lines.length > 0);
  const lines = hasTimedOrdinary ? rows.flatMap((row, index) => row.lines.map((line) => ({
    ...line,
    ...(authoritative[index] ? { providerInfoKind: "credit" as const } : {}),
  }))) : [];
  const staticLines = hasTimedOrdinary ? [] : rows.flatMap((row, index) => {
    const text = row.lines[0]?.text ?? row.plainText;
    return text ? [{
      text,
      ...(authoritative[index] ? { providerInfoKind: "credit" as const } : {}),
    }] : [];
  });
  return { lines, staticLines, songWriters };
}

function neteaseUserCredit(value: any, role: ProviderCreditRole): ProviderCredit | undefined {
  const name = cleanCreditName(value?.nickname);
  if (!name) return undefined;
  const rawUserId = value?.userid;
  const userId = typeof rawUserId === "number" || typeof rawUserId === "string"
    ? String(rawUserId)
    : undefined;
  return {
    role,
    name,
    provider: "netease",
    ...(userId && /^\d+$/.test(userId) ? { userId } : {}),
  };
}

export function neteaseProviderCredits(body: any): ProviderCredit[] {
  const lyricText = body?.yrc?.lyric ?? body?.lrc?.lyric;
  const translationText = body?.ytlrc?.lyric ?? body?.tlyric?.lyric;
  const romanizationText = body?.yromalrc?.lyric ?? body?.romalrc?.lyric;
  return dedupeProviderCredits([
    neteaseUserCredit(body?.lyricUser, "syncedLyrics") ?? extractByCredit(lyricText, "lyrics", "netease"),
    neteaseUserCredit(body?.transUser, "translation") ?? extractByCredit(translationText, "translation", "netease"),
    neteaseUserCredit(body?.romaUser, "romanization") ?? extractByCredit(romanizationText, "romanization", "netease"),
  ]);
}

async function fetchLegacyNeteaseLyrics(songId: number, signal?: AbortSignal): Promise<any | undefined> {
  const url = new URL("https://music.163.com/api/song/lyric");
  url.search = new URLSearchParams({
    id: String(songId),
    os: "pc",
    lv: "-1",
    kv: "-1",
    tv: "-1",
    rv: "-1",
  }).toString();
  try {
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Referer: "https://music.163.com/", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal,
    });
    if (!response.ok) return undefined;
    const body = await readResponseJson<any>(response);
    return body?.code === 200 ? body : undefined;
  } catch (error) {
    throwIfProviderRequestFailed(error, signal);
    return undefined;
  }
}

function hasNeteaseLyrics(body: any): boolean {
  return [body?.yrc?.lyric, body?.lrc?.lyric].some((value) => typeof value === "string" && value.trim());
}

export const neteaseProvider: LyricsProvider = async (track, context = {}) => {
  for (const { candidate: song, assessment } of await searchNeteaseAssessed(track, context.signal)) {
    throwIfAborted(context.signal);
    if (!isAcceptableCandidate(assessment) || hasInstrumentalVersionConflict(track.title, song.name)) continue;
    let lyricMethod = "eapi-lyric";
    let body = await eapi<any>("https://interface3.music.163.com/eapi/song/lyric/v1", "/api/song/lyric/v1", {
      id: song.id, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0,
    }, context.signal);
    if (!hasNeteaseLyrics(body)) {
      body = await fetchLegacyNeteaseLyrics(song.id, context.signal);
      lyricMethod = "public-lrc-fallback";
    }
    if (body?.pureMusic === true) continue;
    const ProviderCredits = neteaseProviderCredits(body);
    const rawPrimary = body?.yrc?.lyric ?? body?.lrc?.lyric;
    const infoContext = providerLineSemanticContext(track, {
      title: song.name,
      titleAliases: song.titleAliases,
      artists: song.artists,
      artistAliases: song.artistAliases,
    }, typeof rawPrimary === "string" ? rawPrimary : undefined);
    const yrc = body?.yrc?.lyric;
    if (typeof yrc === "string" && yrc.trim()) {
      const parsed = parseNeteaseYrc(yrc);
      const lines = attachSidecars(parsed.lines, body?.ytlrc?.lyric ?? body?.tlyric?.lyric, body?.yromalrc?.lyric ?? body?.romalrc?.lyric);
      const result = toSyllableLyrics(lines, "netease", infoContext);
      if (result) return {
        ...result,
        ...(parsed.songWriters.length ? { SongWriters: parsed.songWriters } : {}),
        ...(ProviderCredits.length ? { ProviderCredits } : {}),
        SourceMatch: matchMetadata(
          track,
          song.name,
          song.artists,
          song.durationMs,
          `${song.searchMethod}-${lyricMethod}`,
          song.album,
          { titleAliases: song.titleAliases, artistAliases: song.artistAliases },
        ),
      };
    }
    if (typeof body?.lrc?.lyric === "string") {
      const parsed = parseNeteaseLrc(body.lrc.lyric);
      const result = parsed.lines.length
        ? toLineLyricsFromRows(
          parsed.lines,
          song.durationMs ?? track.durationMs,
          "netease",
          body?.tlyric?.lyric,
          body?.romalrc?.lyric,
          infoContext,
        )
        : toStaticLyricsFromRows(parsed.staticLines, "netease", infoContext);
      if (result) return {
        ...result,
        ...(parsed.songWriters.length ? { SongWriters: parsed.songWriters } : {}),
        ...(ProviderCredits.length ? { ProviderCredits } : {}),
        SourceMatch: matchMetadata(
          track,
          song.name,
          song.artists,
          song.durationMs,
          `${song.searchMethod}-${lyricMethod}`,
          song.album,
          { titleAliases: song.titleAliases, artistAliases: song.artistAliases },
        ),
      };
    }
  }
  return undefined;
};
