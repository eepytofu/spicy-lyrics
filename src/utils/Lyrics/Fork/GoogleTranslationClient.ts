import langs from "langs";
import { shouldDisplayTranslation } from "./TranslationEligibility.ts";

const TRANSLATION_CACHE_KEY = "spicy-lyrics:translationCache";
const TRANSLATION_CACHE_VERSION = 3;
const TRANSLATION_CACHE_MAX_ENTRIES = 5000;
const NO_DISPLAY_TTL_MS = 6 * 60 * 60 * 1000;
const GOOGLE_INITIAL_BACKOFF_MS = 900;
const GOOGLE_MAX_BACKOFF_MS = 8000;

export const TRANSLATION_BATCH_MAX_LINES = 100;
export const TRANSLATION_BATCH_MAX_CHARS = 4500;
export const BATCH_MARKER_PATTERN = /\[\[\s*SPX\s*_\s*(\d\s*\d\s*\d)\s*\]\]/gi;

type TranslationCacheEntry =
  | { kind: "translated"; text: string }
  | { kind: "no-display"; expiresAt: number };

type TranslationCacheEnvelope = {
  version: typeof TRANSLATION_CACHE_VERSION;
  entries: Record<string, TranslationCacheEntry>;
};

type GoogleResponse =
  | { kind: "ok"; text: string }
  | { kind: "failed" };

let translationCache: Record<string, TranslationCacheEntry> | null = null;
let cacheCount = -1;
let googleBackoffUntil = 0;
let googleBackoffMs = GOOGLE_INITIAL_BACKOFF_MS;

function getTranslationCache(): Record<string, TranslationCacheEntry> {
  if (translationCache) return translationCache;
  try {
    const raw = localStorage.getItem(TRANSLATION_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<TranslationCacheEnvelope> : null;
    translationCache = parsed?.version === TRANSLATION_CACHE_VERSION
      && parsed.entries
      && typeof parsed.entries === "object"
      ? parsed.entries
      : {};
  } catch {
    translationCache = {};
  }
  cacheCount = Object.keys(translationCache).length;
  return translationCache;
}

function persistTranslationCache(): void {
  try {
    const cache = getTranslationCache();
    if (cacheCount > TRANSLATION_CACHE_MAX_ENTRIES) {
      const keys = Object.keys(cache);
      const toRemove = keys.slice(0, keys.length - TRANSLATION_CACHE_MAX_ENTRIES);
      for (const key of toRemove) delete cache[key];
      cacheCount = TRANSLATION_CACHE_MAX_ENTRIES;
    }
    const envelope: TranslationCacheEnvelope = {
      version: TRANSLATION_CACHE_VERSION,
      entries: cache,
    };
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage is an optimization. Translation still succeeds without it.
  }
}

export function clearTranslationCache(): void {
  translationCache = {};
  cacheCount = 0;
  googleBackoffUntil = 0;
  googleBackoffMs = GOOGLE_INITIAL_BACKOFF_MS;
  try {
    localStorage.removeItem(TRANSLATION_CACHE_KEY);
  } catch {
    // Ignore unavailable or restricted storage.
  }
  console.log("[SpicyLyrics:Translation] Cache cleared");
}

function sourceLanguageCode(sourceLang: string): string {
  if (sourceLang === "und") return "auto";
  return langs.where("3", sourceLang)?.["1"] || sourceLang || "auto";
}

function translationCacheKey(
  text: string,
  sourceCode: string,
  targetLang: string,
  cacheNamespace: string,
): string {
  return JSON.stringify([cacheNamespace, sourceCode, targetLang, text]);
}

function putCacheEntry(
  cache: Record<string, TranslationCacheEntry>,
  key: string,
  entry: TranslationCacheEntry,
): void {
  if (!cache[key]) cacheCount += 1;
  cache[key] = entry;
}

function deleteCacheEntry(cache: Record<string, TranslationCacheEntry>, key: string): void {
  if (!cache[key]) return;
  delete cache[key];
  cacheCount = Math.max(0, cacheCount - 1);
}

function abortError(): DOMException {
  return new DOMException("Translation request aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForGoogleBackoff(signal?: AbortSignal): Promise<void> {
  const waitMs = Math.max(0, googleBackoffUntil - Date.now());
  if (waitMs > 0) await sleep(waitMs, signal);
}

function registerGoogleSuccess(): void {
  googleBackoffUntil = 0;
  googleBackoffMs = GOOGLE_INITIAL_BACKOFF_MS;
}

function registerGoogleFailure(): void {
  googleBackoffUntil = Date.now() + googleBackoffMs;
  googleBackoffMs = Math.min(googleBackoffMs * 2, GOOGLE_MAX_BACKOFF_MS);
}

function shouldRetryGoogle(errorOrStatus: unknown): boolean {
  if (typeof errorOrStatus === "number") return errorOrStatus === 429 || errorOrStatus >= 500;
  return !(errorOrStatus instanceof DOMException && errorOrStatus.name === "AbortError");
}

function extractGoogleTranslation(data: any): string {
  let translated = "";
  if (Array.isArray(data) && Array.isArray(data[0])) {
    for (const segment of data[0]) {
      if (segment && typeof segment[0] === "string") translated += segment[0];
    }
  }
  return translated.trim();
}

async function requestGoogleTranslation(url: string, signal?: AbortSignal): Promise<GoogleResponse> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfAborted(signal);
    await waitForGoogleBackoff(signal);
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        lastError = response.status;
        if (shouldRetryGoogle(response.status)) registerGoogleFailure();
        if (attempt === 0 && shouldRetryGoogle(response.status)) continue;
        console.warn(`[SpicyLyrics:Translation] API returned ${response.status}`);
        return { kind: "failed" };
      }
      const text = extractGoogleTranslation(await response.json());
      registerGoogleSuccess();
      return { kind: "ok", text };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      lastError = error;
      if (shouldRetryGoogle(error)) registerGoogleFailure();
      if (attempt === 0 && shouldRetryGoogle(error)) continue;
    }
  }
  console.error("[SpicyLyrics:Translation] Fetch error:", lastError);
  return { kind: "failed" };
}

function batchMarker(index: number): string {
  return `[[SPX_${String(index).padStart(3, "0")}]]`;
}

export function buildBatchQuery(lines: string[]): string {
  return lines.map((line, index) => `${batchMarker(index)} ${line}`).join("\n");
}

export function buildBatchChunks(lines: string[]): Array<{ start: number; lines: string[]; query: string }> {
  const chunks: Array<{ start: number; lines: string[]; query: string }> = [];
  let current: string[] = [];
  let currentStart = 0;
  let currentChars = 0;

  for (let index = 0; index < lines.length; index++) {
    const lineChars = lines[index].length + 14;
    if (
      current.length > 0
      && (current.length >= TRANSLATION_BATCH_MAX_LINES
        || currentChars + lineChars > TRANSLATION_BATCH_MAX_CHARS)
    ) {
      chunks.push({ start: currentStart, lines: current, query: buildBatchQuery(current) });
      current = [];
      currentStart = index;
      currentChars = 0;
    }
    current.push(lines[index]);
    currentChars += lineChars;
  }

  if (current.length > 0) {
    chunks.push({ start: currentStart, lines: current, query: buildBatchQuery(current) });
  }
  return chunks;
}

export function parseBatchTranslation(translated: string): Map<number, string> {
  const result = new Map<number, string>();
  if (!translated.trim()) return result;

  const pattern = new RegExp(BATCH_MARKER_PATTERN.source, BATCH_MARKER_PATTERN.flags);
  let current = -1;
  let textStart = -1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(translated)) !== null) {
    if (current >= 0 && textStart >= 0) {
      const value = translated.slice(textStart, match.index).trim();
      if (value) result.set(current, value);
    }
    current = Number.parseInt(match[1].replace(/\s+/g, ""), 10);
    textStart = pattern.lastIndex;
  }

  if (current >= 0 && textStart >= 0) {
    const value = translated.slice(textStart).trim();
    if (value) result.set(current, value);
  }
  return result;
}

export function stripMarkerEcho(text: string, index: number): string {
  const digits = String(index).padStart(3, "0").split("").join("\\s*");
  const markerPattern = new RegExp(`\\[\\[\\s*SPX\\s*_\\s*${digits}\\s*\\]\\]`, "gi");
  return text.replace(markerPattern, "").trim();
}

export async function batchTranslate(
  lines: string[],
  sourceLang: string,
  targetLang: string,
  options: { signal?: AbortSignal; cacheNamespace?: string } = {},
): Promise<string[]> {
  const { signal, cacheNamespace = "shared" } = options;
  const sourceCode = sourceLanguageCode(sourceLang);
  const cache = getTranslationCache();
  const results = Array.from({ length: lines.length }, () => "");
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim();
    if (!text || text === "♪") continue;

    const key = translationCacheKey(text, sourceCode, targetLang, cacheNamespace);
    const entry = cache[key];
    if (entry?.kind === "translated") {
      if (shouldDisplayTranslation(text, entry.text)) {
        results[index] = entry.text;
        continue;
      }
      deleteCacheEntry(cache, key);
    } else if (entry?.kind === "no-display") {
      if (entry.expiresAt > Date.now()) continue;
      deleteCacheEntry(cache, key);
    }

    uncachedIndices.push(index);
    uncachedTexts.push(text);
  }

  if (uncachedTexts.length === 0) {
    console.log("[SpicyLyrics:Translation] All lines served from cache");
    return results;
  }

  console.log(
    `[SpicyLyrics:Translation] Translating ${uncachedTexts.length}/${lines.length} uncached lines (${sourceCode} → ${targetLang})`,
  );

  const retryIndices: number[] = [];
  for (const batch of buildBatchChunks(uncachedTexts)) {
    throwIfAborted(signal);
    const chunkIndices = uncachedIndices.slice(batch.start, batch.start + batch.lines.length);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceCode)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(batch.query)}`;
    const response = await requestGoogleTranslation(url, signal);
    if (response.kind === "failed") {
      retryIndices.push(...chunkIndices);
      continue;
    }

    const translatedLines = parseBatchTranslation(response.text);
    for (let offset = 0; offset < chunkIndices.length; offset++) {
      const index = chunkIndices[offset];
      if (!translatedLines.has(offset)) {
        retryIndices.push(index);
        continue;
      }
      const originalText = lines[index].trim();
      const translated = stripMarkerEcho(translatedLines.get(offset) || "", offset);
      const key = translationCacheKey(originalText, sourceCode, targetLang, cacheNamespace);
      if (shouldDisplayTranslation(originalText, translated)) {
        results[index] = translated;
        putCacheEntry(cache, key, { kind: "translated", text: translated });
      } else {
        putCacheEntry(cache, key, {
          kind: "no-display",
          expiresAt: Date.now() + NO_DISPLAY_TTL_MS,
        });
      }
    }
  }

  if (retryIndices.length > 0) {
    console.warn(
      `[SpicyLyrics:Translation] Retrying ${retryIndices.length} structurally missing batch translations individually`,
    );
  }
  for (const index of retryIndices) {
    throwIfAborted(signal);
    const originalText = lines[index].trim();
    if (!originalText) continue;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceCode)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(originalText)}`;
    const response = await requestGoogleTranslation(url, signal);
    if (response.kind === "failed") continue;

    const key = translationCacheKey(originalText, sourceCode, targetLang, cacheNamespace);
    if (shouldDisplayTranslation(originalText, response.text)) {
      results[index] = response.text;
      putCacheEntry(cache, key, { kind: "translated", text: response.text });
    } else {
      putCacheEntry(cache, key, {
        kind: "no-display",
        expiresAt: Date.now() + NO_DISPLAY_TTL_MS,
      });
    }
  }

  persistTranslationCache();
  return results;
}
