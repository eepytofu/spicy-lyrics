import { inflateSync } from "node:zlib";
import { attachSidecars, attachTimedSidecars, toSyllableLyrics } from "../convert";
import { decryptQrcBytes } from "../crypto/qrc-eslyric";
import { dedupeProviderCredits, extractByCredit } from "../credits";
import type { LyricsProvider, TimedLine } from "../types";
import { assessCandidate, fetchWithTimeout, isAcceptableCandidate, isStrongCandidate, matchMetadata, searchQueries, simplify } from "./shared";
import { lyricOffset, parseTrailingTimedWords } from "./timed";

export function decryptQrc(hex: string): string | undefined {
  try {
    const decrypted = decryptQrcBytes(hex);
    return decrypted ? inflateSync(Buffer.from(decrypted)).toString("utf8").replace(/^\uFEFF/u, "") : undefined;
  } catch { return undefined; }
}

function decodeEntities(value: string): string {
  let result = value;
  for (let pass = 0; pass < 2; pass += 1) result = result.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return result;
}

export function qrcContent(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.includes("<QrcInfos")) return value;
  // QQ may include quote characters in the lyric attribute. ESLyric deliberately
  // captures greedily so the final quote that closes LyricContent wins.
  const match = /\bLyricContent\s*=\s*"([\s\S]*)"\s*\/?>/i.exec(value);
  return match?.[1] ? decodeEntities(match[1]) : undefined;
}

export function parseQrc(value: string): TimedLine[] {
  const lines: TimedLine[] = [];
  const offset = lyricOffset(value);
  for (const row of value.split(/\r?\n/)) {
    const header = /^\[(\d+),(\d+)\](.*)$/.exec(row.trim()); if (!header) continue;
    // Only a complete numeric tuple is syntax. Literal parentheses and other
    // punctuation remain in the text slice before that tuple.
    const words = parseTrailingTimedWords(header[3], /\((\d+),(\d+)\)/g, offset, decodeEntities);
    if (words.length) lines.push({
      startMs: Math.max(0, Number(header[1]) + offset),
      durationMs: Number(header[2]),
      words,
    });
  }
  return lines;
}

function attachQqSidecars(lines: TimedLine[], translation?: string, romanization?: string): TimedLine[] {
  const translationLines = translation ? parseQrc(translation) : [];
  const romanizationLines = romanization ? parseQrc(romanization) : [];
  if (translationLines.length || romanizationLines.length) {
    return attachTimedSidecars(lines, translationLines, romanizationLines);
  }
  return attachSidecars(lines, translation, romanization);
}

type SearchSong = {
  id: number;
  title: string;
  titleAliases?: string[];
  artists: string[];
  artistAliases?: string[];
  album: string;
  durationMs?: number;
};
type QqLyricBundle = { primary?: string; translation?: string; romanization?: string };

function assessSearchSong(track: Parameters<LyricsProvider>[0], song: SearchSong) {
  return assessCandidate(track, {
    title: song.title,
    titleAliases: song.titleAliases,
    artists: song.artists,
    artistAliases: song.artistAliases,
    album: song.album,
    durationMs: song.durationMs,
  });
}

function decodeCdata(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function qqSearchQueries(track: Parameters<LyricsProvider>[0]): string[] {
  const standard = searchQueries(track);
  const artists = track.artists.map((artist) => artist.trim()).filter(Boolean).join(" ");
  const friendly = [simplify(track.title), track.title].map((title) =>
    `${title.replace(/[()[\]{}（）【】「」『』]/gu, " ")} ${artists}`.replace(/\s+/gu, " ").trim());
  return [...new Set([standard[0], ...friendly, ...standard.slice(1)].filter(Boolean))];
}

function qqSearchSong(item: any): SearchSong | undefined {
  if (!item?.id || !(item.title ?? item.songname)) return undefined;
  const title = String(item.title ?? item.songname).trim();
  const titleAliases = [...new Set([item.title, item.songname]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && value !== title))];
  const singers = Array.isArray(item.singer) ? item.singer : [];
  const artists = singers
    .map((artist: any) => String(artist?.name ?? artist?.title ?? "").trim())
    .filter(Boolean);
  const artistAliases = [...new Set<string>(singers
    .flatMap((artist: any) => [artist?.name, artist?.title])
    .map((value: unknown) => String(value ?? "").trim())
    .filter((value: string) => value && !artists.includes(value)) as string[])];
  return {
    id: Number(item.id),
    title,
    ...(titleAliases.length ? { titleAliases } : {}),
    artists,
    ...(artistAliases.length ? { artistAliases } : {}),
    album: item.album?.name ?? item.album?.title ?? item.albumname ?? "",
    durationMs: Number(item.interval) ? Number(item.interval) * 1000 : undefined,
  };
}

function addQqSearchItems(found: Map<number, SearchSong>, items: any[]): void {
  const addItem = (item: any) => {
    const song = qqSearchSong(item);
    if (song) found.set(song.id, song);
  };
  for (const item of items) {
    addItem(item);
    for (const grouped of item?.grp ?? item?.group ?? []) addItem(grouped);
  }
}

async function searchQqCatalogFallback(query: string): Promise<any[]> {
  const url = new URL("https://c.y.qq.com/soso/fcgi-bin/client_search_cp");
  url.search = new URLSearchParams({
    w: query,
    p: "1",
    n: "20",
    new_json: "1",
    cr: "1",
    format: "json",
    inCharset: "utf8",
    outCharset: "utf-8",
  }).toString();
  try {
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Referer: "https://y.qq.com/", "User-Agent": "Mozilla/5.0" },
    });
    if (!response.ok) return [];
    const json = await response.json<any>();
    return json?.code === 0 && json?.subcode === 0 ? json?.data?.song?.list ?? [] : [];
  } catch {
    return [];
  }
}

async function searchQqLegacy(track: Parameters<LyricsProvider>[0]): Promise<SearchSong[]> {
  const url = new URL("https://c.y.qq.com/lyric/fcgi-bin/fcg_search_pc_lrc.fcg");
  url.search = new URLSearchParams({ SONGNAME: track.title, SINGERNAME: track.artists[0] ?? "", TYPE: "2", RANGE_MIN: "1", RANGE_MAX: "20" }).toString();
  const response = await fetchWithTimeout(url.toString(), { headers: { Referer: "https://y.qq.com", "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) return [];
  const xml = await response.text();
  return [...xml.matchAll(/<songinfo\s+id="(\d+)"[^>]*>([\s\S]*?)<\/songinfo>/g)].map((match) => {
    const field = (name: string) => decodeCdata(new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${name}>`).exec(match[2])?.[1] ?? "");
    return { id: Number(match[1]), title: field("name"), artists: [field("singername")], album: field("albumname") };
  });
}

export async function searchQq(track: Parameters<LyricsProvider>[0]): Promise<SearchSong[]> {
  const found = new Map<number, SearchSong>();
  for (const query of qqSearchQueries(track)) {
    const body = { req_1: { method: "DoSearchForQQMusicDesktop", module: "music.search.SearchCgiService", param: { num_per_page: "20", page_num: "1", query, search_type: 0 } } };
    let response: Response | undefined;
    try {
      response = await fetchWithTimeout("https://u.y.qq.com/cgi-bin/musicu.fcg", { method: "POST", headers: { "Content-Type": "application/json;charset=utf-8", Referer: "https://c.y.qq.com/", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify(body) });
    } catch {}
    let desktopSearchUnavailable = !response?.ok;
    let json: any;
    if (response?.ok) {
      try { json = await response.json<any>(); }
      catch { desktopSearchUnavailable = true; }
    }
    if (!desktopSearchUnavailable && Number(json?.req_1?.code ?? 0) === 0) {
      addQqSearchItems(found, json?.req_1?.data?.body?.song?.list ?? []);
    } else {
      // QQ may return HTTP 200 with request code 2001 and no results. Keep the
      // Lyricify desktop flow primary, but use QQ's catalog search for that
      // query when the primary transport itself is unavailable.
      desktopSearchUnavailable = true;
    }
    if (desktopSearchUnavailable) {
      addQqSearchItems(found, await searchQqCatalogFallback(query));
    }
    if ([...found.values()].some((song) => isStrongCandidate(assessSearchSong(track, song)))) break;
  }
  if (![...found.values()].some((song) => isAcceptableCandidate(assessSearchSong(track, song)))) {
    for (const song of await searchQqLegacy(track)) found.set(song.id, song);
  }
  return [...found.values()].sort((a, b) => assessSearchSong(track, b).score - assessSearchSong(track, a).score);
}

export async function fetchQqLyric(song: SearchSong, track: Parameters<LyricsProvider>[0]): Promise<any | undefined> {
  const encode = (value: string) => Buffer.from(value, "utf8").toString("base64");
  const key = "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo";
  const body = {
    comm: { ct: "19", cv: "1873", uin: "0", tmeAppID: "qqmusic", tmeLoginType: 2 },
    [key]: { method: "GetPlayLyricInfo", module: "music.musichallSong.PlayLyricInfo", param: {
      albumName: encode(song.album || track.album), singerName: encode(song.artists.join(" / ")), songName: encode(song.title), songID: song.id,
      interval: Math.round((song.durationMs ?? track.durationMs) / 1000), crypt: 1, qrc: 1, trans: 1, roma: 1, lrc_t: 0, qrc_t: 0, trans_t: 0, roma_t: 0, type: -1,
    } },
  };
  let response: Response;
  try {
    response = await fetchWithTimeout("https://u.y.qq.com/cgi-bin/musicu.fcg", { method: "POST", headers: { "Content-Type": "application/json", Referer: "https://y.qq.com", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify(body) });
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;
  let json: any;
  try { json = await response.json<any>(); }
  catch { return undefined; }
  if (json?.code !== 0 || json?.[key]?.code !== 0) return undefined;
  const data = json[key].data;
  const returnedSongId = Number(data?.songID);
  if (Number.isFinite(returnedSongId) && returnedSongId > 0 && returnedSongId !== song.id) return undefined;
  return data;
}

function decodeQqLyricField(value: unknown): string | undefined {
  const encoded = String(value ?? "").trim();
  if (!encoded) return undefined;
  const decrypted = qrcContent(decryptQrc(encoded));
  if (decrypted?.trim()) return decrypted;
  const plain = decodeEntities(encoded);
  return /(?:^|\n)\[(?:\d+:\d+(?:\.\d+)?|\d+,\d+)\]/u.test(plain) ? plain : undefined;
}

function extractLegacyQqField(value: string, name: "content" | "contentts" | "contentroma"): string | undefined {
  const match = new RegExp(`<${name}\\b[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${name}>`, "iu").exec(value);
  const content = match?.[1] ?? match?.[2];
  return content?.trim() || undefined;
}

// The bounded lyric_download fallback and parenthetical QRC parsing are
// adapted from Lyricify Lyrics Helper (Apache-2.0). The newer QQ payload stays
// primary because it also carries native translation and romanization data.
export async function fetchQqLegacyLyrics(song: SearchSong): Promise<QqLyricBundle | undefined> {
  let response: Response;
  try {
    response = await fetchWithTimeout("https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Referer: "https://c.y.qq.com/",
        "User-Agent": "Mozilla/5.0",
      },
      body: new URLSearchParams({ version: "15", miniversion: "82", lrctype: "4", musicid: String(song.id) }),
    });
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;
  const xml = await response.text();
  const bundle = {
    primary: decodeQqLyricField(extractLegacyQqField(xml, "content")),
    translation: decodeQqLyricField(extractLegacyQqField(xml, "contentts")),
    romanization: decodeQqLyricField(extractLegacyQqField(xml, "contentroma")),
  };
  return bundle.primary || bundle.translation || bundle.romanization ? bundle : undefined;
}

function bundleFromPlayPayload(data: any): QqLyricBundle {
  return {
    primary: qrcContent(decryptQrc(data?.lyric ?? "")),
    translation: qrcContent(decryptQrc(data?.trans ?? "")),
    romanization: qrcContent(decryptQrc(data?.roma ?? "")),
  };
}

function convertQqBundle(track: Parameters<LyricsProvider>[0], song: SearchSong, bundle: QqLyricBundle, method: string) {
  if (!bundle.primary) return undefined;
  const result = toSyllableLyrics(
    attachQqSidecars(parseQrc(bundle.primary), bundle.translation, bundle.romanization),
    "qq",
  );
  const ProviderCredits = dedupeProviderCredits([
    extractByCredit(bundle.primary, "lyrics", "qq"),
    extractByCredit(bundle.translation, "translation", "qq"),
  ]);
  return result ? {
    ...result,
    ...(ProviderCredits.length ? { ProviderCredits } : {}),
    SourceMatch: matchMetadata(
      track,
      song.title,
      song.artists,
      song.durationMs,
      method,
      song.album,
      { titleAliases: song.titleAliases, artistAliases: song.artistAliases },
    ),
  } : undefined;
}

export const qqProvider: LyricsProvider = async (track) => {
  let canUseLegacyFallback = true;
  for (const song of await searchQq(track)) {
    if (!isAcceptableCandidate(assessSearchSong(track, song))) continue;
    const current = convertQqBundle(track, song, bundleFromPlayPayload(await fetchQqLyric(song, track)), "search");
    if (current) return current;
    if (canUseLegacyFallback) {
      canUseLegacyFallback = false;
      const legacyBundle = await fetchQqLegacyLyrics(song);
      const legacy = legacyBundle ? convertQqBundle(track, song, legacyBundle, "search-lyric-download") : undefined;
      if (legacy) return legacy;
    }
  }
  return undefined;
};
