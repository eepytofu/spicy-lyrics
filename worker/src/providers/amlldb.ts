import type { TrackMetadata } from "../types";
import { candidateScore, fetchWithTimeout, simplify } from "./shared";

type FetchLike = typeof fetch;
type SearchResult = {
  title?: string;
  titles?: string[];
  artist?: string;
  artists?: string[];
  file?: string;
};

const spotifyBaseUrl = "https://amll-ttml-db.stevexmh.net/spotify";
const searchUrl = "https://amlldb.bikonoo.com/api/search-lyrics";
const rawLyricsBaseUrl = "https://amlldb.bikonoo.com/raw-lyrics";
const headers = { Accept: "application/xml, text/xml, text/plain;q=0.9", "User-Agent": "spicy-lyrics-external-sources/1.0" };

function looksLikeTtml(value: string): boolean {
  return /^\s*(?:<\?xml[^>]*>\s*)?<tt[\s>]/i.test(value);
}

async function fetchTtml(fetchImpl: FetchLike, url: string): Promise<string | undefined> {
  const response = fetchImpl === fetch
    ? await fetchWithTimeout(url, { headers })
    : await fetchImpl(url, { headers });
  if (!response.ok) return undefined;
  const text = await response.text();
  return looksLikeTtml(text) ? text : undefined;
}

function resultScore(track: TrackMetadata, result: SearchResult): number {
  const titles = [...new Set([result.title ?? "", ...(result.titles ?? [])].filter(Boolean))];
  const artists = [...new Set([result.artist ?? "", ...(result.artists ?? [])].filter(Boolean))];
  return Math.max(-100, ...titles.map((title) => candidateScore(track, title, artists)));
}

async function search(fetchImpl: FetchLike, track: TrackMetadata): Promise<SearchResult[]> {
  const found = new Map<string, SearchResult>();
  for (const query of new Set([simplify(track.title), track.title].map((value) => value.trim()).filter(Boolean))) {
    const init: RequestInit = {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": headers["User-Agent"] },
      body: JSON.stringify({ query, type: "title" }),
    };
    const response = fetchImpl === fetch ? await fetchWithTimeout(searchUrl, init) : await fetchImpl(searchUrl, init);
    if (!response.ok) continue;
    for (const result of await response.json() as SearchResult[]) {
      if (result.file) found.set(result.file, result);
    }
    if ([...found.values()].some((result) => resultScore(track, result) >= 75)) break;
  }
  return [...found.values()].sort((a, b) => resultScore(track, b) - resultScore(track, a));
}

export function createAmllDbProvider(fetchImpl: FetchLike = fetch) {
  return async (track: TrackMetadata): Promise<string | undefined> => {
    const direct = await fetchTtml(fetchImpl, `${spotifyBaseUrl}/${encodeURIComponent(track.id)}?format=ttml`);
    if (direct) return direct;
    for (const result of await search(fetchImpl, track)) {
      if (!result.file || resultScore(track, result) < 75) continue;
      const ttml = await fetchTtml(fetchImpl, `${rawLyricsBaseUrl}/${encodeURIComponent(result.file)}`);
      if (ttml) return ttml;
    }
    return undefined;
  };
}

export const amllDbProvider = createAmllDbProvider();
