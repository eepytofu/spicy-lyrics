import Platform from "../../components/Global/Platform.ts";
import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import { Query } from "../API/Query.ts";
import { SLObjPack } from "../objpack.ts";
import {
  $customLyricsServers,
  $externalLyricsWorkerUrl,
  $ignoreMusixmatchWordSync,
  $lyricsSelectionDiagnostics,
  $lyricsSelectionMode,
  $musixmatchToken,
  $prioritizeAppleMusicQuality,
} from "../stores.ts";
import { ParseTTML } from "./manager/parseTTML.ts";
import {
  getLyricsSourceDefinition,
  normalizeLyricsServerUrl,
  parseCustomLyricsServers,
  resolveLyricsSourceLabel,
  type LyricsSourceProviderId,
} from "./LyricsSourcePreferences.ts";
import {
  selectLyricsCandidate,
  type LyricsCandidate,
  type LyricsMatchMetadata,
} from "./LyricsCandidateSelector.ts";
import { externalSourceRequestUrl } from "./ExternalSourceRequest.ts";
import { normalizedDisplayText } from "./TextCompare.ts";

type TrackLyricsInfo = {
  uri: string; id: string; durationMs: number; title: string; artists: string[]; artist: string; album: string;
};
type TimedLine = { text: string; startTimeMs: number; endTimeMs?: number };
type TimedWord = { text: string; startTimeMs: number; endTimeMs: number; isPartOfWord: boolean };
type TimedWordLine = { startTimeMs: number; endTimeMs: number; words: TimedWord[] };
export type ExternalLyricsResult = { lyrics: any; status: number; match?: LyricsMatchMetadata };

const DEFAULT_MUSIXMATCH_TOKEN = "21051986b9886beabe1ce01c3ce94c96319411f8f2c122676365e3";
const MUSIXMATCH_HEADERS = { authority: "apic-desktop.musixmatch.com", cookie: "x-mxm-token-guid=" };
const packer = new SLObjPack();

function trackInfo(uri: string): TrackLyricsInfo | null {
  const id = uri.split(":")[2] ?? "";
  const currentUri = SpotifyPlayer.GetUri() ?? "";
  const currentId = SpotifyPlayer.GetId() ?? "";
  if (uri !== currentUri && id !== currentId) return null;
  const artists = SpotifyPlayer.GetArtists()?.map((entry) => entry.name).filter(Boolean) ?? [];
  const info = {
    uri, id, artists, artist: artists.join(", "), title: SpotifyPlayer.GetName() ?? "",
    album: SpotifyPlayer.GetAlbumName() ?? "", durationMs: SpotifyPlayer.GetDuration(),
  };
  return info.id && info.title && info.artist && info.durationMs > 0 ? info : null;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\r/g, "").replace(/[♪♫♬♩]+/g, " ").replace(/\s+/g, " ").trim();
}

function parsedTranslationEntries(lyrics: any): any[] {
  if (lyrics?.Type === "Static") return lyrics.Lines ?? [];
  if (lyrics?.Type === "Line") return lyrics.Content ?? [];
  if (lyrics?.Type !== "Syllable") return [];
  return (lyrics.Content ?? []).flatMap((group: any) => [
    ...(group?.Lead ? [group.Lead] : []),
    ...(group?.Background ?? []),
  ]);
}

/** Preserve TTML's authoritative translation language after the remote parser. */
function annotateTtmlTranslationLanguages(ttml: string, lyrics: any): void {
  const document = new DOMParser().parseFromString(ttml, "text/xml");
  if (document.querySelector("parsererror")) return;

  const languagesByText = new Map<string, string[]>();
  for (const span of Array.from(document.getElementsByTagNameNS("*", "span"))) {
    const role = span.getAttribute("ttm:role") ?? span.getAttribute("role");
    if (role !== "x-translation") continue;
    const key = normalizedDisplayText(span.textContent);
    const language = span.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang")
      ?? span.getAttribute("xml:lang")
      ?? span.getAttribute("lang");
    if (!key || !language) continue;
    const values = languagesByText.get(key) ?? [];
    values.push(language);
    languagesByText.set(key, values);
  }

  for (const entry of parsedTranslationEntries(lyrics)) {
    const key = normalizedDisplayText(entry?.TranslatedText);
    const languages = key ? languagesByText.get(key) : undefined;
    const language = languages?.shift();
    if (language) entry.TranslatedTextLanguage = language;
  }
}

function buildStatic(lines: string[], source: string, label: string): any | null {
  const Lines = lines.map(clean).filter(Boolean).map((Text) => ({ Text }));
  return Lines.length ? { Type: "Static", Lines, source, sourceDisplayName: label } : null;
}

function buildLine(lines: TimedLine[], durationMs: number, source: string, label: string): any | null {
  const sorted = lines.map((line) => ({ ...line, text: clean(line.text) })).filter((line) => line.text && Number.isFinite(line.startTimeMs)).sort((a, b) => a.startTimeMs - b.startTimeMs);
  if (!sorted.length) return null;
  const duration = durationMs / 1000;
  const Content = sorted.map((line, index) => {
    const start = Math.max(0, line.startTimeMs / 1000);
    const fallbackEnd = sorted[index + 1]?.startTimeMs ? sorted[index + 1].startTimeMs / 1000 : Math.max(duration, start + 4);
    return { Type: "Vocal", Text: line.text, StartTime: start, EndTime: Math.max(start, line.endTimeMs === undefined ? fallbackEnd : line.endTimeMs / 1000), OppositeAligned: false };
  });
  return { Type: "Line", StartTime: Content[0].StartTime, EndTime: Content.at(-1)?.EndTime, Content, source, sourceDisplayName: label };
}

function buildSyllable(lines: TimedWordLine[], source: string, label: string): any | null {
  const Content = lines.filter((line) => line.words.length).map((line) => ({
    Type: "Vocal", OppositeAligned: false,
    Lead: {
      StartTime: line.startTimeMs / 1000, EndTime: line.endTimeMs / 1000,
      Syllables: line.words.map((word) => ({ Text: word.text, StartTime: word.startTimeMs / 1000, EndTime: word.endTimeMs / 1000, IsPartOfWord: word.isPartOfWord })),
    },
  }));
  return Content.length ? { Type: "Syllable", StartTime: Content[0].Lead.StartTime, EndTime: Content.at(-1)?.Lead.EndTime, Content, source, sourceDisplayName: label } : null;
}

function stamp(lyrics: any, provider: LyricsSourceProviderId, displayName?: string, match?: LyricsMatchMetadata): ExternalLyricsResult | null {
  if (!lyrics || !["Static", "Line", "Syllable"].includes(lyrics.Type)) return null;
  const directMatch = ["spicy", "apple", "spotify"].includes(provider) ? { confidence: 1, method: "spotify-id" } : undefined;
  const sourceMatch = match ?? lyrics.SourceMatch ?? directMatch;
  return { lyrics: { ...lyrics, SourceMatch: sourceMatch, source: lyrics.source || provider, fetchProvider: provider, sourceDisplayName: resolveLyricsSourceLabel(lyrics.source || provider, displayName || lyrics.sourceDisplayName, provider) }, status: 200, match: sourceMatch };
}

async function spicyRaw(id: string): Promise<{ data: any | null; status: number }> {
  const token = await Platform.GetSpotifyAccessToken();
  const results = await Query([{ operation: "lyrics", variables: { id, auth: "SpicyLyrics-WebAuth" } }], { "SpicyLyrics-WebAuth": `Bearer ${token}` });
  const result = results.get("0");
  if (!result) return { data: null, status: 0 };
  if (result.httpStatus !== 200 || !result.data) return { data: null, status: result.httpStatus };
  return { data: Array.isArray(result.data) ? packer.unpack(result.data) : result.data, status: 200 };
}

async function fetchSpicy(
  id: string, expectedSource: "spl" | "aml", provider: "spicy" | "apple",
  request: ReturnType<typeof spicyRaw> = spicyRaw(id),
): Promise<ExternalLyricsResult | null> {
  try {
    const result = await request;
    if (result.status === 503) return { lyrics: null, status: 503 };
    return result.data?.source === expectedSource ? stamp(result.data, provider) : null;
  } catch (error) { console.error(`[SpicyLyrics] ${provider} failed`, error); return null; }
}

async function fetchSpotify(info: TrackLyricsInfo): Promise<ExternalLyricsResult | null> {
  try {
    const body = await Spicetify.CosmosAsync.get(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${info.id}?format=json&vocalRemoval=false&market=from_token`);
    const data = body?.lyrics; const rows = Array.isArray(data?.lines) ? data.lines : [];
    const label = data?.provider ? `Spotify (${data.provider})` : "Spotify";
    if (data?.syncType === "LINE_SYNCED") return stamp(buildLine(rows.map((row: any) => ({ text: row.words, startTimeMs: Number(row.startTimeMs) })), info.durationMs, "spotify", label), "spotify", label);
    return stamp(buildStatic(rows.map((row: any) => row.words), "spotify", label), "spotify", label);
  } catch (error) { console.error("[SpicyLyrics] Spotify lyrics failed", error); return null; }
}

function userToken(): string { return $musixmatchToken.get().trim() || DEFAULT_MUSIXMATCH_TOKEN; }
function mxmToken(body: any): string | null { return body?.message?.body?.user_token?.trim?.() || null; }

export async function refreshMusixmatchToken(persist = true): Promise<string | null> {
  try {
    const response = await Spicetify.CosmosAsync.get("https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0", null, MUSIXMATCH_HEADERS);
    const token = mxmToken(response); if (token && persist) $musixmatchToken.set(token); return token;
  } catch (error) { console.error("[SpicyLyrics] Musixmatch token refresh failed", error); return null; }
}

async function requestMxm(builder: (token: string) => string, retry = true): Promise<any> {
  const current = userToken();
  try {
    const response = await Spicetify.CosmosAsync.get(builder(current), null, MUSIXMATCH_HEADERS);
    if (response?.message?.header?.status_code === 401 && retry && await refreshMusixmatchToken()) return requestMxm(builder, false);
    return response;
  } catch (error) {
    if (retry && await refreshMusixmatchToken()) return requestMxm(builder, false);
    throw error;
  }
}

async function mxmMacro(info: TrackLyricsInfo): Promise<any | null> {
  const builder = (token: string) => "https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&namespace=lyrics_richsynched&subtitle_format=mxm&app_id=web-desktop-app-v1.0&" + [
    ["q_album", info.album], ["q_artist", info.artist], ["q_artists", info.artist], ["q_track", info.title], ["track_spotify_id", info.uri],
    ["q_duration", String(info.durationMs / 1000)], ["f_subtitle_length", String(Math.floor(info.durationMs / 1000))], ["usertoken", token],
  ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const response = await requestMxm(builder); const calls = response?.message?.body?.macro_calls;
  return calls?.["matcher.track.get"]?.message?.header?.status_code === 200 ? calls : null;
}

function mxmMatch(calls: any): LyricsMatchMetadata {
  const meta = calls?.["matcher.track.get"]?.message?.body?.track ?? {};
  return { title: meta.track_name, artists: meta.artist_name ? [meta.artist_name] : [], album: meta.album_name, durationMs: Number(meta.track_length) > 0 ? Number(meta.track_length) * 1000 : undefined, confidence: 0.95, method: "spotify-id" };
}

async function mxmRichSync(calls: any): Promise<any[] | null> {
  const meta = calls?.["matcher.track.get"]?.message?.body?.track;
  if (!meta?.has_richsync || !meta?.commontrack_id) return null;
  const response = await requestMxm((token) => "https://apic-desktop.musixmatch.com/ws/1.1/track.richsync.get?format=json&subtitle_format=mxm&app_id=web-desktop-app-v1.0&" + [
    ["commontrack_id", String(meta.commontrack_id)], ["q_duration", String(meta.track_length)], ["f_subtitle_length", String(meta.track_length)], ["usertoken", token],
  ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&"));
  try { return JSON.parse(response?.message?.body?.richsync?.richsync_body ?? "null"); } catch { return null; }
}

function richSyncLines(body: any[]): TimedWordLine[] {
  return body.flatMap((line: any): TimedWordLine[] => {
    const lineStart = Math.round(Number(line?.ts || 0) * 1000); const lineEnd = Math.round(Number(line?.te || 0) * 1000);
    const raw = Array.isArray(line?.l) ? line.l : [];
    const words = raw.flatMap((entry: any, index: number): TimedWord[] => {
      const text = clean(entry?.c); if (!text) return [];
      const start = lineStart + Math.round(Number(entry?.o || 0) * 1000);
      const next = raw[index + 1]; const end = next ? lineStart + Math.round(Number(next.o || 0) * 1000) : lineEnd;
      const nextText = String(next?.c ?? "");
      return [{ text, startTimeMs: start, endTimeMs: Math.max(start, end), isPartOfWord: /^[’'\-.,!?;:%)\]}]/.test(nextText.trim()) }];
    });
    return words.length ? [{ startTimeMs: words[0].startTimeMs, endTimeMs: Math.max(lineEnd, words.at(-1)!.endTimeMs), words }] : [];
  });
}

function mxmSynced(calls: any): TimedLine[] | null {
  const subtitle = calls?.["track.subtitles.get"]?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body;
  if (typeof subtitle !== "string") return null;
  try { const rows = JSON.parse(subtitle).flatMap((row: any): TimedLine[] => clean(row?.text) ? [{ text: row.text, startTimeMs: Math.round(Number(row?.time?.total || 0) * 1000) }] : []); return rows.length ? rows : null; } catch { return null; }
}

function mxmPlain(calls: any): string[] | null {
  const text = calls?.["track.lyrics.get"]?.message?.body?.lyrics?.lyrics_body;
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/).map(clean).filter((line) => line && !/not for commercial use/i.test(line) && !/^\*{3}/.test(line)); return lines.length ? lines : null;
}

async function fetchMusixmatch(info: TrackLyricsInfo): Promise<ExternalLyricsResult | null> {
  try {
    const calls = await mxmMacro(info); if (!calls) return null;
    const match = mxmMatch(calls);
    if (!$ignoreMusixmatchWordSync.get()) {
      const rich = await mxmRichSync(calls); if (rich) { const result = stamp(buildSyllable(richSyncLines(rich), "musixmatch", "Musixmatch"), "musixmatch", undefined, match); if (result) return result; }
    }
    const synced = mxmSynced(calls); if (synced) return stamp(buildLine(synced, info.durationMs, "musixmatch", "Musixmatch"), "musixmatch", undefined, match);
    const plain = mxmPlain(calls); return plain ? stamp(buildStatic(plain, "musixmatch", "Musixmatch"), "musixmatch", undefined, match) : null;
  } catch (error) { console.error("[SpicyLyrics] Musixmatch failed", error); return null; }
}

function parseLrc(text: string): { synced: TimedLine[]; plain: string[] } {
  const synced: TimedLine[] = []; const plain: string[] = [];
  for (const row of text.split(/\r?\n/)) {
    const matches = [...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]; const content = clean(row.replace(/\[[^\]]+\]/g, ""));
    if (!content) continue;
    if (!matches.length) plain.push(content);
    for (const match of matches) synced.push({ text: content, startTimeMs: Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000) });
  }
  return { synced, plain };
}

async function fetchLrclib(info: TrackLyricsInfo): Promise<ExternalLyricsResult | null> {
  try {
    const query = new URLSearchParams({ track_name: info.title, artist_name: info.artist, album_name: info.album, duration: String(info.durationMs / 1000) });
    const response = await fetch(`https://lrclib.net/api/get?${query}`, { headers: { "x-user-agent": "Spicy Lyrics (https://github.com/amarinne/spicy-lyrics)" } });
    if (!response.ok) return null; const body = await response.json();
    const match: LyricsMatchMetadata = { title: body?.trackName ?? info.title, artists: body?.artistName ? [body.artistName] : info.artists, album: body?.albumName, durationMs: Number(body?.duration) > 0 ? Number(body.duration) * 1000 : undefined, confidence: 0.9, method: "metadata-query" };
    if (body?.instrumental) return stamp(buildStatic(["♪ Instrumental ♪"], "lrclib", "LRCLIB"), "lrclib", undefined, match);
    if (body?.syncedLyrics) { const parsed = parseLrc(body.syncedLyrics); if (parsed.synced.length) return stamp(buildLine(parsed.synced, info.durationMs, "lrclib", "LRCLIB"), "lrclib", undefined, match); }
    return body?.plainLyrics ? stamp(buildStatic(body.plainLyrics.split(/\r?\n/), "lrclib", "LRCLIB"), "lrclib", undefined, match) : null;
  } catch (error) { console.error("[SpicyLyrics] LRCLIB failed", error); return null; }
}

function responseMatch(response: Response): LyricsMatchMetadata | undefined {
  const encoded = response.headers.get("X-Spicy-Lyrics-Match");
  if (!encoded) return undefined;
  try { return JSON.parse(decodeURIComponent(encoded)); }
  catch { return undefined; }
}

async function parseServerResponse(response: Response, info: TrackLyricsInfo, provider: LyricsSourceProviderId, label: string): Promise<ExternalLyricsResult | null> {
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const match = responseMatch(response);
  const text = await response.text(); if (!text.trim()) return null;
  if (contentType.includes("json") || /^[{[]/.test(text.trim())) {
    try { const body = JSON.parse(text); return stamp(body?.lyrics ?? body, provider, label, body?.match ?? body?.SourceMatch ?? body?.lyrics?.SourceMatch ?? match); } catch { return null; }
  }
  if (/^\s*(?:<\?xml[^>]*>\s*)?<tt[\s>]/i.test(text)) {
    const parsed = await ParseTTML(text);
    const lyrics = parsed?.Result ?? parsed;
    annotateTtmlTranslationLanguages(text, lyrics);
    return stamp(lyrics, provider, label, match);
  }
  const parsed = parseLrc(text);
  return parsed.synced.length ? stamp(buildLine(parsed.synced, info.durationMs, provider, label), provider, label, match) : stamp(buildStatic(parsed.plain, provider, label), provider, label, match);
}

async function fetchWorker(info: TrackLyricsInfo, provider: "amlldb" | "qq" | "kugou" | "netease" | "soda"): Promise<ExternalLyricsResult | null> {
  const base = normalizeLyricsServerUrl($externalLyricsWorkerUrl.get()); if (!base) return null;
  try { return await parseServerResponse(await fetch(externalSourceRequestUrl(base, info, provider)), info, provider, getLyricsSourceDefinition(provider, []).label); }
  catch (error) { console.error(`[SpicyLyrics] ${provider} Worker failed`, error); return null; }
}

async function fetchCustom(info: TrackLyricsInfo, provider: LyricsSourceProviderId): Promise<ExternalLyricsResult | null> {
  const server = parseCustomLyricsServers($customLyricsServers.get()).find((entry) => entry.id === provider); if (!server) return null;
  try { return await parseServerResponse(await fetch(externalSourceRequestUrl(server.url, info)), info, provider, server.name); }
  catch (error) { console.error(`[SpicyLyrics] custom server ${server.name} failed`, error); return null; }
}

async function timeout<T>(promise: Promise<T>, ms = 6500): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function fetchProviderResult(
  info: TrackLyricsInfo,
  provider: LyricsSourceProviderId,
  spicyRequest?: ReturnType<typeof spicyRaw>,
): Promise<ExternalLyricsResult | null> {
  return provider === "spicy" ? fetchSpicy(info.id, "spl", "spicy", spicyRequest) :
    provider === "apple" ? fetchSpicy(info.id, "aml", "apple", spicyRequest) :
    provider === "spotify" ? fetchSpotify(info) :
    provider === "musixmatch" ? fetchMusixmatch(info) :
    provider === "lrclib" ? fetchLrclib(info) :
    provider === "amlldb" || provider === "qq" || provider === "kugou" || provider === "netease" || provider === "soda" ? fetchWorker(info, provider) : fetchCustom(info, provider);
}

type ProviderEntry = {
  provider: LyricsSourceProviderId;
  result: ExternalLyricsResult;
  candidate: LyricsCandidate;
};

function finalizeSelection(
  entries: ProviderEntry[],
  durationMs: number,
  mode: ReturnType<typeof $lyricsSelectionMode.get>,
): ExternalLyricsResult | null {
  const selection = selectLyricsCandidate(entries.map((entry) => entry.candidate), durationMs, mode, $prioritizeAppleMusicQuality.get());
  $lyricsSelectionDiagnostics.set(selection.diagnostics);
  const chosen = entries.find((entry) => entry.candidate === selection.candidate);
  if (!chosen) return null;
  chosen.result.lyrics.SelectionDiagnostics = selection.diagnostics;
  return chosen.result;
}

export async function fetchLyricsFromProviders(uri: string, order: LyricsSourceProviderId[]): Promise<ExternalLyricsResult | null> {
  const info = trackInfo(uri); if (!info) return null;
  const mode = $lyricsSelectionMode.get();
  const spicyRequest = order.some((provider) => provider === "spicy" || provider === "apple") ? spicyRaw(info.id) : undefined;
  $lyricsSelectionDiagnostics.set(null);
  if (mode === "strict") {
    for (const [orderIndex, provider] of order.entries()) {
      const result = await timeout(fetchProviderResult(info, provider, spicyRequest));
      if (result?.status === 503 && provider === "spicy") return result;
      if (!result?.lyrics) continue;
      return finalizeSelection([{ provider, result, candidate: { provider, orderIndex, lyrics: result.lyrics, match: result.match } }], info.durationMs, mode);
    }
    return null;
  }

  const fetched = await Promise.all(order.map(async (provider, orderIndex) => {
    const result = await timeout(fetchProviderResult(info, provider, spicyRequest));
    return { provider, orderIndex, result };
  }));
  const spicyUnavailable = fetched.find((entry) => entry.provider === "spicy" && entry.result?.status === 503);
  if (spicyUnavailable?.result) return spicyUnavailable.result;
  const entries = fetched.flatMap(({ provider, orderIndex, result }): ProviderEntry[] =>
    result?.lyrics ? [{ provider, result, candidate: { provider, orderIndex, lyrics: result.lyrics, match: result.match } }] : []);
  return finalizeSelection(entries, info.durationMs, mode);
}
