import { inflateSync } from "node:zlib";
import { toSyllableLyrics } from "../convert";
import { dedupeProviderCredits, extractByCredit } from "../credits";
import type { LyricsProvider, TimedLine } from "../types";
import { assessCandidate, fetchWithTimeout, isAcceptableCandidate, isStrongCandidate, matchMetadata, searchQueries } from "./shared";

const KEY = Uint8Array.from([0x40,0x47,0x61,0x77,0x5e,0x32,0x74,0x47,0x51,0x36,0x31,0x2d,0xce,0xd2,0x6e,0x69]);

export function decryptKrc(encoded: string): string | undefined {
  try {
    const input = Buffer.from(encoded, "base64"); if (input.subarray(0, 4).toString("ascii") !== "krc1") return undefined;
    const zipped = Buffer.alloc(input.length - 4); for (let index = 4; index < input.length; index += 1) zipped[index - 4] = input[index] ^ KEY[(index - 4) % KEY.length];
    return inflateSync(zipped).toString("utf8");
  } catch { return undefined; }
}

export function parseKrc(value: string): TimedLine[] {
  const translations: string[][] = []; const romanizations: string[][] = [];
  const language = /^\[language:(.+)\]$/m.exec(value)?.[1];
  if (language) try {
    const data = JSON.parse(Buffer.from(language, "base64").toString("utf8"));
    for (const entry of data?.content ?? []) {
      if (entry.type === 1) translations.push(...(entry.lyricContent ?? []));
      if (entry.type === 0) romanizations.push(...(entry.lyricContent ?? []));
    }
  } catch { /* malformed optional sidecar */ }
  const lines: TimedLine[] = [];
  for (const row of value.split(/\r?\n/)) {
    const header = /^\[(\d+),(\d+)\](.*)$/.exec(row.trim()); if (!header) continue;
    const lineStart = Number(header[1]);
    const words = [...header[3].matchAll(/<(\d+),(\d+),(?:\d+)>(.*?)(?=<\d+,\d+,\d+>|$)/g)].flatMap((match) => match[3] ? [{ text: match[3], startMs: lineStart + Number(match[1]), durationMs: Number(match[2]) }] : []);
    if (words.length) { const index = lines.length; lines.push({ startMs: lineStart, durationMs: Number(header[2]), words, translation: translations[index]?.[0], romanization: romanizations[index]?.[0] }); }
  }
  return lines;
}

export type KugouSong = {
  hash: string;
  title: string;
  artists: string[];
  album: string;
  durationMs?: number;
};

export type KugouCandidate = {
  id: string;
  accesskey: string;
  song: string;
  singer: string;
  duration?: number;
};

// The catalog-first, hash-bound KuGou flow is adapted from Lyricify Lyrics
// Helper (Apache-2.0), with an HTTPS catalog endpoint and Spicy Lyrics-specific
// candidate validation. See worker/NOTICE.md and worker/LICENSES/Apache-2.0.txt.

function kugouArtists(value: string): string[] {
  return value.split(/\s*(?:、|,|，|\/|／)\s*/u).map((artist) => artist.trim()).filter(Boolean);
}

function assessKugouSong(track: Parameters<LyricsProvider>[0], song: KugouSong) {
  return assessCandidate(track, {
    title: song.title,
    artists: song.artists,
    album: song.album,
    durationMs: song.durationMs,
  });
}

function assessKugouCandidate(track: Parameters<LyricsProvider>[0], song: KugouSong, candidate: KugouCandidate) {
  const artists = kugouArtists(candidate.singer);
  return assessCandidate(track, {
    title: candidate.song || song.title,
    artists: artists.length ? artists : song.artists,
    album: song.album,
    durationMs: candidate.duration || song.durationMs,
  });
}

export async function searchKugouSongs(track: Parameters<LyricsProvider>[0]): Promise<KugouSong[]> {
  const queries = searchQueries(track);
  const found = new Map<string, KugouSong>();
  for (const keyword of queries) {
    const url = new URL("https://songsearch.kugou.com/song_search_v2");
    url.search = new URLSearchParams({
      keyword,
      page: "1",
      pagesize: "20",
      userid: "-1",
      clientver: "",
      platform: "WebFilter",
      filter: "2",
      iscorrection: "1",
      privilege_filter: "0",
    }).toString();
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Referer: "https://www.kugou.com/", "User-Agent": "Mozilla/5.0" },
    });
    if (!response.ok) continue;
    let body: any;
    try { body = await response.json<any>(); }
    catch { continue; }
    const addSong = (item: any) => {
      const hash = String(item?.FileHash ?? item?.hash ?? "").trim();
      const title = String(item?.SongName ?? item?.songname ?? "").trim();
      if (!hash || !title) return;
      const singer = String(item?.SingerName ?? item?.singername ?? "");
      const durationSeconds = Number(item?.Duration ?? item?.duration);
      found.set(hash.toLowerCase(), {
        hash,
        title,
        artists: kugouArtists(singer),
        album: String(item?.AlbumName ?? item?.album_name ?? "").trim(),
        durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.round(durationSeconds * 1000)
          : undefined,
      });
    };
    for (const item of body?.data?.lists ?? body?.data?.info ?? []) {
      addSong(item);
      for (const grouped of item?.Grp ?? item?.group ?? []) addSong(grouped);
    }
    if ([...found.values()].some((song) => isStrongCandidate(assessKugouSong(track, song)))) break;
  }
  return [...found.values()].sort((a, b) => assessKugouSong(track, b).score - assessKugouSong(track, a).score);
}

export async function searchKugouCandidates(track: Parameters<LyricsProvider>[0], song: KugouSong): Promise<KugouCandidate[]> {
  const url = new URL("https://lyrics.kugou.com/search");
  url.search = new URLSearchParams({
    ver: "1",
    man: "yes",
    client: "pc",
    keyword: song.title,
    duration: String(track.durationMs),
    hash: song.hash,
  }).toString();
  const response = await fetchWithTimeout(url.toString(), {
    headers: { Referer: "https://kugou.com", "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) return [];
  let body: any;
  try { body = await response.json<any>(); }
  catch { return []; }
  return (body?.candidates ?? [])
    .map((candidate: any) => ({
      id: String(candidate?.id ?? ""),
      accesskey: String(candidate?.accesskey ?? ""),
      song: String(candidate?.song ?? ""),
      singer: String(candidate?.singer ?? ""),
      duration: Number(candidate?.duration) || undefined,
    }))
    .filter((candidate: KugouCandidate) => candidate.id && candidate.accesskey)
    .sort((a: KugouCandidate, b: KugouCandidate) =>
      assessKugouCandidate(track, song, b).score - assessKugouCandidate(track, song, a).score);
}

export async function fetchKugouKrc(candidate: KugouCandidate): Promise<string | undefined> {
  const url = new URL("https://lyrics.kugou.com/download");
  url.search = new URLSearchParams({ ver: "1", client: "pc", id: candidate.id, accesskey: candidate.accesskey, fmt: "krc", charset: "utf8" }).toString();
  const response = await fetchWithTimeout(url.toString(), {
    headers: { Referer: "https://kugou.com", "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) return undefined;
  let body: any;
  try { body = await response.json<any>(); }
  catch { return undefined; }
  return decryptKrc(body?.content ?? "");
}

export const kugouProvider: LyricsProvider = async (track) => {
  for (const song of await searchKugouSongs(track)) {
    if (!isAcceptableCandidate(assessKugouSong(track, song))) continue;
    for (const candidate of await searchKugouCandidates(track, song)) {
      const candidateAssessment = assessKugouCandidate(track, song, candidate);
      if (!isAcceptableCandidate(candidateAssessment) || candidateAssessment.evidence.versionConflict) continue;
      const raw = await fetchKugouKrc(candidate); if (!raw) continue;
      const result = toSyllableLyrics(parseKrc(raw), "kugou");
      const ProviderCredits = dedupeProviderCredits([extractByCredit(raw, "lyrics", "kugou")]);
      if (result) return {
        ...result,
        ...(ProviderCredits.length ? { ProviderCredits } : {}),
        SourceMatch: matchMetadata(track, song.title, song.artists, song.durationMs, "catalog-hash", song.album),
      };
    }
  }
  return undefined;
};
