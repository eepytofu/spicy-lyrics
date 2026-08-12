import { inflateSync } from "node:zlib";
import { toSyllableLyrics } from "../convert";
import { dedupeProviderCredits, extractByCredit } from "../credits";
import type { LyricsProvider, TimedLine } from "../types";
import { assessAndRankCandidates, assessCandidate, fetchWithTimeout, isAcceptableCandidate, isStrongCandidate, matchMetadata, normalize, readResponseJson, searchQueries, throwIfAborted, throwIfProviderRequestFailed, versionTags, type CandidateAssessment } from "./shared";
import { lyricOffset, parseLeadingTimedWords } from "./timed";

const KEY = Uint8Array.from([0x40,0x47,0x61,0x77,0x5e,0x32,0x74,0x47,0x51,0x36,0x31,0x2d,0xce,0xd2,0x6e,0x69]);

export function decryptKrc(encoded: string): string | undefined {
  try {
    const input = Buffer.from(encoded, "base64"); if (input.subarray(0, 4).toString("ascii") !== "krc1") return undefined;
    const zipped = Buffer.alloc(input.length - 4); for (let index = 4; index < input.length; index += 1) zipped[index - 4] = input[index] ^ KEY[(index - 4) % KEY.length];
    return inflateSync(zipped, { maxOutputLength: 2 * 1024 * 1024 }).toString("utf8").replace(/^\uFEFF/u, "");
  } catch { return undefined; }
}

function krcSidecarText(row: unknown): string | undefined {
  if (!Array.isArray(row)) return undefined;
  const parts = row.filter((part): part is string => typeof part === "string");
  return parts.length ? parts.join("") : undefined;
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
  const offset = lyricOffset(value);
  let timedRowIndex = 0;
  for (const row of value.split(/\r?\n/)) {
    const header = /^\[(\d+),(\d+)\](.*)$/.exec(row.trim()); if (!header) continue;
    const sidecarIndex = timedRowIndex;
    timedRowIndex += 1;
    const lineStart = Math.max(0, Number(header[1]) + offset);
    const words = parseLeadingTimedWords(header[3], /<(\d+),(\d+),(?:\d+)>/g, lineStart);
    if (words.length) {
      lines.push({
        startMs: lineStart,
        durationMs: Number(header[2]),
        words,
        translation: krcSidecarText(translations[sidecarIndex]),
        romanization: krcSidecarText(romanizations[sidecarIndex]),
      });
    }
  }
  return lines;
}

export type KugouSong = {
  hash: string;
  title: string;
  artists: string[];
  album: string;
  durationMs?: number;
  catalog: "mobile-http";
};

export type KugouCandidate = {
  id: string;
  accesskey: string;
  song: string;
  singer: string;
  duration?: number;
};

// The catalog-first, hash-bound KuGou flow is adapted from Lyricify Lyrics
// Helper (Apache-2.0), with its coverage-preserving mobile catalog and
// Spicy Lyrics-specific candidate validation. See worker/NOTICE.md and
// worker/LICENSES/Apache-2.0.txt.

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

function isKugouCandidateAssessmentCompatible(
  track: Parameters<LyricsProvider>[0],
  song: KugouSong,
  candidate: KugouCandidate,
  candidateAssessment: CandidateAssessment,
  catalogAssessment: CandidateAssessment,
): boolean {
  if (!isAcceptableCandidate(candidateAssessment)) return false;
  if (!candidateAssessment.evidence.versionConflict) return true;

  // KuGou's hash-bound lyric search often shortens a catalog title such as
  // `Song (DJ lowered-key version)` back to `Song`. Trust that omission only
  // when the selected catalog/hash is already strong and every child field
  // still corroborates it. An explicit conflicting child tag remains a veto.
  if (versionTags(candidate.song).size > 0 || !isStrongCandidate(catalogAssessment)) return false;
  const childTitle = normalize(candidate.song);
  const catalogTitle = normalize(song.title);
  const shortenedCatalogTitle = [...childTitle].length >= 3 && catalogTitle.includes(childTitle);
  return (candidateAssessment.evidence.title >= 0.7 || shortenedCatalogTitle)
    && (candidateAssessment.evidence.artists ?? 1) >= 0.85
    && (candidateAssessment.evidence.duration ?? 1) >= 0.8;
}

export function isKugouCandidateCompatible(
  track: Parameters<LyricsProvider>[0],
  song: KugouSong,
  candidate: KugouCandidate,
): boolean {
  return isKugouCandidateAssessmentCompatible(
    track,
    song,
    candidate,
    assessKugouCandidate(track, song, candidate),
    assessKugouSong(track, song),
  );
}

async function searchKugouSongsAssessed(track: Parameters<LyricsProvider>[0], signal?: AbortSignal) {
  const queries = searchQueries(track);
  const found = new Map<string, KugouSong>();
  let assessed = assessAndRankCandidates(found.values(), (song) => assessKugouSong(track, song));
  const addResults = (items: any[], catalog: KugouSong["catalog"]) => {
    const addSong = (item: any) => {
      const hash = String(item?.FileHash ?? item?.hash ?? "").trim();
      const title = String(item?.SongName ?? item?.songname ?? "").trim();
      if (!hash || !title) return;
      const singer = String(item?.SingerName ?? item?.singername ?? "");
      const durationSeconds = Number(item?.Duration ?? item?.duration);
      const key = hash.toLowerCase();
      if (found.has(key)) return;
      found.set(key, {
        hash,
        title,
        artists: kugouArtists(singer),
        album: String(item?.AlbumName ?? item?.album_name ?? "").trim(),
        durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.round(durationSeconds * 1000)
          : undefined,
        catalog,
      });
    };
    for (const item of items) {
      addSong(item);
      for (const grouped of item?.Grp ?? item?.group ?? []) addSong(grouped);
    }
  };
  const requestCatalog = async (url: URL, catalog: KugouSong["catalog"]): Promise<void> => {
    try {
      const response = await fetchWithTimeout(url.toString(), {
        headers: { Referer: "https://www.kugou.com/", "User-Agent": "Mozilla/5.0" },
        signal,
      });
      if (!response.ok) return;
      const body = await readResponseJson<any>(response);
      addResults(body?.data?.lists ?? body?.data?.info ?? [], catalog);
    } catch (error) {
      throwIfProviderRequestFailed(error, signal);
      /* try the next catalog/query */
    }
  };

  for (const keyword of queries) {
    throwIfAborted(signal);
    // Lyricify's mobile catalog exposes variants that KuGou WebFilter omits.
    // Its HTTPS hostname currently fails certificate validation, so this
    // catalog request intentionally uses the upstream HTTP endpoint. It
    // receives only the metadata query, never a Spotify ID or credential.
    const mobileUrl = new URL("http://mobilecdn.kugou.com/api/v3/search/song");
    mobileUrl.search = new URLSearchParams({
      format: "json",
      keyword,
      page: "1",
      pagesize: "20",
      showtype: "1",
    }).toString();
    await requestCatalog(mobileUrl, "mobile-http");
    assessed = assessAndRankCandidates(found.values(), (song) => assessKugouSong(track, song));
    if (assessed.some(({ assessment }) => isStrongCandidate(assessment))) break;
  }
  return assessed;
}

export async function searchKugouSongs(track: Parameters<LyricsProvider>[0], signal?: AbortSignal): Promise<KugouSong[]> {
  return (await searchKugouSongsAssessed(track, signal)).map(({ candidate }) => candidate);
}

async function searchKugouCandidatesAssessed(track: Parameters<LyricsProvider>[0], song: KugouSong, signal?: AbortSignal) {
  const url = new URL("https://lyrics.kugou.com/search");
  url.search = new URLSearchParams({
    ver: "1",
    man: "yes",
    client: "pc",
    keyword: song.title,
    duration: String(song.durationMs ?? track.durationMs),
    hash: song.hash,
  }).toString();
  const response = await fetchWithTimeout(url.toString(), {
    headers: { Referer: "https://kugou.com", "User-Agent": "Mozilla/5.0" },
    signal,
  });
  if (!response.ok) return [];
  let body: any;
  try { body = await readResponseJson<any>(response); }
  catch { return []; }
  const candidates = (body?.candidates ?? [])
    .map((candidate: any) => ({
      id: String(candidate?.id ?? ""),
      accesskey: String(candidate?.accesskey ?? ""),
      song: String(candidate?.song ?? ""),
      singer: String(candidate?.singer ?? ""),
      duration: Number(candidate?.duration) || undefined,
    }))
    .filter((candidate: KugouCandidate) => candidate.id && candidate.accesskey);
  return assessAndRankCandidates<KugouCandidate, CandidateAssessment>(
    candidates,
    (candidate) => assessKugouCandidate(track, song, candidate),
  );
}

export async function searchKugouCandidates(track: Parameters<LyricsProvider>[0], song: KugouSong, signal?: AbortSignal): Promise<KugouCandidate[]> {
  return (await searchKugouCandidatesAssessed(track, song, signal)).map(({ candidate }) => candidate);
}

export async function fetchKugouKrc(candidate: KugouCandidate, signal?: AbortSignal): Promise<string | undefined> {
  const url = new URL("https://lyrics.kugou.com/download");
  url.search = new URLSearchParams({ ver: "1", client: "pc", id: candidate.id, accesskey: candidate.accesskey, fmt: "krc", charset: "utf8" }).toString();
  const response = await fetchWithTimeout(url.toString(), {
    headers: { Referer: "https://kugou.com", "User-Agent": "Mozilla/5.0" },
    signal,
  });
  if (!response.ok) return undefined;
  let body: any;
  try { body = await readResponseJson<any>(response); }
  catch { return undefined; }
  return decryptKrc(body?.content ?? "");
}

export const kugouProvider: LyricsProvider = async (track, context = {}) => {
  for (const { candidate: song, assessment: catalogAssessment } of await searchKugouSongsAssessed(track, context.signal)) {
    throwIfAborted(context.signal);
    if (!isAcceptableCandidate(catalogAssessment)) continue;
    for (const { candidate, assessment } of await searchKugouCandidatesAssessed(track, song, context.signal)) {
      throwIfAborted(context.signal);
      if (!isKugouCandidateAssessmentCompatible(track, song, candidate, assessment, catalogAssessment)) continue;
      const raw = await fetchKugouKrc(candidate, context.signal); if (!raw) continue;
      const result = toSyllableLyrics(parseKrc(raw), "kugou");
      const ProviderCredits = dedupeProviderCredits([extractByCredit(raw, "lyrics", "kugou")]);
      if (result) return {
        ...result,
        ...(ProviderCredits.length ? { ProviderCredits } : {}),
        SourceMatch: matchMetadata(
          track,
          song.title,
          song.artists,
          song.durationMs,
          `catalog-hash-${song.catalog}`,
          song.album,
        ),
      };
    }
  }
  return undefined;
};
