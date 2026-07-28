import {
  acquireProvider,
  providerAdapters,
  type ProviderAdapterRegistry,
  type ProviderPayload,
  type WorkerProviderId,
} from "../acquisition";
import type { TrackMetadata } from "../types";

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

export function parseTrackMetadata(url: URL, id: string): TrackMetadata | undefined {
  const title = parameter(url, "title");
  const artists = url.searchParams
    .getAll("artist_name")
    .map((artist) => artist.trim())
    .filter(Boolean);
  if (!artists.length && parameter(url, "artist")) {
    artists.push(...parameter(url, "artist").split(/\s*,\s*/).filter(Boolean));
  }
  const durationSeconds = Number(parameter(url, "duration"));
  if (!title || !artists.length || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }
  return {
    id,
    title,
    artists,
    album: parameter(url, "album"),
    durationMs: Math.round(durationSeconds * 1000),
  };
}

function successfulResponse(payload: ProviderPayload): Response {
  if (payload.format === "ttml") {
    return response(payload.ttml, 200, {
      ...matchHeader(payload.match),
      "Content-Type": "application/ttml+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
  }
  return response(JSON.stringify(payload.lyrics), 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
}

export function createWorkerHandler(
  adapters: ProviderAdapterRegistry = providerAdapters,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === "OPTIONS") return response(null, 204);

    const url = new URL(request.url);
    const match = /^\/v1\/lyrics\/(amlldb|qq|kugou|netease|soda)\/([^/]+)$/.exec(
      url.pathname,
    );
    if (request.method !== "GET" || !match) return response("Not found", 404);

    const provider = match[1] as WorkerProviderId;
    let trackId: string;
    try {
      trackId = decodeURIComponent(match[2]);
    } catch {
      return response("Malformed track ID", 400);
    }

    const track = parseTrackMetadata(url, trackId);
    if (!track) {
      return response("Missing title, artist_name/artist, or duration", 400);
    }

    const outcome = await acquireProvider(
      provider,
      track,
      { signal: request.signal },
      adapters,
    );
    if (outcome.kind === "lyrics") return successfulResponse(outcome.payload);
    if (outcome.kind === "no-match") return response("Lyrics not found", 404);
    if (outcome.kind === "timeout") return response("Upstream provider timed out", 504);
    if (outcome.kind === "aborted") return response("Request aborted", 499);

    console.error(`[worker] ${provider} failed`, outcome.error);
    return response("Upstream provider failed", 502);
  };
}
