import {
  buildBatchChunks,
  parseBatchTranslation,
  stripMarkerEcho,
} from "./GoogleTranslationClient.ts";

const ROMANIZATION_CACHE_KEY = "spicy-lyrics:googleRomanizationCache";
const ROMANIZATION_CACHE_VERSION = 1;
const ROMANIZATION_CACHE_MAX_ENTRIES = 5000;

type RomanizationCacheEnvelope = {
  version: typeof ROMANIZATION_CACHE_VERSION;
  entries: Record<string, string>;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let romanizationCache: Record<string, string> | null = null;
let cacheCount = -1;

function getRomanizationCache(): Record<string, string> {
  if (romanizationCache) return romanizationCache;
  try {
    const raw = localStorage.getItem(ROMANIZATION_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<RomanizationCacheEnvelope> : null;
    romanizationCache = parsed?.version === ROMANIZATION_CACHE_VERSION
      && parsed.entries
      && typeof parsed.entries === "object"
      ? parsed.entries
      : {};
  } catch {
    romanizationCache = {};
  }
  cacheCount = Object.keys(romanizationCache).length;
  return romanizationCache;
}

function persistRomanizationCache(): void {
  try {
    const cache = getRomanizationCache();
    if (cacheCount > ROMANIZATION_CACHE_MAX_ENTRIES) {
      const keys = Object.keys(cache);
      const toRemove = keys.slice(0, keys.length - ROMANIZATION_CACHE_MAX_ENTRIES);
      for (const key of toRemove) delete cache[key];
      cacheCount = ROMANIZATION_CACHE_MAX_ENTRIES;
    }
    const envelope: RomanizationCacheEnvelope = {
      version: ROMANIZATION_CACHE_VERSION,
      entries: cache,
    };
    localStorage.setItem(ROMANIZATION_CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage is an optimization. Romanization still succeeds without it.
  }
}

export function clearGoogleRomanizationCache(): void {
  romanizationCache = {};
  cacheCount = 0;
  try {
    localStorage.removeItem(ROMANIZATION_CACHE_KEY);
  } catch {
    // Ignore unavailable or restricted storage.
  }
}

function putCacheEntry(cache: Record<string, string>, text: string, reading: string): void {
  if (!cache[text]) cacheCount += 1;
  cache[text] = reading;
}

function abortError(): DOMException {
  return new DOMException("Romanization request aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function extractGoogleRomanization(data: unknown): string {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return "";
  let romanized = "";
  for (const segment of data[0]) {
    if (Array.isArray(segment) && typeof segment[3] === "string") {
      romanized += segment[3];
    }
  }
  return romanized.trim();
}

async function requestGoogleRomanization(
  query: string,
  signal: AbortSignal | undefined,
  fetchImpl: FetchLike,
): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(query)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfAborted(signal);
    try {
      const response = await fetchImpl(url, { signal });
      if (!response.ok) {
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue;
        console.warn(`[SpicyLyrics:Romanization] Google API returned ${response.status}`);
        return "";
      }
      return extractGoogleRomanization(await response.json());
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (attempt === 1) {
        console.warn("[SpicyLyrics:Romanization] Google request failed", error);
      }
    }
  }
  return "";
}

export async function batchRomanizeArabicScriptPhrases(
  phrases: string[],
  options: { signal?: AbortSignal; fetchImpl?: FetchLike } = {},
): Promise<Map<string, string>> {
  const { signal, fetchImpl = fetch } = options;
  const cache = getRomanizationCache();
  const readings = new Map<string, string>();
  const uncached = Array.from(new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean)))
    .filter((phrase) => {
      const cached = cache[phrase];
      if (!cached) return true;
      readings.set(phrase, cached);
      return false;
    });

  const retry: string[] = [];
  for (const batch of buildBatchChunks(uncached)) {
    throwIfAborted(signal);
    const response = await requestGoogleRomanization(batch.query, signal, fetchImpl);
    if (!response) {
      retry.push(...batch.lines);
      continue;
    }
    const parsed = parseBatchTranslation(response);
    for (let index = 0; index < batch.lines.length; index += 1) {
      const phrase = batch.lines[index];
      const reading = stripMarkerEcho(parsed.get(index) || "", index);
      if (!reading || reading === phrase) {
        retry.push(phrase);
        continue;
      }
      readings.set(phrase, reading);
      putCacheEntry(cache, phrase, reading);
    }
  }

  for (const phrase of retry) {
    throwIfAborted(signal);
    const reading = await requestGoogleRomanization(phrase, signal, fetchImpl);
    if (!reading || reading === phrase) continue;
    readings.set(phrase, reading);
    putCacheEntry(cache, phrase, reading);
  }

  persistRomanizationCache();
  return readings;
}
