import {
  attachSidecars,
  attachTimedSidecars,
  toLineLyrics,
  toStaticLyrics,
  toSyllableLyrics,
} from "../convert";
import { dedupeProviderCredits, extractByCredit } from "../credits";
import { ProviderUpstreamError } from "../http/fetch";
import { providerLineSemanticContext } from "../provider-info";
import type { ProviderLineSemanticContext } from "../provider-line-semantics";
import type { LyricsProvider, NativeLyrics, TimedLine } from "../types";
import { parseKrc } from "./kugou";
import { parseYrc } from "./netease";
import { parseQrc } from "./qq";
import {
  assessCandidate,
  assessAndRankCandidates,
  fetchWithTimeout,
  isAcceptableCandidate,
  isStrongCandidate,
  matchMetadata,
  readResponseJson,
  searchQueries,
  throwIfAborted,
  throwIfProviderRequestFailed,
  type CandidateAssessment,
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
    device_platform: "web",
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

type SodaPayloadAttempt<T> =
  | { kind: "valid"; body: T }
  | { kind: "invalid-payload" };

type SodaAttemptSummary = {
  valid: number;
  invalidPayload: number;
};

async function readSodaPayload<T>(response: Response, signal?: AbortSignal): Promise<SodaPayloadAttempt<T>> {
  try {
    return { kind: "valid", body: await readResponseJson<T>(response) };
  } catch (error) {
    throwIfProviderRequestFailed(error, signal);
    return { kind: "invalid-payload" };
  }
}

function recordSodaAttempt(summary: SodaAttemptSummary, attempt: SodaPayloadAttempt<unknown>): void {
  if (attempt.kind === "valid") summary.valid += 1;
  else summary.invalidPayload += 1;
}

function throwIfOnlyInvalidSodaPayloads(summary: SodaAttemptSummary, phase: string): void {
  if (summary.valid === 0 && summary.invalidPayload > 0) {
    throw new ProviderUpstreamError(`Soda returned invalid ${phase} payloads`, 502);
  }
}

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

function hasSodaRecordingIdentity(assessment: CandidateAssessment): boolean {
  if ((assessment.evidence.artists ?? 0) > 0) return true;
  return assessment.evidence.title >= 0.9
    && (assessment.evidence.album ?? 0) >= 0.85
    && (assessment.evidence.duration ?? 0) >= 0.8;
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

async function searchSodaAssessed(
  track: Parameters<LyricsProvider>[0],
  clientParams = sodaClientParams(),
  signal?: AbortSignal,
) {
  const found = new Map<string, SodaSong>();
  const attempts: SodaAttemptSummary = { valid: 0, invalidPayload: 0 };
  let assessed = assessAndRankCandidates(found.values(), (song) => assessSodaSong(track, song));
  for (const query of searchQueries(track)) {
    throwIfAborted(signal);
    const url = new URL("https://api.qishui.com/luna/search/track");
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
      const response = await fetchWithTimeout(url.toString(), { headers: sodaHeaders, signal });
      if (!response.ok) continue;
      const attempt = await readSodaPayload<any>(response, signal);
      recordSodaAttempt(attempts, attempt);
      if (attempt.kind === "invalid-payload") continue;
      const body = attempt.body;
      if (!successfulSodaBody(body)) continue;
      for (const item of (body?.result_groups ?? []).flatMap((group: any) => group?.data ?? [])) {
        if (item?.meta?.item_type !== "track") continue;
        const song = sodaSong(item?.entity?.track);
        if (song) found.set(song.id, song);
      }
    } catch (error) {
      throwIfProviderRequestFailed(error, signal);
      /* try the next metadata query */
    }
    assessed = assessAndRankCandidates(found.values(), (song) => assessSodaSong(track, song));
    if (assessed.some(({ assessment }) => isStrongCandidate(assessment))) break;
  }
  throwIfOnlyInvalidSodaPayloads(attempts, "search");
  return assessed;
}

export async function searchSoda(
  track: Parameters<LyricsProvider>[0],
  clientParams = sodaClientParams(),
  signal?: AbortSignal,
): Promise<SodaSong[]> {
  return (await searchSodaAssessed(track, clientParams, signal)).map(({ candidate }) => candidate);
}

// Only the observed app-risk status is transient on unsigned detail requests.
const SODA_RISK_REJECTION_STATUS = 1000062;
const SODA_DETAIL_ATTEMPTS = 4;

async function fetchSodaDetail(
  song: SodaSong,
  clientParams = sodaClientParams(),
  signal?: AbortSignal,
): Promise<SodaPayloadAttempt<any> | undefined> {
  for (let attempt = 0; attempt < SODA_DETAIL_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    const url = new URL("https://api.qishui.com/luna/track");
    url.search = new URLSearchParams({
      ...(attempt === 0 ? clientParams : sodaClientParams()),
      track_id: song.id,
      media_type: "track",
    }).toString();
    try {
      const response = await fetchWithTimeout(url.toString(), { headers: sodaHeaders, signal });
      if (!response.ok) return undefined;
      const payload = await readSodaPayload<any>(response, signal);
      if (payload.kind === "invalid-payload") return payload;
      if (!successfulSodaBody(payload.body)) {
        if (Number(payload.body?.status_code) === SODA_RISK_REJECTION_STATUS) continue;
        return { kind: "valid", body: undefined };
      }
      if (String(payload.body?.track?.id ?? "") !== song.id) return { kind: "valid", body: undefined };
      return payload;
    } catch (error) {
      throwIfProviderRequestFailed(error, signal);
      return undefined;
    }
  }
  throw new ProviderUpstreamError("Soda detail requests were rejected by upstream risk control", 502);
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

function convertSodaLyrics(
  body: any,
  durationMs: number,
  semanticContext: ProviderLineSemanticContext,
): NativeLyrics | undefined {
  const lyric: SodaLyric = body?.lyric ?? {};
  const content = typeof lyric.content === "string" ? lyric.content : "";
  const type = String(lyric.type ?? "").toLowerCase();
  if (!content.trim()) return undefined;
  const translation = sodaTranslation(lyric);

  if (type === "lrc") {
    return toLineLyrics(content, durationMs, "soda", translation?.content, undefined, semanticContext);
  }

  const lines = structuredSodaLyrics(type, content);
  if (lines.length) {
    const translatedLines = translation?.content
      ? structuredSodaLyrics(String(translation.type ?? "").toLowerCase(), translation.content)
      : [];
    const withSidecar = translatedLines.length
      ? attachTimedSidecars(lines, translatedLines)
      : attachSidecars(lines, translation?.content);
    return toSyllableLyrics(withSidecar, "soda", semanticContext);
  }

  return toStaticLyrics(content, "soda", semanticContext);
}

// Soda's Luna PC search/detail flow and current client identity are adapted
// from Lyricify Lyrics Helper (Apache-2.0). Spicy adds independent metadata
// validation, structured-timing preservation, sidecar handling, and bounded
// failure behavior. See worker/NOTICE.md and worker/LICENSES/Apache-2.0.txt.
export const sodaProvider: LyricsProvider = async (track, context = {}) => {
  const clientParams = sodaClientParams();
  const detailAttempts: SodaAttemptSummary = { valid: 0, invalidPayload: 0 };
  for (const { candidate: song, assessment: searchAssessment } of await searchSodaAssessed(track, clientParams, context.signal)) {
    throwIfAborted(context.signal);
    if (!isAcceptableCandidate(searchAssessment) || searchAssessment.evidence.versionConflict) continue;
    const attempt = await fetchSodaDetail(song, clientParams, context.signal);
    if (!attempt) continue;
    recordSodaAttempt(detailAttempts, attempt);
    if (attempt.kind === "invalid-payload") continue;
    const body = attempt.body;
    if (!body) continue;
    const detail = sodaSong(body.track);
    if (!detail) continue;
    const detailAssessment = assessSodaSong(track, detail);
    if (!isAcceptableCandidate(detailAssessment) || detailAssessment.evidence.versionConflict) continue;
    if (!hasSodaRecordingIdentity(detailAssessment)) continue;
    const result = convertSodaLyrics(
      body,
      detail.durationMs ?? song.durationMs ?? track.durationMs,
      providerLineSemanticContext(track, detail, body?.lyric?.content),
    );
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
  throwIfOnlyInvalidSodaPayloads(detailAttempts, "detail");
  return undefined;
};
