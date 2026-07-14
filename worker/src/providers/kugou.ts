import { inflateSync } from "node:zlib";
import { toSyllableLyrics } from "../convert";
import { dedupeProviderCredits, extractByCredit } from "../credits";
import type { LyricsProvider, TimedLine } from "../types";
import { candidateScore, fetchWithTimeout, matchMetadata, searchQueries } from "./shared";

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

type Candidate = { id: string; accesskey: string; song: string; singer: string; duration?: number };
async function candidates(track: Parameters<LyricsProvider>[0]): Promise<Candidate[]> {
  const queries = searchQueries(track);
  const found = new Map<string, Candidate>();
  for (const keyword of queries) {
    const url = new URL("https://lyrics.kugou.com/search"); url.search = new URLSearchParams({ ver: "1", man: "yes", client: "pc", keyword, duration: String(track.durationMs) }).toString();
    const response = await fetchWithTimeout(url.toString(), { headers: { Referer: "https://kugou.com", "User-Agent": "Mozilla/5.0" } }); if (!response.ok) continue;
    const body = await response.json<any>(); for (const item of body?.candidates ?? []) found.set(String(item.id), item);
    if (found.size) break;
  }
  return [...found.values()].sort((a, b) => candidateScore(track, b.song, [b.singer], b.duration) - candidateScore(track, a.song, [a.singer], a.duration));
}

export const kugouProvider: LyricsProvider = async (track) => {
  for (const candidate of await candidates(track)) {
    if (candidateScore(track, candidate.song, [candidate.singer], candidate.duration) < 40) continue;
    const url = new URL("https://lyrics.kugou.com/download"); url.search = new URLSearchParams({ ver: "1", client: "pc", id: candidate.id, accesskey: candidate.accesskey, fmt: "krc", charset: "utf8" }).toString();
    const response = await fetchWithTimeout(url.toString(), { headers: { Referer: "https://kugou.com", "User-Agent": "Mozilla/5.0" } }); if (!response.ok) continue;
    const body = await response.json<any>(); const raw = decryptKrc(body?.content ?? ""); if (!raw) continue;
    const result = toSyllableLyrics(parseKrc(raw), "kugou");
    const ProviderCredits = dedupeProviderCredits([extractByCredit(raw, "lyrics", "kugou")]);
    if (result) return { ...result, ...(ProviderCredits.length ? { ProviderCredits } : {}), SourceMatch: matchMetadata(track, candidate.song, [candidate.singer], candidate.duration, "search") };
  }
  return undefined;
};
