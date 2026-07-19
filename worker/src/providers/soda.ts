import {
  attachSidecars,
  attachTimedSidecars,
  toLineLyrics,
  toStaticLyrics,
  toSyllableLyrics,
} from "../convert";
import { dedupeProviderCredits, extractByCredit } from "../credits";
import type { LyricsProvider, NativeLyrics, TimedLine } from "../types";
import { parseKrc } from "./kugou";
import { parseYrc } from "./netease";
import { parseQrc } from "./qq";
import {
  assessCandidate,
  fetchWithTimeout,
  isAcceptableCandidate,
  isStrongCandidate,
  matchMetadata,
  searchQueries,
} from "./shared";

const SODA_USER_AGENT = "LunaPC/2.1.0(12292405)";

function clientId(prefix: string): string {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return prefix + [...values].map((value) => String(value % 100_000_000).padStart(8, "0")).join("");
}

function sodaClientParams(): Record<string, string> {
  const deviceId = clientId("738");
  const installId = clientId("739");
  return {
    aid: "386088",
    app_name: "luna_pc",
    device_id: deviceId,
    install_id: installId,
    did: deviceId,
    iid: installId,
    device_platform: "PC",
    version_code: "2.1.0",
    version_name: "2.1.0",
  };
}
const sodaHeaders = {
  Referer: "https://api.qishui.com/",
  "User-Agent": SODA_USER_AGENT,
};

export type SodaSong = {
  id: string;
  title: string;
  titleAliases?: string[];
  artists: string[];
  artistAliases?: string[];
  album: string;
  durationMs?: number;
};

type SodaLyric = {
  content?: string;
  lang?: string;
  type?: string;
};

function assessSodaSong(track: Parameters<LyricsProvider>[0], song: SodaSong) {
  return assessCandidate(track, {
    title: song.title,
    titleAliases: song.titleAliases,
    artists: song.artists,
    artistAliases: song.artistAliases,
    album: song.album,
    durationMs: song.durationMs,
  });
}

function sodaSong(value: any): SodaSong | undefined {
  const id = String(value?.id ?? "").trim();
  const title = String(value?.name ?? "").trim();
  if (!id || !title) return undefined;
  const durationMs = Number(value?.duration);
  const artistValues = Array.isArray(value?.artists) ? value.artists : [];
  const artists = artistValues
    .map((artist: any) => String(artist?.name ?? "").trim())
    .filter(Boolean);
  const artistAliases = [...new Set<string>(artistValues
    .flatMap((artist: any) => [artist?.simple_display_name, artist?.user_info?.nickname])
    .map((name: unknown) => String(name ?? "").trim())
    .filter((name: string) => name && !artists.includes(name)) as string[])];
  return {
    id,
    title,
    artists,
    ...(artistAliases.length ? { artistAliases } : {}),
    album: String(value?.album?.name ?? "").trim(),
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined,
  };
}

function successfulSodaBody(body: any): boolean {
  const status = Number(body?.status_code);
  return !Number.isFinite(status) || status === 0;
}

export async function searchSoda(
  track: Parameters<LyricsProvider>[0],
  clientParams = sodaClientParams(),
): Promise<SodaSong[]> {
  const found = new Map<string, SodaSong>();
  for (const query of searchQueries(track)) {
    const url = new URL("https://api.qishui.com/luna/pc/search/track");
    url.search = new URLSearchParams({
      ...clientParams,
      region: "",
      geo_region: "",
      os_region: "",
      sim_region: "",
      cdid: "",
      channel: "",
      build_mode: "",
      network_carrier: "",
      ac: "",
      tz_name: "",
      resolution: "",
      device_type: "pc",
      os_version: "",
      fp: "",
      q: query,
      cursor: "",
      search_id: "",
      search_method: "input",
      debug_params: "",
      from_search_id: "",
      search_scene: "",
    }).toString();
    try {
      const response = await fetchWithTimeout(url.toString(), { headers: sodaHeaders });
      if (!response.ok) continue;
      const body = await response.json<any>();
      if (!successfulSodaBody(body)) continue;
      for (const item of (body?.result_groups ?? []).flatMap((group: any) => group?.data ?? [])) {
        if (item?.meta?.item_type !== "track") continue;
        const song = sodaSong(item?.entity?.track);
        if (song) found.set(song.id, song);
      }
    } catch { /* try the next metadata query */ }
    if ([...found.values()].some((song) => isStrongCandidate(assessSodaSong(track, song)))) break;
  }
  return [...found.values()].sort((a, b) => assessSodaSong(track, b).score - assessSodaSong(track, a).score);
}

export async function fetchSodaDetail(
  song: SodaSong,
  clientParams = sodaClientParams(),
): Promise<any | undefined> {
  const url = new URL("https://api.qishui.com/luna/pc/track_v2");
  url.search = new URLSearchParams(clientParams).toString();
  try {
    const response = await fetchWithTimeout(url.toString(), {
      method: "POST",
      headers: {
        ...sodaHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        track_id: song.id,
        media_type: "track",
        queue_type: "",
      }),
    });
    if (!response.ok) return undefined;
    const body = await response.json<any>();
    if (!successfulSodaBody(body) || String(body?.track?.id ?? "") !== song.id) return undefined;
    return body;
  } catch {
    return undefined;
  }
}

function structuredSodaLyrics(type: string, content: string): TimedLine[] {
  if (type === "krc") return parseKrc(content);
  if (type === "qrc") return parseQrc(content);
  if (type === "yrc") return parseYrc(content);
  return [];
}

function sodaTranslation(lyric: any): SodaLyric | undefined {
  const candidates = Object.entries(lyric?.lang_translations ?? {}).map(([key, value]: [string, any]) => ({
    key: key.toLowerCase(),
    content: typeof value?.content === "string" ? value.content : undefined,
    lang: String(value?.lang ?? ""),
    type: String(value?.type ?? lyric?.type ?? ""),
  }));
  const translated = candidates.find((candidate) =>
    candidate.content && /(?:^|[-_])(?:zh|cn)(?:$|[-_])/iu.test(`${candidate.key}-${candidate.lang}`))
    ?? candidates.find((candidate) => candidate.content);
  if (translated) return translated;
  const chinese = lyric?.translations?.cn;
  return typeof chinese === "string" && chinese.trim()
    ? { content: chinese, lang: "zh-CN", type: String(lyric?.type ?? "") }
    : undefined;
}

function convertSodaLyrics(body: any, durationMs: number): NativeLyrics | undefined {
  const lyric: SodaLyric = body?.lyric ?? {};
  const content = typeof lyric.content === "string" ? lyric.content : "";
  const type = String(lyric.type ?? "").toLowerCase();
  if (!content.trim()) return undefined;
  const translation = sodaTranslation(lyric);

  if (type === "lrc") {
    return toLineLyrics(content, durationMs, "soda", translation?.content);
  }

  const lines = structuredSodaLyrics(type, content);
  if (lines.length) {
    const translatedLines = translation?.content
      ? structuredSodaLyrics(String(translation.type ?? "").toLowerCase(), translation.content)
      : [];
    const withSidecar = translatedLines.length
      ? attachTimedSidecars(lines, translatedLines)
      : attachSidecars(lines, translation?.content);
    return toSyllableLyrics(withSidecar, "soda");
  }

  return toStaticLyrics(content, "soda");
}

// Soda's Luna PC search/detail flow and current client identity are adapted
// from Lyricify Lyrics Helper (Apache-2.0). Spicy adds independent metadata
// validation, structured-timing preservation, sidecar handling, and bounded
// failure behavior. See worker/NOTICE.md and worker/LICENSES/Apache-2.0.txt.
export const sodaProvider: LyricsProvider = async (track) => {
  const clientParams = sodaClientParams();
  for (const song of await searchSoda(track, clientParams)) {
    const searchAssessment = assessSodaSong(track, song);
    if (!isAcceptableCandidate(searchAssessment) || searchAssessment.evidence.versionConflict) continue;
    const body = await fetchSodaDetail(song, clientParams);
    if (!body) continue;
    const detail = sodaSong(body.track);
    if (!detail) continue;
    const detailAssessment = assessSodaSong(track, detail);
    if (!isAcceptableCandidate(detailAssessment) || detailAssessment.evidence.versionConflict) continue;
    const result = convertSodaLyrics(body, detail.durationMs ?? song.durationMs ?? track.durationMs);
    if (!result) continue;
    const ProviderCredits = dedupeProviderCredits([
      extractByCredit(body?.lyric?.content, "lyrics", "soda"),
    ]);
    return {
      ...result,
      ...(ProviderCredits.length ? { ProviderCredits } : {}),
      SourceMatch: matchMetadata(
        track,
        detail.title,
        detail.artists,
        detail.durationMs,
        `luna-pc-${String(body?.lyric?.type ?? "unknown").toLowerCase()}`,
        detail.album,
        { titleAliases: detail.titleAliases, artistAliases: detail.artistAliases },
      ),
    };
  }
  return undefined;
};
