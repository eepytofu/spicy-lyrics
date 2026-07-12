import { inflateSync } from "node:zlib";
import { attachSidecars, toSyllableLyrics } from "../convert";
import { decryptQrcBytes } from "../crypto/qrc-eslyric";
import type { LyricsProvider, TimedLine } from "../types";
import { candidateScore, fetchWithTimeout, searchQueries } from "./shared";

export function decryptQrc(hex: string): string | undefined {
  try {
    const decrypted = decryptQrcBytes(hex);
    return decrypted ? inflateSync(Buffer.from(decrypted)).toString("utf8") : undefined;
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
  for (const row of value.split(/\r?\n/)) {
    const header = /^\[(\d+),(\d+)\](.*)$/.exec(row.trim()); if (!header) continue;
    const words = [...header[3].matchAll(/([^()]*)\((\d+),(\d+)\)/g)].flatMap((match) => match[1] ? [{ text: decodeEntities(match[1]), startMs: Number(match[2]), durationMs: Number(match[3]) }] : []);
    if (words.length) lines.push({ startMs: Number(header[1]), durationMs: Number(header[2]), words });
  }
  return lines;
}

function qrcSidecarAsLrc(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const qrcLines = parseQrc(value);
  if (!qrcLines.length) return value;
  return qrcLines.map((line) => {
    const minutes = Math.floor(line.startMs / 60000);
    const seconds = ((line.startMs % 60000) / 1000).toFixed(3).padStart(6, "0");
    return `[${minutes}:${seconds}]${line.words.map((word) => word.text).join("")}`;
  }).join("\n");
}

type SearchSong = { id: number; title: string; artists: string[]; album: string; durationMs?: number };

function decodeCdata(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
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
  for (const query of searchQueries(track)) {
    const body = { comm: { ct: "19", cv: "1859", uin: "0" }, req: { method: "DoSearchForQQMusicDesktop", module: "music.search.SearchCgiService", param: { grp: 1, num_per_page: 12, page_num: 1, query, search_type: 0 } } };
    const response = await fetchWithTimeout("https://u.y.qq.com/cgi-bin/musicu.fcg", { method: "POST", headers: { "Content-Type": "application/json;charset=utf-8", Referer: "https://y.qq.com/", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify(body) });
    if (!response.ok) continue;
    const json = await response.json<any>();
    for (const item of json?.req?.data?.body?.song?.list ?? []) {
      if (!item?.id || !(item.title ?? item.songname)) continue;
      found.set(Number(item.id), {
        id: Number(item.id),
        title: item.title ?? item.songname,
        artists: (item.singer ?? []).map((artist: any) => artist.name).filter(Boolean),
        album: item.album?.name ?? item.albumname ?? "",
        durationMs: Number(item.interval) ? Number(item.interval) * 1000 : undefined,
      });
    }
    if ([...found.values()].some((song) => candidateScore(track, song.title, song.artists, song.durationMs) >= 45)) break;
  }
  if (!found.size) {
    for (const song of await searchQqLegacy(track)) found.set(song.id, song);
  }
  return [...found.values()].sort((a, b) => candidateScore(track, b.title, b.artists, b.durationMs) - candidateScore(track, a.title, a.artists, a.durationMs));
}

export async function fetchQqLyric(song: SearchSong, track: Parameters<LyricsProvider>[0]): Promise<any | undefined> {
  const encode = (value: string) => Buffer.from(value, "utf8").toString("base64");
  const key = "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo";
  const body = {
    comm: { ct: "19", cv: "1873", uin: "0", tmeAppID: "qqmusic", tmeLoginType: 2 },
    [key]: { method: "GetPlayLyricInfo", module: "music.musichallSong.PlayLyricInfo", param: {
      albumName: encode(song.album || track.album), singerName: encode(song.artists.join(" / ")), songName: encode(song.title), songID: song.id,
      interval: Math.round(track.durationMs / 1000), crypt: 1, qrc: 1, trans: 1, roma: 1, lrc_t: 0, qrc_t: 0, trans_t: 0, roma_t: 0, type: -1,
    } },
  };
  const response = await fetchWithTimeout("https://u.y.qq.com/cgi-bin/musicu.fcg", { method: "POST", headers: { "Content-Type": "application/json", Referer: "https://y.qq.com", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify(body) });
  if (!response.ok) return undefined; const json = await response.json<any>(); return json?.[key]?.code === 0 ? json[key].data : undefined;
}

export const qqProvider: LyricsProvider = async (track) => {
  for (const song of await searchQq(track)) {
    if (candidateScore(track, song.title, song.artists, song.durationMs) < 45) continue;
    const data = await fetchQqLyric(song, track); const primary = qrcContent(decryptQrc(data?.lyric ?? "")); if (!primary) continue;
    const translation = qrcSidecarAsLrc(qrcContent(decryptQrc(data?.trans ?? "")));
    const romanization = qrcSidecarAsLrc(qrcContent(decryptQrc(data?.roma ?? "")));
    const result = toSyllableLyrics(attachSidecars(parseQrc(primary), translation, romanization), "qq"); if (result) return result;
  }
  return undefined;
};
