import { AES, ECB, Hex, Latin1, MD5, Utf8 } from "crypto-es";
import { attachSidecars, toLineLyrics, toSyllableLyrics } from "../convert";
import { cleanCreditName, dedupeProviderCredits, extractByCredit } from "../credits";
import type { LyricsProvider, ProviderCredit, ProviderCreditRole, TimedLine } from "../types";
import { assessCandidate, fetchWithTimeout, isAcceptableCandidate, isStrongCandidate, matchMetadata, searchQueries } from "./shared";

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
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://music.163.com", Referer: "https://music.163.com", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    body: new URLSearchParams({ params: encryptEapi(path, payload) }).toString(),
  });
  return response.ok ? response.json<T>() : undefined;
}

type Song = { id: number; name: string; artists: string[]; album: string; durationMs?: number };
function assessSong(track: Parameters<LyricsProvider>[0], song: Song) {
  return assessCandidate(track, { title: song.name, artists: song.artists, album: song.album, durationMs: song.durationMs });
}
export async function searchNetease(track: Parameters<LyricsProvider>[0]): Promise<Song[]> {
  const found = new Map<number, Song>();
  for (const keyword of searchQueries(track)) {
    const body = await eapi<any>("https://interface.music.163.com/eapi/batch", "/api/search/song/list/page", {
      keyword, needCorrect: "1", channel: "typing", offset: 0, scene: "normal", total: true, limit: 10,
    });
    for (const resource of body?.data?.resources ?? []) {
      const song = resource?.baseInfo?.simpleSongData; if (!song?.id || !song?.name) continue;
      found.set(Number(song.id), { id: Number(song.id), name: song.name, artists: (song.ar ?? []).map((artist: any) => artist.name).filter(Boolean), album: song.al?.name ?? "", durationMs: Number(song.dt) || undefined });
    }
    if ([...found.values()].some((song) => isStrongCandidate(assessSong(track, song)))) break;
  }
  return [...found.values()].sort((a, b) => assessSong(track, b).score - assessSong(track, a).score);
}

export function parseYrc(value: string): TimedLine[] {
  const lines: TimedLine[] = [];
  for (const row of value.split(/\r?\n/)) {
    const header = /^\[(\d+),(\d+)\](.*)$/.exec(row.trim()); if (!header) continue;
    const words = [...header[3].matchAll(/\((\d+),(\d+),(?:\d+)\)(.*?)(?=\(\d+,\d+,\d+\)|$)/g)].flatMap((match) => match[3] ? [{ text: match[3], startMs: Number(match[1]), durationMs: Number(match[2]) }] : []);
    if (words.length) lines.push({ startMs: Number(header[1]), durationMs: Number(header[2]), words });
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

export const neteaseProvider: LyricsProvider = async (track) => {
  for (const song of await searchNetease(track)) {
    if (!isAcceptableCandidate(assessSong(track, song))) continue;
    const body = await eapi<any>("https://interface3.music.163.com/eapi/song/lyric/v1", "/api/song/lyric/v1", {
      id: song.id, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0,
    });
    const ProviderCredits = neteaseProviderCredits(body);
    const yrc = body?.yrc?.lyric;
    if (typeof yrc === "string" && yrc.trim()) {
      const lines = attachSidecars(parseYrc(yrc), body?.ytlrc?.lyric ?? body?.tlyric?.lyric, body?.yromalrc?.lyric ?? body?.romalrc?.lyric);
      const result = toSyllableLyrics(lines, "netease");
      if (result) return { ...result, ...(ProviderCredits.length ? { ProviderCredits } : {}), SourceMatch: matchMetadata(track, song.name, song.artists, song.durationMs, "search", song.album) };
    }
    if (typeof body?.lrc?.lyric === "string") {
      const result = toLineLyrics(
        body.lrc.lyric,
        track.durationMs,
        "netease",
        body?.tlyric?.lyric,
        body?.romalrc?.lyric,
      );
      if (result) return { ...result, ...(ProviderCredits.length ? { ProviderCredits } : {}), SourceMatch: matchMetadata(track, song.name, song.artists, song.durationMs, "search", song.album) };
    }
  }
  return undefined;
};
