import { AES, ECB, Hex, Latin1, MD5, Utf8 } from "crypto-es";
import { attachSidecars, toLineLyrics, toSyllableLyrics } from "../convert";
import { cleanCreditName, dedupeProviderCredits, extractByCredit } from "../credits";
import type { LyricsProvider, ProviderCredit, ProviderCreditRole, TimedLine } from "../types";
import { assessCandidate, fetchWithTimeout, isAcceptableCandidate, isStrongCandidate, matchMetadata, searchQueries } from "./shared";
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

async function eapi<T>(endpoint: string, path: string, payload: unknown): Promise<T | undefined> {
  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://music.163.com", Referer: "https://music.163.com", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      body: new URLSearchParams({ params: encryptEapi(path, payload) }).toString(),
    });
    return response.ok ? await response.json<T>() : undefined;
  } catch {
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
    if (song && !found.has(song.id)) found.set(song.id, song);
  }
}

export async function searchNetease(track: Parameters<LyricsProvider>[0]): Promise<Song[]> {
  const found = new Map<number, Song>();
  for (const keyword of searchQueries(track)) {
    const batch = await eapi<any>("https://interface.music.163.com/eapi/batch", "/api/search/song/list/page", {
      keyword, needCorrect: "1", channel: "typing", offset: 0, scene: "normal", total: true, limit: 10,
    });
    addNeteaseSongs(
      found,
      (batch?.data?.resources ?? []).map((resource: any) => resource?.baseInfo?.simpleSongData).filter(Boolean),
      "batch-search",
    );
    if (![...found.values()].some((song) => isStrongCandidate(assessSong(track, song)))) {
      // Lyricify's newer search path exposes 30 results and works outside
      // mainland China. Keep the newer Spicy batch route primary, then merge
      // this HTTPS catalog only when the primary has not found a strong match.
      const cloud = await eapi<any>("https://interface.music.163.com/eapi/cloudsearch/pc", "/api/cloudsearch/pc", {
        s: keyword, type: "1", limit: "30", offset: "0", total: "true",
      });
      addNeteaseSongs(found, cloud?.result?.songs ?? [], "cloud-search");
    }
    if ([...found.values()].some((song) => isStrongCandidate(assessSong(track, song)))) break;
  }
  return [...found.values()].sort((a, b) => assessSong(track, b).score - assessSong(track, a).score);
}

export function parseYrc(value: string): TimedLine[] {
  const lines: TimedLine[] = [];
  const offset = lyricOffset(value);
  for (const row of value.split(/\r?\n/)) {
    const header = /^\[(\d+),(\d+)\](.*)$/.exec(row.trim()); if (!header) continue;
    const words = parseLeadingTimedWords(header[3], /\((\d+),(\d+),(?:\d+)\)/g, offset);
    if (words.length) lines.push({
      startMs: Math.max(0, Number(header[1]) + offset),
      durationMs: Number(header[2]),
      words,
    });
  }
  return lines;
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

async function fetchLegacyNeteaseLyrics(songId: number): Promise<any | undefined> {
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
    });
    if (!response.ok) return undefined;
    const body = await response.json<any>();
    return body?.code === 200 ? body : undefined;
  } catch {
    return undefined;
  }
}

function hasNeteaseLyrics(body: any): boolean {
  return [body?.yrc?.lyric, body?.lrc?.lyric].some((value) => typeof value === "string" && value.trim());
}

export const neteaseProvider: LyricsProvider = async (track) => {
  for (const song of await searchNetease(track)) {
    if (!isAcceptableCandidate(assessSong(track, song))) continue;
    let lyricMethod = "eapi-lyric";
    let body = await eapi<any>("https://interface3.music.163.com/eapi/song/lyric/v1", "/api/song/lyric/v1", {
      id: song.id, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0,
    });
    if (!hasNeteaseLyrics(body)) {
      body = await fetchLegacyNeteaseLyrics(song.id);
      lyricMethod = "public-lrc-fallback";
    }
    const ProviderCredits = neteaseProviderCredits(body);
    const yrc = body?.yrc?.lyric;
    if (typeof yrc === "string" && yrc.trim()) {
      const lines = attachSidecars(parseYrc(yrc), body?.ytlrc?.lyric ?? body?.tlyric?.lyric, body?.yromalrc?.lyric ?? body?.romalrc?.lyric);
      const result = toSyllableLyrics(lines, "netease");
      if (result) return {
        ...result,
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
      const result = toLineLyrics(
        body.lrc.lyric,
        song.durationMs ?? track.durationMs,
        "netease",
        body?.tlyric?.lyric,
        body?.romalrc?.lyric,
      );
      if (result) return {
        ...result,
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
