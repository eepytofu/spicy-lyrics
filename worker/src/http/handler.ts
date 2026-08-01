import {
  acquireProvider,
  providerAdapters,
  type ProviderAdapterRegistry,
  type ProviderPayload,
  type WorkerProviderId,
} from "../acquisition";
import type { TrackMetadata } from "../types";

const WORKER_REQUEST_VERSION = "10";
const MAX_REQUEST_URL_LENGTH = 8192;
const MAX_TRACK_ID_LENGTH = 256;
const MAX_TITLE_LENGTH = 512;
const MAX_ALBUM_LENGTH = 512;
const MAX_ARTIST_LENGTH = 256;
const MAX_ARTISTS = 20;
const MAX_DURATION_SECONDS = 24 * 60 * 60;
const MAX_SUCCESS_BODY_BYTES = 2 * 1024 * 1024;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Spicy-Lyrics-Match",
  "Access-Control-Max-Age": "86400",
};

function response(
  body: BodyInit | null,
  status: number,
  headers: HeadersInit = {},
): Response {
  return new Response(body, {
    status,
    headers: { ...cors, "Cache-Control": "no-store", ...headers },
  });
}

function matchHeader(match: unknown): Record<string, string> {
  return match
    ? { "X-Spicy-Lyrics-Match": encodeURIComponent(JSON.stringify(match)) }
    : {};
}

function parameter(url: URL, name: string): string {
  return url.searchParams.get(name)?.trim() ?? "";
}

function hasBoundedLength(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum;
}

export function parseTrackMetadata(url: URL, id: string): TrackMetadata | undefined {
  const title = parameter(url, "title");
  const artists = url.searchParams
    .getAll("artist_name")
    .map((artist) => artist.trim())
    .filter(Boolean);
  const durationSeconds = Number(parameter(url, "duration"));
  const album = parameter(url, "album");
  if (
    !hasBoundedLength(id, MAX_TRACK_ID_LENGTH)
    || !hasBoundedLength(title, MAX_TITLE_LENGTH)
    || !artists.length
    || artists.length > MAX_ARTISTS
    || artists.some((artist) => !hasBoundedLength(artist, MAX_ARTIST_LENGTH))
    || album.length > MAX_ALBUM_LENGTH
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
    || durationSeconds > MAX_DURATION_SECONDS
  ) {
    return undefined;
  }
  return {
    id,
    title,
    artists,
    album,
    durationMs: Math.round(durationSeconds * 1000),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidNativeLyrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!(["Static", "Line", "Syllable"] as unknown[]).includes(value.Type)) return false;
  if (!(["qq", "kugou", "netease", "soda"] as unknown[]).includes(value.source)) return false;
  if (value.fetchProvider !== value.source || typeof value.sourceDisplayName !== "string") return false;
  if (value.Type === "Static") {
    return Array.isArray(value.Lines)
      && value.Lines.length <= 10_000
      && value.Lines.every((line) => isRecord(line) && typeof line.Text === "string");
  }
  if (!Array.isArray(value.Content) || value.Content.length > 10_000) return false;
  const finiteNumber = (entry: unknown) => typeof entry === "number" && Number.isFinite(entry);
  if (value.Type === "Line") {
    return value.Content.every((line) => isRecord(line)
      && typeof line.Text === "string"
      && finiteNumber(line.StartTime)
      && finiteNumber(line.EndTime));
  }
  const validGroup = (group: unknown) => {
    if (!isRecord(group) || !Array.isArray(group.Syllables) || group.Syllables.length > 20_000) return false;
    return finiteNumber(group.StartTime)
      && finiteNumber(group.EndTime)
      && group.Syllables.every((syllable) => isRecord(syllable)
        && typeof syllable.Text === "string"
        && finiteNumber(syllable.StartTime)
        && finiteNumber(syllable.EndTime)
        && typeof syllable.IsPartOfWord === "boolean");
  };
  return value.Content.every((line) => isRecord(line)
    && validGroup(line.Lead)
    && (line.Background === undefined
      || (Array.isArray(line.Background) && line.Background.every(validGroup))));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function successfulResponse(payload: ProviderPayload): Response {
  if (payload.format === "ttml") {
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<tt[\s>]/iu.test(payload.ttml) || byteLength(payload.ttml) > MAX_SUCCESS_BODY_BYTES) {
      throw new TypeError("Invalid TTML provider payload");
    }
    return response(payload.ttml, 200, {
      ...matchHeader(payload.match),
      "Content-Type": "application/ttml+xml; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Cloudflare-CDN-Cache-Control": "public, max-age=3600, stale-if-error=86400",
      "Cache-Tag": `spicy-lyrics-v${WORKER_REQUEST_VERSION}`,
    });
  }
  if (!isValidNativeLyrics(payload.lyrics)) throw new TypeError("Invalid native provider payload");
  const body = JSON.stringify(payload.lyrics);
  if (byteLength(body) > MAX_SUCCESS_BODY_BYTES) throw new TypeError("Provider payload is too large");
  return response(body, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Cloudflare-CDN-Cache-Control": "public, max-age=3600, stale-if-error=86400",
    "Cache-Tag": `spicy-lyrics-v${WORKER_REQUEST_VERSION}`,
  });
}

function errorCategory(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid-json";
  if (error instanceof TypeError) return "invalid-payload";
  return "provider-error";
}

export function createWorkerHandler(
  adapters: ProviderAdapterRegistry = providerAdapters,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === "OPTIONS") return response(null, 204);

    if (request.url.length > MAX_REQUEST_URL_LENGTH) return response("Request URI too long", 414);

    const url = new URL(request.url);
    const match = /^\/v1\/lyrics\/(amlldb|qq|kugou|netease|soda)\/([^/]+)$/.exec(
      url.pathname,
    );
    if (request.method !== "GET" || !match) return response("Not found", 404);

    if (parameter(url, "request_version") !== WORKER_REQUEST_VERSION) {
      return response("Unsupported request version", 426);
    }

    const provider = match[1] as WorkerProviderId;
    let trackId: string;
    try {
      trackId = decodeURIComponent(match[2]);
    } catch {
      return response("Malformed track ID", 400);
    }

    const track = parseTrackMetadata(url, trackId);
    if (!track) {
      return response("Missing title, artist_name, or duration", 400);
    }

    const outcome = await acquireProvider(
      provider,
      track,
      { signal: request.signal },
      adapters,
    );
    if (outcome.kind === "lyrics") {
      try {
        return successfulResponse(outcome.payload);
      } catch (error) {
        console.error("[worker] invalid provider response", {
          provider,
          category: errorCategory(error),
        });
        return response("Invalid upstream provider response", 502);
      }
    }
    if (outcome.kind === "no-match") return response("Lyrics not found", 404);
    if (outcome.kind === "timeout") return response("Upstream provider timed out", 504);
    if (outcome.kind === "aborted") return response("Request aborted", 499);
    if (outcome.kind === "rate-limited") {
      return response(
        "Upstream provider rate limited",
        429,
        outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : {},
      );
    }
    if (outcome.kind === "upstream-error") return response("Upstream provider failed", 502);

    console.error("[worker] provider request failed", {
      provider,
      category: errorCategory(outcome.error),
    });
    return response("Upstream provider failed", 502);
  };
}
