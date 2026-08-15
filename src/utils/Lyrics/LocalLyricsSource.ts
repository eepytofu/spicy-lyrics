import {
  buildLineLyrics,
  buildSyllableLyrics,
  buildStaticLyrics,
} from "./LyricsDocumentBuilders.ts";
import { parseLrcDocument } from "./LrcParser.ts";
import { parseTtmlDocument } from "./TtmlDocument.ts";

export const LOCAL_LYRICS_SCHEMA_VERSION = 1;

export type LocalLyricsFormat = "ttml" | "lrc";

export type LocalLyricsEnvelope = {
  schemaVersion: typeof LOCAL_LYRICS_SCHEMA_VERSION;
  format: LocalLyricsFormat;
  content: string;
  durationMs: number;
};

export type LocalLyricsRaw = string | LocalLyricsEnvelope;

const identity = { source: "ldb", label: "Local Lyrics" };

function duration(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function lrcLyrics(content: string, durationMs: number): any | null {
  if (!content.trim() || content.includes("\0") || /^\s*</u.test(content)) return null;
  const parsed = parseLrcDocument(content, durationMs);
  if (parsed.enhanced?.length) {
    return buildSyllableLyrics(parsed.enhanced, identity);
  }
  if (parsed.synced.length) {
    return buildLineLyrics(parsed.synced, durationMs, identity, {
      useDurationForFinalLine: true,
    });
  }
  return buildStaticLyrics(parsed.plain, identity);
}

export function parseLocalLyricsContent(
  content: string,
  durationMs = 0,
  format?: LocalLyricsFormat,
): { format: LocalLyricsFormat; lyrics: any } | null {
  if (typeof content !== "string" || !content.trim() || content.includes("\0")) return null;
  const looksLikeTtml = /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<tt(?:\s|>)/iu.test(content);
  if (format === "ttml" || (format !== "lrc" && looksLikeTtml)) {
    const ttml = parseTtmlDocument(content);
    if (ttml) return { format: "ttml", lyrics: { ...ttml, ...identity } };
    if (format === "ttml") return null;
  }
  const lrc = lrcLyrics(content, durationMs);
  return lrc ? { format: "lrc", lyrics: lrc } : null;
}

export function createLocalLyricsEnvelope(
  content: string,
  durationMs = 0,
): LocalLyricsEnvelope | null {
  const parsed = parseLocalLyricsContent(content, durationMs);
  return parsed
    ? {
        schemaVersion: LOCAL_LYRICS_SCHEMA_VERSION,
        format: parsed.format,
        content,
        durationMs: duration(durationMs),
      }
    : null;
}

export function normalizeLocalLyricsRaw(
  raw: unknown,
  fallbackDurationMs = 0,
): LocalLyricsEnvelope | null {
  const legacyContent = typeof raw === "string" ? raw : null;
  const stored = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
  const content = legacyContent ?? (typeof stored?.content === "string" ? stored.content : null);
  if (content === null) return null;
  const durationMs = duration(stored?.durationMs, duration(fallbackDurationMs));
  const parsed = parseLocalLyricsContent(content, durationMs);
  if (!parsed) return null;
  return {
    schemaVersion: LOCAL_LYRICS_SCHEMA_VERSION,
    format: parsed.format,
    content,
    durationMs,
  };
}

export function parseLocalLyricsRaw(raw: unknown, fallbackDurationMs = 0): any | null {
  const normalized = normalizeLocalLyricsRaw(raw, fallbackDurationMs);
  return normalized
    ? parseLocalLyricsContent(normalized.content, normalized.durationMs, normalized.format)?.lyrics ?? null
    : null;
}
