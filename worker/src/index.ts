import { kugouProvider } from "./providers/kugou";
import { neteaseProvider } from "./providers/netease";
import { qqProvider } from "./providers/qq";
import type { LyricsProvider, ProviderId, TrackMetadata } from "./types";

const providers: Record<ProviderId, LyricsProvider> = { qq: qqProvider, kugou: kugouProvider, netease: neteaseProvider };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function parameter(url: URL, name: string): string { return url.searchParams.get(name)?.trim() ?? ""; }
function metadata(url: URL, id: string): TrackMetadata | undefined {
  const title = parameter(url, "title");
  const artists = url.searchParams.getAll("artist_name").map((artist) => artist.trim()).filter(Boolean);
  if (!artists.length && parameter(url, "artist")) artists.push(...parameter(url, "artist").split(/\s*,\s*/).filter(Boolean));
  const durationSeconds = Number(parameter(url, "duration"));
  if (!title || !artists.length || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined;
  return { id, title, artists, album: parameter(url, "album"), durationMs: Math.round(durationSeconds * 1000) };
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url); const match = /^\/v1\/lyrics\/(amlldb|qq|kugou|netease)\/([^/]+)$/.exec(url.pathname);
    if (request.method !== "GET" || !match) return new Response("Not found", { status: 404, headers: cors });
    const provider = match[1] as ProviderId | "amlldb";
    let trackId: string;
    try { trackId = decodeURIComponent(match[2]); }
    catch { return new Response("Malformed track ID", { status: 400, headers: cors }); }
    const track = metadata(url, trackId);
    if (!track) return new Response("Missing title, artist_name/artist, or duration", { status: 400, headers: cors });
    try {
      if (provider === "amlldb") {
        const ttml = await amllDbProvider(track);
        if (!ttml) return new Response("Lyrics not found", { status: 404, headers: cors });
        return new Response(ttml, { status: 200, headers: { ...cors, "Content-Type": "application/ttml+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
      }
      const lyrics = await providers[provider](track);
      if (!lyrics) return new Response("Lyrics not found", { status: 404, headers: cors });
      return new Response(JSON.stringify(lyrics), { status: 200, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    } catch (error) {
      console.error(`[worker] ${provider} failed`, error);
      return new Response("Upstream provider failed", { status: 502, headers: cors });
    }
  },
} satisfies ExportedHandler;
import { amllDbProvider } from "./providers/amlldb";
