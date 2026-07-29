import { franc } from "franc-all";
import langs from "langs";
import { isDev } from "../../components/Global/Defaults.ts";
import {
  $currentLyricsData,
  $currentLyricsType,
  $currentlyFetching,
  $customLyricsServers,
  $disabledLyricsSources,
  $externalLyricsWorkerUrl,
  $ignoreMusixmatchWordSync,
  $lyricsSelectionDiagnostics,
  $lyricsSelectionMode,
  $lyricsSourceOrder,
  $prioritizeAppleMusicQuality,
} from "../stores.ts";
import Platform from "../../components/Global/Platform.ts";
import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import PageView, { PageContainer } from "../../components/Pages/PageView.ts";
import { Query } from "../API/Query.ts";
import { LYRICS_PROCESSING_VERSION, ProcessLyrics, READING_PLAN_SCHEMA_VERSION } from "./ProcessLyrics.ts";
import {
  chineseTones,
  chineseTranslitMode,
  cyrillicKeepSigns,
  cyrillicRomanizationMode,
  joinMandarinWords,
  koreanDisplayMode,
  translationEnabled,
  translationTargetLang,
} from "./lyrics.ts";
import Logger from "../Logger.ts";
import { LocalLyricsManager } from "./manager/index.ts";
import { LyricsQueueRetry } from "./LyricsQueueRetry.ts";
import { GetExpireStore } from "../../modules/Store.ts";
import { SLObjPack } from "../objpack.ts";
import {
  captureSourceTranslations,
  normalizeProviderTranslations,
  TRANSLATION_SIDECAR_SCHEMA_VERSION,
  translateLyrics,
} from "./Fork/Translation.ts";
import { $chineseCharacterForm, $japaneseReadingMode } from "../uiState.ts";
import { buildProcessingContextKey } from "./ProcessingContext.ts";
import { fetchLyricsFromProviders } from "./ExternalSources.ts";
import {
  normalizeDisabledLyricsSourceIds,
  normalizeLyricsSourceOrder,
  parseCustomLyricsServers,
  type LyricsSourceProviderId,
} from "./LyricsSourcePreferences.ts";
import { publishLyricsInteropSnapshot } from "./Interop.ts";
import { isLyricsSourceCacheCompatible } from "./LyricsSourceCache.ts";
import { ensureSourceEvidence } from "./Processing/SourceEvidence.ts";
import {
  LyricsRequestCoordinator,
  type LyricsRequestSession,
} from "./LyricsRequestSession.ts";

const lyricsLogger = new Logger("Lyrics Pipeline");
const lyricsCacheLogger = new Logger("Lyrics Cache");
const lyricsPrefetchLogger = new Logger("Lyrics Prefetch");
const prefetchInFlight = new Set<string>();
type FetchLyricsResult = [object | string, number] | null;
const foregroundLyricsRequests = new LyricsRequestCoordinator<FetchLyricsResult>();

export function invalidateLyricsPipeline(): void {
  foregroundLyricsRequests.invalidate();
  $currentlyFetching.set(false);
}

// recently updated key structure - changed name
export const LyricsStore = GetExpireStore<any>("SpicyLyrics_LyricsStore_g1", 2, {
  Unit: "Days",
  Duration: 3,
}, isDev as true);

const lyricsPacker = new SLObjPack();
const LYRICS_SOURCE_CACHE_VERSION = 14;

function getActiveLyricsSourceOrder(): LyricsSourceProviderId[] {
  const custom = parseCustomLyricsServers($customLyricsServers.get());
  const disabled = new Set(normalizeDisabledLyricsSourceIds($disabledLyricsSources.get(), custom));
  return normalizeLyricsSourceOrder($lyricsSourceOrder.get(), custom).filter((provider) => !disabled.has(provider));
}

function lyricsSourceCacheSignature(): string {
  return JSON.stringify({
    version: LYRICS_SOURCE_CACHE_VERSION,
    order: getActiveLyricsSourceOrder(),
    worker: $externalLyricsWorkerUrl.get().trim().replace(/\/+$/, ""),
    custom: parseCustomLyricsServers($customLyricsServers.get()),
    ignoreMusixmatchWordSync: $ignoreMusixmatchWordSync.get(),
    prioritizeAppleMusicQuality: $prioritizeAppleMusicQuality.get(),
    lyricsSelectionMode: $lyricsSelectionMode.get(),
  });
}

function isSourceCacheCompatible(lyrics: any): boolean {
  return isLyricsSourceCacheCompatible(
    lyrics,
    lyricsSourceCacheSignature(),
    TRANSLATION_SIDECAR_SCHEMA_VERSION
  );
}

function currentProcessingContextKey(): string {
  return buildProcessingContextKey({
    translationEnabled,
    translationTargetLang,
    chineseTranslitMode,
    chineseTones,
    joinMandarinWords,
    chineseCharacterForm: $chineseCharacterForm.get(),
    koreanDisplayMode,
    cyrillicRomanizationMode,
    cyrillicKeepSigns,
    japaneseReadingMode: $japaneseReadingMode.get(),
  });
}

async function setProcessedLyricsStoreItem(
  trackId: string,
  lyrics: any,
  session?: LyricsRequestSession,
): Promise<void> {
  if (session && !session.isCurrent()) return;
  ensureSourceEvidence(lyrics);
  lyrics.ProcessingContextKey = currentProcessingContextKey();
  lyrics.ReadingPlanSchemaVersion = READING_PLAN_SCHEMA_VERSION;
  if (session && !session.isCurrent()) return;
  await LyricsStore.SetItem(trackId, lyrics);
}

function setRomanizationClass(hasTransliterations: boolean | undefined): void {
  if (hasTransliterations) {
    PageContainer?.classList.add("Lyrics_RomanizationAvailable");
  } else {
    PageContainer?.classList.remove("Lyrics_RomanizationAvailable");
  }
}

/**
 * Shared "lyrics are ready" presentation: toggle the romanization class, hide the
 * loader, publish the type, and reveal the containers and view controls. Used by
 * every successful return path.
 */
function dispatchProcessingReady(
  trackId: string,
  lyrics: any,
  session: LyricsRequestSession,
): void {
  if (!session.isCurrent() || SpotifyPlayer.GetId() !== trackId) return;
  ensureSourceEvidence(lyrics);
  $currentLyricsData.set(JSON.stringify(lyrics));
  publishLyricsInteropSnapshot(lyrics);
  window.dispatchEvent(
    new CustomEvent("spicy-lyrics:processing-ready", {
      detail: { trackId, lyrics },
    })
  );
}

async function finishTranslationInBackground(
  trackId: string,
  lyrics: any,
  session: LyricsRequestSession,
): Promise<void> {
  try {
    await translateLyrics(lyrics, { signal: session.signal });
  } catch (error) {
    if (session.signal.aborted) return;
    lyricsCacheLogger.error("Background lyrics translation failed", error);
  }
  if (!session.isCurrent()) return;
  lyrics.TranslationPending = false;
  await setProcessedLyricsStoreItem(trackId, lyrics, session);
  dispatchProcessingReady(trackId, lyrics, session);
}

async function finishProcessingInBackground(
  trackId: string,
  lyrics: any,
  session: LyricsRequestSession,
): Promise<void> {
  const shouldTranslate = lyrics.TranslationPending === true;
  const shouldRerenderAfterRomanization = lyrics.RomanizationPending === true;

  try {
    await ProcessLyrics(lyrics, { updatePageClasses: false, awaitTranslation: false });
    if (!session.isCurrent()) return;
    lyrics.ProcessingPending = false;
    lyrics.RomanizationPending = false;
    lyrics.TranslationPending = shouldTranslate;
    await setProcessedLyricsStoreItem(trackId, lyrics, session);
    if (shouldRerenderAfterRomanization) dispatchProcessingReady(trackId, lyrics, session);
  } catch (error) {
    lyrics.ProcessingPending = false;
    lyrics.RomanizationPending = false;
    lyrics.TranslationPending = false;
    lyricsCacheLogger.error("Background lyrics romanization failed", error);
    return;
  }

  if (!shouldTranslate) return;
  await finishTranslationInBackground(trackId, lyrics, session);
}

const RomanizableScriptQuickTest = /[぀-ヿ一-鿿가-힯ᄀ-ᇿ㄰-㆏Ѐ-ԯͰ-Ͽἀ-῿]/;
const ObviousNonEnglishScriptQuickTest = /[぀-ヿ一-鿿가-힯ᄀ-ᇿ㄰-㆏Ѐ-ԯͰ-Ͽἀ-῿]/;
const NonAsciiLatinQuickTest = /[À-ÖØ-öø-ÿĀ-žƀ-ɏ]/;

function collectLyricsText(lyrics: any): string[] {
  const parts: string[] = [];
  if (lyrics?.Type === "Static") {
    for (const line of lyrics.Lines || []) parts.push(line.Text || "");
  } else if (lyrics?.Type === "Line") {
    for (const line of lyrics.Content || []) parts.push(line.Text || "");
  } else if (lyrics?.Type === "Syllable") {
    for (const group of lyrics.Content || []) {
      for (const syl of group.Lead?.Syllables || []) parts.push(syl.Text || "");
      for (const bg of group.Background || []) {
        for (const syl of bg.Syllables || []) parts.push(syl.Text || "");
      }
    }
  }
  return parts;
}

function detectChineseQuick(lyrics: any): boolean {
  const text = collectLyricsText(lyrics).join("");
  return /[\u4E00-\u9FFF]/.test(text) && !/[ぁ-んァ-ン]/.test(text);
}

function hasRomanizationWorkQuick(lyrics: any): boolean {
  return RomanizableScriptQuickTest.test(collectLyricsText(lyrics).join(""));
}

function hasTranslationWorkQuick(lyrics: any): boolean {
  if (!translationEnabled || !translationTargetLang) return false;
  const text = collectLyricsText(lyrics).join(" ").trim();
  if (!text) return false;

  if (translationTargetLang === "en") {
    if (ObviousNonEnglishScriptQuickTest.test(text) || NonAsciiLatinQuickTest.test(text)) return true;
    const compact = text.replace(/[^\p{L}\s']/gu, " ").replace(/\s+/g, " ").trim();
    if (compact.length < 24) return false;
    const detected = franc(compact);
    if (detected === "und") return false;
    return langs.where("3", detected)?.["1"] !== "en";
  }

  return true;
}

function markProcessedWithoutBackground(lyrics: any): void {
  ensureSourceEvidence(lyrics);
  lyrics.ProcessingVersion = LYRICS_PROCESSING_VERSION;
  lyrics.ReadingPlanSchemaVersion = READING_PLAN_SCHEMA_VERSION;
  lyrics.ProcessingPending = false;
  lyrics.RomanizationPending = false;
  lyrics.TranslationPending = false;
  lyrics.HasTransliterations = lyrics.HasTransliterations === true;
  lyrics.IncludesRomanization = lyrics.HasTransliterations === true;
  lyrics.IncludesTranslation = lyrics.IncludesTranslation === true;
}

function presentLyrics(lyricsData: any, session: LyricsRequestSession): void {
  if (!session.isCurrent()) return;
  ensureSourceEvidence(lyricsData);
  publishLyricsInteropSnapshot(lyricsData);
  $lyricsSelectionDiagnostics.set(lyricsData?.SelectionDiagnostics ?? null);
  // Lyrics are in hand — end any 503 retry loop that was running for this track.
  LyricsQueueRetry.NotifyResolved(lyricsData?.uri);
  setRomanizationClass(lyricsData?.HasTransliterations || lyricsData?.RomanizationPending);
  PageContainer?.classList.toggle("Lyrics_ChineseDetected", lyricsData?.DetectedChinese === true);
  PageContainer?.classList.toggle("Lyrics_TranslationAvailable", lyricsData?.IncludesTranslation === true || lyricsData?.TranslationPending === true);
  HideLoaderContainer();
  $currentLyricsType.set(lyricsData.Type);
  PageContainer?.querySelector<HTMLElement>(".ContentBox")?.classList.remove("LyricsHidden");
  PageContainer?.querySelector(".ContentBox .LyricsContainer")?.classList.remove("Hidden");
  PageView.AppendViewControls(true);
}

type ProcessingVersionResult = {
  lyrics: any;
  translationPending: boolean;
};

async function ensureProcessingVersion(
  trackId: string,
  uri: string,
  lyrics: any,
  session: LyricsRequestSession,
): Promise<ProcessingVersionResult> {
  if (lyrics) {
    lyrics.uri = lyrics.uri || uri;
    lyrics.id = lyrics.id || trackId;
    ensureSourceEvidence(lyrics);
    normalizeProviderTranslations(lyrics);
  }

  const processingContextKey = currentProcessingContextKey();

  if (!lyrics) return { lyrics, translationPending: false };

  // ProcessingPending === true means a previous session cached raw lyrics and
  // died before its background processing finished — treat as stale and
  // reprocess below instead of serving unprocessed lyrics forever.
  if (
    lyrics.ProcessingPending !== true
    && lyrics.ProcessingVersion === LYRICS_PROCESSING_VERSION
    && lyrics.ReadingPlanSchemaVersion === READING_PLAN_SCHEMA_VERSION
    && lyrics.ProcessingContextKey === processingContextKey
  ) {
    return {
      lyrics,
      translationPending: lyrics.TranslationPending === true,
    };
  }

  if (!hasRomanizationWorkQuick(lyrics) && !hasTranslationWorkQuick(lyrics)) {
    markProcessedWithoutBackground(lyrics);
    lyrics.id = lyrics.id || trackId;
    await setProcessedLyricsStoreItem(trackId, lyrics, session);
    return { lyrics, translationPending: false };
  }

  lyricsCacheLogger.debug("Reprocessing stale cached lyrics", {
    trackId,
    fromVersion: lyrics.ProcessingVersion,
    toVersion: LYRICS_PROCESSING_VERSION,
    fromContext: lyrics.ProcessingContextKey,
    toContext: processingContextKey,
  });
  const translationPending = hasTranslationWorkQuick(lyrics);
  await ProcessLyrics(lyrics, { updatePageClasses: false, awaitTranslation: false });
  if (!session.isCurrent()) return { lyrics, translationPending: false };
  lyrics.ProcessingPending = false;
  lyrics.RomanizationPending = false;
  lyrics.TranslationPending = translationPending;
  await setProcessedLyricsStoreItem(trackId, lyrics, session);
  return { lyrics, translationPending };
}

export async function PrefetchLyrics(uri: string): Promise<void> {
  const trackId = uri?.split(":")?.[2];
  if (!trackId || uri.startsWith("spotify:local:")) return;
  if (prefetchInFlight.has(trackId)) return;

  try {
    const cached = await LyricsStore.GetItem(trackId);
    if (cached?.Value === "NO_LYRICS" || (cached && !isSourceCacheCompatible(cached))) {
      await LyricsStore.RemoveItem(trackId);
    } else if (cached) {
      return;
    }
    const localLyric = await LocalLyricsManager.get(uri);
    if (localLyric) {
      await setProcessedLyricsStoreItem(trackId, { ...localLyric, id: trackId });
      return;
    }
  } catch (error) {
    lyricsPrefetchLogger.debug("Prefetch cache probe failed", error);
  }

  prefetchInFlight.add(trackId);
  try {
    const firstProvider = getActiveLyricsSourceOrder()[0];
    if (firstProvider !== "spicy" && firstProvider !== "apple") {
      lyricsPrefetchLogger.debug("Skipping network prefetch without next-track provider metadata", {
        trackId,
        firstProvider,
      });
      return;
    }
    const Token = await Platform.GetSpotifyAccessToken();
    const queries = await Query(
      [
        {
          operation: "lyrics",
          variables: {
            id: trackId,
            auth: "SpicyLyrics-WebAuth",
          },
        },
      ],
      {
        "SpicyLyrics-WebAuth": `Bearer ${Token}`,
      }
    );

    const lyricsQuery = queries.get("0");
    if (!lyricsQuery || lyricsQuery.httpStatus !== 200) return;

    const lyrics = lyricsPacker.unpack(lyricsQuery.data) as any;
    if (lyrics === null || lyrics === undefined || lyrics === "") return;
    const expectedSource = firstProvider === "spicy" ? "spl" : "aml";
    if (lyrics.source !== expectedSource) return;
    lyrics.id = trackId;
    lyrics.uri = uri;
    lyrics.fetchProvider = firstProvider;
    lyrics.sourceDisplayName = firstProvider === "spicy" ? "Spicy Lyrics" : "Apple Music";
    lyrics.LyricsSourceCacheSignature = lyricsSourceCacheSignature();

    // Same entry schema as the main fetch path: sidecar the provider
    // translation before any processing so the lanes stay consistent.
    captureSourceTranslations(lyrics);

    if (hasRomanizationWorkQuick(lyrics) || hasTranslationWorkQuick(lyrics)) {
      await ProcessLyrics(lyrics, { updatePageClasses: false });
    } else {
      markProcessedWithoutBackground(lyrics);
    }
    await setProcessedLyricsStoreItem(trackId, lyrics);
    lyricsPrefetchLogger.debug("Prefetched next lyrics", { trackId, uri });
  } catch (error) {
    lyricsPrefetchLogger.debug("Prefetch failed", error);
  } finally {
    prefetchInFlight.delete(trackId);
  }
}

async function fetchLyricsForSession(
  uri: string,
  session: LyricsRequestSession,
): Promise<FetchLyricsResult> {
  lyricsLogger.debug("Fetch requested", uri);
  //if (!PageContainer) return;
  const LyricsContent =
    PageContainer?.querySelector(".LyricsContainer .LyricsContent") ?? undefined;
  if (!LyricsContent) return;
  if (LyricsContent?.classList.contains("offline")) {
    LyricsContent.classList.remove("offline");
  }

  //if (!Fullscreen.IsOpen) PageView.AppendViewControls(true);

  if (SpotifyPlayer.IsDJ()) {
    return ["dj", 400];
  }

  const mediaType = SpotifyPlayer.GetMediaType();

  if (
    mediaType &&
    mediaType !== "audio"
  ) {
    if (mediaType === "video") {
      return ["video-track", 400];
    } else if (mediaType === "mixed") {
      return ["mixed-track", 400];
    }
    return ["unknown-track", 400];
  }

  const contentType = SpotifyPlayer.GetContentType();
  if (contentType !== "track") {
    if (contentType === "episode") {
      return ["episode-track", 400];
    }
    return ["unknown-track", 400];
  }

  const trackId = uri.split(":")[2];
  $lyricsSelectionDiagnostics.set(null);

  if (LyricsContent) {
    LyricsContent.classList.add("HiddenTransitioned");
  }


  // Check if there's already data in localStorage
  const savedLyricsData = $currentLyricsData.get();

  if (savedLyricsData && !isDev) {
    try {
      if (savedLyricsData.startsWith("NO_LYRICS:")) {
        // Sentinel format is `NO_LYRICS:<uri>`. The uri itself contains colons,
        // so strip the prefix rather than splitting on ":".
        const savedUri = savedLyricsData.slice("NO_LYRICS:".length);
        if (savedUri === uri) {
          // Legacy negative entries have no source signature. Retry so a newly
          // enabled provider gets a chance to resolve the current track.
          $currentLyricsData.set("");
        }
      } else {
        const lyricsData = JSON.parse(savedLyricsData);
        // Return stored lyrics only when they match the current track. Prefer the
        // URI guard; fall back to id only for pre-uri cache entries.
        const isCurrentTrack = lyricsData?.uri === uri || (!lyricsData?.uri && lyricsData?.id === trackId);
        if (isCurrentTrack && lyricsData?.ProcessingPending !== true && isSourceCacheCompatible(lyricsData)) {
          const processed = await ensureProcessingVersion(trackId, uri, lyricsData, session);
          if (!session.isCurrent()) return null;
          const processedLyrics = processed.lyrics;
          $currentLyricsData.set(JSON.stringify(processedLyrics));
          presentLyrics(processedLyrics, session);
          if (processed.translationPending) {
            void finishTranslationInBackground(trackId, processedLyrics, session);
          }
          return [processedLyrics, 200];
        }
      }
    } catch (error) {
      lyricsCacheLogger.error("Error parsing saved lyrics data", error);
      HideLoaderContainer();
    }
  }

  const localLyric = await LocalLyricsManager.get(uri);
  if (!session.isCurrent()) return null;
  if (localLyric) {
    const lyricsData = { ...localLyric, uri };
    captureSourceTranslations(lyricsData);
    $currentLyricsData.set(JSON.stringify(lyricsData));
    presentLyrics(lyricsData, session);
    return [lyricsData, 200];
  }

  // Local files have no real track id (uri.split(":")[2] is the URL-encoded
  // artist name), so they can't be looked up in LyricsStore or fetched from the
  // API. Bail out here — after LocalLyricsManager.get() (which serves any
  // user-uploaded TTML) but before the meaningless remote cache read.
  if (uri.startsWith("spotify:local:")) {
    return ["local-track", 400];
  }

  if (LyricsStore) {
    try {
      const lyricsFromCacheRes = await LyricsStore.GetItem(trackId);
      if (lyricsFromCacheRes) {
        if (lyricsFromCacheRes?.Value === "NO_LYRICS" || !isSourceCacheCompatible(lyricsFromCacheRes)) {
          await LyricsStore.RemoveItem(trackId);
        } else {
        // Tag the cached payload with the current uri so the saved-data and
        // re-fetch checks (which match on uri) recognise it — older cache
        // entries predate the uri field.
        const processed = await ensureProcessingVersion(trackId, uri, {
          ...lyricsFromCacheRes,
          uri,
        }, session);
        if (!session.isCurrent()) return null;
        const lyricsFromCache = processed.lyrics;
        $currentLyricsData.set(JSON.stringify(lyricsFromCache));
        presentLyrics(lyricsFromCache, session);
        if (processed.translationPending) {
          void finishTranslationInBackground(trackId, lyricsFromCache, session);
        }
        return [{ ...lyricsFromCache, fromCache: true }, 200];
        }
      }
    } catch (error) {
      lyricsCacheLogger.error("Error parsing cache entry", error);
      return ["unknown-error", 0];
    }
  }


  if (!navigator.onLine) {
    return ["offline", 400];
  }

  ShowLoaderContainer();

  // Fetch new lyrics if no match in localStorage
  /* const lyricsApi = storage.get("customLyricsApi") ?? Defaults.LyricsContent.api.url;
    const lyricsAccessToken = storage.get("lyricsApiAccessToken") ?? Defaults.LyricsContent.api.accessToken; */

  try {
    const providers = getActiveLyricsSourceOrder();
    lyricsLogger.debug("Provider lyrics query", { trackId, providers });
    const providerResult = await fetchLyricsFromProviders(uri, providers, session.signal);
    if (!session.isCurrent()) return null;

    if (providerResult?.status === 503) {
      // The server accepted the request but hasn't processed it yet — it's
      // queued. Surface the queue loader immediately and hand off to the retry
      // loop, which keeps polling with backoff (and survives page close / view
      // swaps). We deliberately leave the loader up and return a sentinel so no
      // error notice is rendered.
      LyricsQueueRetry.HandleQueued(uri);
      return ["lyrics-queued", 503];
    }

    if (!providerResult || providerResult.status !== 200) {
      HideLoaderContainer();
      return ["lyrics-not-found", 404];
    }

    const lyrics = providerResult.lyrics as any;

    if (lyrics === null || lyrics === undefined || lyrics === "") {
      HideLoaderContainer();
      return ["lyrics-not-found", 404];
    }

    // Stamp the uri so every match downstream (saved-data, re-fetch, cache)
    // keys off the stable uri instead of the API-supplied id.
    lyrics.uri = uri;
    lyrics.id = trackId;
    lyrics.LyricsSourceCacheSignature = lyricsSourceCacheSignature();
    lyrics.DetectedChinese = detectChineseQuick(lyrics);
    captureSourceTranslations(lyrics);
    const needsRomanization = hasRomanizationWorkQuick(lyrics);
    const needsTranslation = hasTranslationWorkQuick(lyrics);

    if (!needsRomanization && !needsTranslation) {
      markProcessedWithoutBackground(lyrics);
      await setProcessedLyricsStoreItem(trackId, lyrics, session);
      if (!session.isCurrent()) return null;
      $currentLyricsData.set(JSON.stringify(lyrics));
      presentLyrics(lyrics, session);
      return [{ ...lyrics, fromCache: false }, 200];
    }

    lyrics.ProcessingPending = true;
    lyrics.RomanizationPending = needsRomanization;
    lyrics.TranslationPending = needsTranslation;
    $currentLyricsData.set(JSON.stringify(lyrics));

    presentLyrics(lyrics, session);
    void finishProcessingInBackground(trackId, lyrics, session);
    return [{ ...lyrics, fromCache: false }, 200];
  } catch (error) {
    lyricsLogger.error("Error fetching lyrics", error);
    HideLoaderContainer();
    return ["unknown-error", 0];
  }
}

export default function fetchLyrics(uri: string): Promise<FetchLyricsResult> {
  return foregroundLyricsRequests.run(uri, async (session) => {
    $currentlyFetching.set(true);
    try {
      return await fetchLyricsForSession(uri, session);
    } finally {
      if (session.isCurrent()) $currentlyFetching.set(false);
    }
  });
}

let ContainerShowLoaderTimeout: ReturnType<typeof setTimeout> | null = null;

/** Default copy shown in the loader while a lyrics request is queued (HTTP 503). */
export const LYRICS_QUEUE_MESSAGE =
  "Your request is in the queue — hang tight, your lyrics are on the way!";

/**
 * Show the loader container after a delay
 */
function ShowLoaderContainer(): void {
  const loaderContainer = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .loaderContainer"
  );
  if (loaderContainer) {
    ContainerShowLoaderTimeout = setTimeout(() => {
      loaderContainer.classList.add("active");
    }, 2000);
  }
}

/**
 * Immediately reveal the loader with a "request queued" message. Used for the
 * HTTP 503 server-queue state, where we want instant feedback (no 2s delay)
 * plus a note explaining the wait. Idempotent and safe to call when the page is
 * closed (no-ops if there's no loader in the current DOM).
 */
export function ShowQueueLoader(message: string = LYRICS_QUEUE_MESSAGE): void {
  const loaderContainer = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .loaderContainer"
  );
  if (!loaderContainer) return;

  // We're showing now, so cancel the delayed plain-loader reveal.
  if (ContainerShowLoaderTimeout) {
    clearTimeout(ContainerShowLoaderTimeout);
    ContainerShowLoaderTimeout = null;
  }

  loaderContainer.classList.add("active", "queued");

  let messageEl = loaderContainer.querySelector<HTMLElement>(".loaderMessage");
  if (!messageEl) {
    messageEl = document.createElement("div");
    messageEl.className = "loaderMessage";
    loaderContainer.appendChild(messageEl);
  }
  messageEl.textContent = message;
}

/**
 * Hide the loader container and clear any pending timeout
 */
function HideLoaderContainer(): void {
  const loaderContainer = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .loaderContainer"
  );
  if (loaderContainer) {
    if (ContainerShowLoaderTimeout) {
      clearTimeout(ContainerShowLoaderTimeout);
      ContainerShowLoaderTimeout = null;
    }
    loaderContainer.classList.remove("active", "queued");
    loaderContainer.querySelector(".loaderMessage")?.remove();
  }
}

/**
 * Clear the lyrics container content
 */
export function ClearLyricsPageContainer(): void {
  const lyricsContent = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .LyricsContent"
  );
  if (lyricsContent) {
    lyricsContent.innerHTML = "";
  }
}
