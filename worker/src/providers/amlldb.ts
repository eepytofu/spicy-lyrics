import type { ProviderMatchMetadata, ProviderRequestContext, TrackMetadata } from "../types";
import { candidateScore, fetchWithTimeout, matchMetadata, readResponseJson, readResponseText, simplify } from "./shared";

type FetchLike = typeof fetch;
type SearchResult = {
  title?: string;
  titles?: string[];
  artist?: string;
  artists?: string[];
  file?: string;
};
export type AmllDbResult = { ttml: string; match: ProviderMatchMetadata };

const spotifyBaseUrl = "https://amll-ttml-db.stevexmh.net/spotify";
const searchUrl = "https://amlldb.bikonoo.com/api/search-lyrics";
const rawLyricsBaseUrl = "https://amlldb.bikonoo.com/raw-lyrics";
const headers = { Accept: "application/xml, text/xml, text/plain;q=0.9", "User-Agent": "spicy-lyrics-external-sources/1.0" };

function looksLikeTtml(value: string): boolean {
  return /^\s*(?:<\?xml[^>]*>\s*)?<tt[\s>]/i.test(value);
}

async function fetchTtml(fetchImpl: FetchLike, url: string, signal?: AbortSignal): Promise<string | undefined> {
  const response = fetchImpl === fetch
    ? await fetchWithTimeout(url, { headers, signal })
    : await fetchImpl(url, { headers, signal });
  if (!response.ok) return undefined;
  const text = await readResponseText(response);
  return looksLikeTtml(text) ? text : undefined;
}

function resultScore(track: TrackMetadata, result: SearchResult): number {
  const titles = [...new Set([result.title ?? "", ...(result.titles ?? [])].filter(Boolean))];
  const artists = [...new Set([result.artist ?? "", ...(result.artists ?? [])].filter(Boolean))];
  return Math.max(-100, ...titles.map((title) => candidateScore(track, title, artists)));
}

async function search(fetchImpl: FetchLike, track: TrackMetadata, signal?: AbortSignal): Promise<SearchResult[]> {
  const found = new Map<string, SearchResult>();
  for (const query of new Set([simplify(track.title), track.title].map((value) => value.trim()).filter(Boolean))) {
    const init: RequestInit = {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": headers["User-Agent"] },
      body: JSON.stringify({ query, type: "title" }),
      signal,
    };
    const response = fetchImpl === fetch ? await fetchWithTimeout(searchUrl, init) : await fetchImpl(searchUrl, init);
    if (!response.ok) continue;
    for (const result of await readResponseJson<SearchResult[]>(response)) {
      if (result.file) found.set(result.file, result);
    }
    if ([...found.values()].some((result) => resultScore(track, result) >= 75)) break;
  }
  return [...found.values()].sort((a, b) => resultScore(track, b) - resultScore(track, a));
}

export function createAmllDbProvider(fetchImpl: FetchLike = fetch) {
  return async (track: TrackMetadata, context: ProviderRequestContext = {}): Promise<AmllDbResult | undefined> => {
    const direct = await fetchTtml(fetchImpl, `${spotifyBaseUrl}/${encodeURIComponent(track.id)}?format=ttml`, context.signal);
    if (direct) return { ttml: direct, match: { ...matchMetadata(track, track.title, track.artists, track.durationMs, "spotify-id", track.album), confidence: 1 } };
    for (const result of await search(fetchImpl, track, context.signal)) {
      if (!result.file || resultScore(track, result) < 75) continue;
      const ttml = await fetchTtml(fetchImpl, `${rawLyricsBaseUrl}/${encodeURIComponent(result.file)}`, context.signal);
      if (ttml) {
        const titles = [...new Set([result.title ?? "", ...(result.titles ?? [])].filter(Boolean))];
        const artists = [...new Set([result.artist ?? "", ...(result.artists ?? [])].filter(Boolean))];
        const title = titles.sort((a, b) => candidateScore(track, b, artists) - candidateScore(track, a, artists))[0] ?? track.title;
        return { ttml, match: matchMetadata(track, title, artists, undefined, "title-search") };
      }
    }
    return undefined;
  };
}

export const amllDbProvider = createAmllDbProvider();
