import { franc } from "franc-all";
import langs from "langs";
import { isDev } from "../../components/Global/Defaults.ts";
import {
  $currentLyricsData,
  $currentLyricsType,
  $currentlyFetching,
  $lyricsSelectionDiagnostics,
  $lyricsSelectionMode,
} from "../stores.ts";
import Platform from "../../components/Global/Platform.ts";
import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import PageView, { PageContainer } from "../../components/Pages/PageView.ts";
import { Query } from "../API/Query.ts";
import {
  LYRICS_PROCESSING_VERSION,
  ProcessLyrics,
  READING_PLAN_SCHEMA_VERSION,
} from "./ProcessLyrics.ts";
import { ARABIC_ROMANIZATION_ATTEMPT_VERSION } from "./Fork/ArabicRomanization.ts";
import {
  chineseTones,
  chineseTranslitMode,
  cyrillicKeepSigns,
  cyrillicRomanizationMode,
  joinMandarinWords,
  koreanDisplayMode,
  pinyinPlacement,
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
import { $chineseCharacterForm, $romanization } from "../uiState.ts";
import { buildProcessingContextKey } from "./ProcessingContext.ts";
import {
  clearLyricsCandidateSessionForTrackChange,
  fetchLyricsFromProviders,
  getLyricsCandidateSession,
  setActiveLyricsCandidateRevision,
  type LyricsCandidateRecord,
} from "./ExternalSources.ts";
import { publishLyricsInteropSnapshot } from "./Interop.ts";
import { isLyricsSourceCacheCompatible } from "./LyricsSourceCache.ts";
import { ensureSourceEvidence } from "./Processing/SourceEvidence.ts";
import { LyricsRequestCoordinator, type LyricsRequestSession } from "./LyricsRequestSession.ts";
import { ArabicTextTest, RomanizableScriptTextTest } from "./Fork/TextDetection.ts";
import { isChineseDocumentPendingReading } from "./Processing/PendingReadingPresentation.ts";
import {
  getActiveLyricsSourceOrder,
  lyricsSourceCacheSignature,
} from "./LyricsSourceConfiguration.ts";
import { ensureLyricRevision } from "./LyricRevision.ts";
import { isLyricsRevisionCacheCompatible, LyricsRevisionStore } from "./LyricsRevisionCache.ts";
import type { CompleteLyricsSearchOverrides } from "./ManualLyricsSearch.ts";
import { isNonLyricSemanticEntry } from "./VocalSemantics.ts";
import {
  automaticLyricsOverride,
  candidateLyricsOverride,
  clearLyricsOverrideSessionIfCurrent,
  getLyricsOverridePreference,
  isCurrentLyricsOverridePreference,
  localLyricsOverride,
  lyricsMatchOverridePreference,
  markLyricsOverridePreference,
  setLyricsOverridePreference,
  setLyricsOverrideSessionPreference,
  type CandidateLyricsOverride,
  type LyricsOverrideLifetime,
  type LyricsOverridePreference,
} from "./LyricsOverridePreference.ts";

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
export const LyricsStore = GetExpireStore<any>(
  "SpicyLyrics_LyricsStore_g1",
  2,
  {
    Unit: "Days",
    Duration: 3,
  },
  isDev as true
);

const lyricsPacker = new SLObjPack();

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
    pinyinPlacement,
    chineseCharacterForm: $chineseCharacterForm.get(),
    koreanDisplayMode,
    cyrillicRomanizationMode,
    cyrillicKeepSigns,
  });
}

async function setProcessedLyricsStoreItem(
  trackId: string,
  lyrics: any,
  session?: LyricsRequestSession,
  options: { persistTrack?: boolean } = {}
): Promise<void> {
  if (session && !session.isCurrent()) return;
  ensureSourceEvidence(lyrics);
  const revision = await ensureLyricRevision(lyrics.uri, lyrics);
  lyrics.ProcessingContextKey = currentProcessingContextKey();
  lyrics.ReadingPlanSchemaVersion = READING_PLAN_SCHEMA_VERSION;
  if (session && !session.isCurrent()) return;
  await LyricsRevisionStore.SetItem(revision.id, lyrics);
  if (options.persistTrack !== false) await LyricsStore.SetItem(trackId, lyrics);
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
  session: LyricsRequestSession
): void {
  if (!session.isCurrent() || SpotifyPlayer.GetId() !== trackId) return;
  ensureSourceEvidence(lyrics);
  setActiveLyricsCandidateRevision(lyrics.uri, lyrics?.LyricRevision?.id ?? null);
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
  persistTrack = true
): Promise<void> {
  try {
    await translateLyrics(lyrics, { signal: session.signal });
  } catch (error) {
    if (session.signal.aborted) return;
    lyricsCacheLogger.error("Background lyrics translation failed", error);
  }
  if (!session.isCurrent()) return;
  lyrics.TranslationPending = false;
  await setProcessedLyricsStoreItem(trackId, lyrics, session, { persistTrack });
  dispatchProcessingReady(trackId, lyrics, session);
}

async function finishProcessingInBackground(
  trackId: string,
  lyrics: any,
  session: LyricsRequestSession,
  persistTrack = true
): Promise<void> {
  const shouldTranslate = lyrics.TranslationPending === true;
  const shouldRerenderAfterRomanization = lyrics.RomanizationPending === true;

  try {
    await ProcessLyrics(lyrics, {
      awaitTranslation: false,
      signal: session.signal,
      allowRemoteRomanization: $romanization.get(),
    });
    if (!session.isCurrent()) return;
    lyrics.ProcessingPending = false;
    lyrics.RomanizationPending = false;
    lyrics.TranslationPending = shouldTranslate;
    await setProcessedLyricsStoreItem(trackId, lyrics, session, { persistTrack });
    if (shouldRerenderAfterRomanization) dispatchProcessingReady(trackId, lyrics, session);
  } catch (error) {
    lyrics.ProcessingPending = false;
    lyrics.RomanizationPending = false;
    lyrics.TranslationPending = false;
    lyricsCacheLogger.error("Background lyrics romanization failed", error);
    return;
  }

  if (!shouldTranslate) return;
  await finishTranslationInBackground(trackId, lyrics, session, persistTrack);
}

const NonAsciiLatinQuickTest = /[À-ÖØ-öø-ÿĀ-žƀ-ɏ]/;

function collectLyricsText(lyrics: any): string[] {
  const parts: string[] = [];
  if (lyrics?.Type === "Static") {
    for (const line of lyrics.Lines || []) {
      if (!isNonLyricSemanticEntry(line)) parts.push(line.Text || "");
    }
  } else if (lyrics?.Type === "Line") {
    for (const line of lyrics.Content || []) {
      if (isNonLyricSemanticEntry(line)) continue;
      parts.push(line.Text || "");
      for (const background of line.Background || []) parts.push(background.Text || "");
    }
  } else if (lyrics?.Type === "Syllable") {
    for (const group of lyrics.Content || []) {
      if (isNonLyricSemanticEntry(group.Lead)) continue;
      for (const syl of group.Lead?.Syllables || []) parts.push(syl.Text || "");
      for (const bg of group.Background || []) {
        for (const syl of bg.Syllables || []) parts.push(syl.Text || "");
      }
    }
  }
  return parts;
}

function detectChineseQuick(lyrics: any): boolean {
  return isChineseDocumentPendingReading(lyrics);
}

function hasRomanizationWorkQuick(lyrics: any): boolean {
  return RomanizableScriptTextTest.test(collectLyricsText(lyrics).join(""));
}

function hasRemoteRomanizationWorkQuick(lyrics: any): boolean {
  return (
    ArabicTextTest.test(collectLyricsText(lyrics).join("")) &&
    lyrics?.RemoteRomanizationAttemptVersion !== ARABIC_ROMANIZATION_ATTEMPT_VERSION
  );
}

function hasTranslationWorkQuick(lyrics: any): boolean {
  if (!translationEnabled || !translationTargetLang) return false;
  const text = collectLyricsText(lyrics).join(" ").trim();
  if (!text) return false;

  if (translationTargetLang === "en") {
    if (RomanizableScriptTextTest.test(text) || NonAsciiLatinQuickTest.test(text)) return true;
    const compact = text
      .replace(/[^\p{L}\s']/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
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
  setActiveLyricsCandidateRevision(lyricsData.uri, lyricsData?.LyricRevision?.id ?? null);
  $currentLyricsData.set(JSON.stringify(lyricsData));
  publishLyricsInteropSnapshot(lyricsData);
  $lyricsSelectionDiagnostics.set(lyricsData?.SelectionDiagnostics ?? null);
  // Lyrics are in hand — end any 503 retry loop that was running for this track.
  LyricsQueueRetry.NotifyResolved(lyricsData?.uri);
  setRomanizationClass(lyricsData?.HasTransliterations || lyricsData?.RomanizationPending);
  PageContainer?.classList.toggle("Lyrics_ChineseDetected", lyricsData?.DetectedChinese === true);
  PageContainer?.classList.toggle(
    "Lyrics_TranslationAvailable",
    lyricsData?.IncludesTranslation === true || lyricsData?.TranslationPending === true
  );
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
  persistTrack = true
): Promise<ProcessingVersionResult> {
  if (lyrics) {
    lyrics.uri = uri;
    lyrics.id = trackId;
    ensureSourceEvidence(lyrics);
    await ensureLyricRevision(uri, lyrics);
    normalizeProviderTranslations(lyrics);
  }

  if (!lyrics) return { lyrics, translationPending: false };

  const processingContextKey = currentProcessingContextKey();
  const needsRemoteRomanization = $romanization.get() && hasRemoteRomanizationWorkQuick(lyrics);

  // ProcessingPending === true means a previous session cached raw lyrics and
  // died before its background processing finished — treat as stale and
  // reprocess below instead of serving unprocessed lyrics forever.
  if (
    lyrics.ProcessingPending !== true &&
    lyrics.ProcessingVersion === LYRICS_PROCESSING_VERSION &&
    lyrics.ReadingPlanSchemaVersion === READING_PLAN_SCHEMA_VERSION &&
    lyrics.ProcessingContextKey === processingContextKey &&
    !needsRemoteRomanization
  ) {
    return {
      lyrics,
      translationPending: lyrics.TranslationPending === true,
    };
  }

  if (!hasRomanizationWorkQuick(lyrics) && !hasTranslationWorkQuick(lyrics)) {
    markProcessedWithoutBackground(lyrics);
    lyrics.id = lyrics.id || trackId;
    await setProcessedLyricsStoreItem(trackId, lyrics, session, { persistTrack });
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
  await ProcessLyrics(lyrics, {
    awaitTranslation: false,
    signal: session.signal,
    allowRemoteRomanization: $romanization.get(),
  });
  if (!session.isCurrent()) return { lyrics, translationPending: false };
  lyrics.ProcessingPending = false;
  lyrics.RomanizationPending = false;
  lyrics.TranslationPending = translationPending;
  await setProcessedLyricsStoreItem(trackId, lyrics, session, { persistTrack });
  return { lyrics, translationPending };
}

function candidateDiagnostics(uri: string, selectedProvider: string): any {
  const candidateSession = getLyricsCandidateSession(uri);
  if (!candidateSession) return null;
  return {
    mode: $lyricsSelectionMode.get(),
    selectedProvider,
    candidates: candidateSession.records.map((record) => record.assessment),
  };
}

async function processFreshLyrics(
  trackId: string,
  uri: string,
  lyrics: any,
  session: LyricsRequestSession,
  options: {
    persistTrack?: boolean;
    manualSelection?: boolean;
    automaticRevisionId?: string | null;
    searchOverrides?: CompleteLyricsSearchOverrides | null;
    overridePreference?: LyricsOverridePreference | null;
  } = {}
): Promise<FetchLyricsResult> {
  lyrics.uri = uri;
  lyrics.id = trackId;
  markLyricsOverridePreference(lyrics, options.overridePreference ?? null);
  lyrics.LyricsSourceCacheSignature = lyricsSourceCacheSignature();
  const revision = await ensureLyricRevision(uri, lyrics);
  lyrics.ManualLyricsSelection = options.manualSelection === true;
  lyrics.AutomaticLyricRevisionId = options.automaticRevisionId ?? revision.id;
  if (options.manualSelection && options.searchOverrides) {
    lyrics.ManualLyricsSearchOverrides = options.searchOverrides;
  } else {
    delete lyrics.ManualLyricsSearchOverrides;
  }
  lyrics.DetectedChinese = detectChineseQuick(lyrics);
  captureSourceTranslations(lyrics);
  const needsRomanization = hasRomanizationWorkQuick(lyrics);
  const needsTranslation = hasTranslationWorkQuick(lyrics);
  const persistTrack = options.persistTrack !== false;

  if (!needsRomanization && !needsTranslation) {
    markProcessedWithoutBackground(lyrics);
    await setProcessedLyricsStoreItem(trackId, lyrics, session, { persistTrack });
    if (!session.isCurrent()) return null;
    presentLyrics(lyrics, session);
    return [{ ...lyrics, fromCache: false }, 200];
  }

  lyrics.ProcessingPending = true;
  lyrics.RomanizationPending = needsRomanization;
  lyrics.TranslationPending = needsTranslation;
  presentLyrics(lyrics, session);
  void finishProcessingInBackground(trackId, lyrics, session, persistTrack);
  return [{ ...lyrics, fromCache: false }, 200];
}

type OverrideRestore =
  | { handled: false; preference: LyricsOverridePreference | null }
  | { handled: true; result: FetchLyricsResult };

async function restoreLyricsOverrideForSession(
  trackId: string,
  uri: string,
  session: LyricsRequestSession,
  preference: LyricsOverridePreference | null
): Promise<OverrideRestore> {
  if (!preference || preference.kind === "automatic") {
    return { handled: false, preference };
  }
  if (preference.kind === "local") {
    const rawSource = preference.rawSource ?? (await LocalLyricsManager.getRaw(uri));
    if (!session.isCurrent()) return { handled: true, result: null };
    const localLyrics = LocalLyricsManager.parseRaw(rawSource);
    if (!localLyrics) {
      const automatic = automaticLyricsOverride(uri);
      await setLyricsOverridePreference(automatic);
      return { handled: false, preference: automatic };
    }
    return {
      handled: true,
      result: await processFreshLyrics(trackId, uri, localLyrics, session, {
        persistTrack: false,
        overridePreference: preference,
      }),
    };
  }

  const cached = isLyricsRevisionCacheCompatible(preference.snapshot, preference.revisionId)
    ? preference.snapshot
    : await LyricsRevisionStore.GetItem(preference.revisionId);
  if (!session.isCurrent()) return { handled: true, result: null };
  if (!isLyricsRevisionCacheCompatible(cached, preference.revisionId) || cached?.uri !== uri) {
    const automatic = automaticLyricsOverride(uri);
    await setLyricsOverridePreference(automatic);
    return { handled: false, preference: automatic };
  }

  const lyrics = structuredClone(cached);
  lyrics.ManualLyricsSelection = true;
  lyrics.AutomaticLyricRevisionId = preference.automaticRevisionId;
  markLyricsOverridePreference(lyrics, preference);
  if (preference.searchOverrides) {
    lyrics.ManualLyricsSearchOverrides = preference.searchOverrides;
  } else {
    delete lyrics.ManualLyricsSearchOverrides;
  }
  const processed = await ensureProcessingVersion(trackId, uri, lyrics, session, false);
  if (!session.isCurrent()) return { handled: true, result: null };
  presentLyrics(processed.lyrics, session);
  if (processed.translationPending) {
    void finishTranslationInBackground(trackId, processed.lyrics, session, false);
  }
  return { handled: true, result: [{ ...processed.lyrics, fromCache: true }, 200] };
}

async function activateLyricsCandidateForSession(
  record: LyricsCandidateRecord,
  session: LyricsRequestSession,
  searchOverrides: CompleteLyricsSearchOverrides | null,
  preference: CandidateLyricsOverride
): Promise<FetchLyricsResult> {
  const uri = record.revision.trackUri;
  const trackId = uri.split(":")[2];
  if (!trackId || SpotifyPlayer.GetUri() !== uri) return null;
  const automaticRevisionId = preference.automaticRevisionId;
  const diagnostics = candidateDiagnostics(uri, record.provider);

  const cached = await LyricsRevisionStore.GetItem(record.revision.id);
  if (!session.isCurrent()) return null;
  let result: FetchLyricsResult;
  if (isLyricsRevisionCacheCompatible(cached, record.revision.id)) {
    const lyrics = structuredClone(cached);
    markLyricsOverridePreference(lyrics, preference);
    lyrics.ManualLyricsSelection = true;
    lyrics.AutomaticLyricRevisionId = automaticRevisionId;
    if (searchOverrides) lyrics.ManualLyricsSearchOverrides = searchOverrides;
    else delete lyrics.ManualLyricsSearchOverrides;
    if (diagnostics) lyrics.SelectionDiagnostics = diagnostics;
    const processed = await ensureProcessingVersion(trackId, uri, lyrics, session, false);
    if (!session.isCurrent()) return null;
    presentLyrics(processed.lyrics, session);
    if (processed.translationPending) {
      void finishTranslationInBackground(trackId, processed.lyrics, session, false);
    }
    result = [{ ...processed.lyrics, fromCache: true }, 200];
  } else {
    const lyrics = structuredClone(record.result.lyrics);
    if (diagnostics) lyrics.SelectionDiagnostics = diagnostics;
    result = await processFreshLyrics(trackId, uri, lyrics, session, {
      persistTrack: false,
      manualSelection: true,
      automaticRevisionId,
      searchOverrides,
      overridePreference: preference,
    });
  }

  if (!result || !session.isCurrent()) return result;
  preference.snapshot = structuredClone(result[0] as Record<string, unknown>);
  await setLyricsOverridePreference(preference);
  return result;
}

export function useLyricsCandidate(
  record: LyricsCandidateRecord,
  searchOverrides: CompleteLyricsSearchOverrides | null = null,
  lifetime: LyricsOverrideLifetime = "persistent"
): Promise<FetchLyricsResult> {
  return foregroundLyricsRequests.run(record.revision.trackUri, async (session) => {
    $currentlyFetching.set(true);
    try {
      const candidateSession = getLyricsCandidateSession(record.revision.trackUri);
      const preference = candidateLyricsOverride(record.revision.trackUri, lifetime, {
        revisionId: record.revision.id,
        automaticRevisionId: candidateSession?.automaticRevisionId ?? record.revision.id,
        ...(searchOverrides ? { searchOverrides } : {}),
        snapshot: structuredClone(record.result.lyrics),
      });
      return await activateLyricsCandidateForSession(record, session, searchOverrides, preference);
    } finally {
      if (session.isCurrent()) $currentlyFetching.set(false);
    }
  });
}

export async function returnToAutomaticLyrics(
  uri = SpotifyPlayer.GetUri()
): Promise<FetchLyricsResult> {
  if (!uri) return null;
  await setLyricsOverridePreference(automaticLyricsOverride(uri));
  invalidateLyricsPipeline();
  setActiveLyricsCandidateRevision(uri, null);
  $currentLyricsData.set("");
  return fetchLyrics(uri);
}

export async function useLocalLyricsOverride(
  uri: string,
  rawSource: unknown,
  lifetime: LyricsOverrideLifetime = "persistent",
  options: { previousPreference?: LyricsOverridePreference | null } = {}
): Promise<FetchLyricsResult> {
  if (SpotifyPlayer.GetUri() !== uri || !LocalLyricsManager.parseRaw(rawSource)) return null;
  const previous =
    "previousPreference" in options
      ? (options.previousPreference ?? null)
      : await getLyricsOverridePreference(uri);
  if (SpotifyPlayer.GetUri() !== uri) return null;
  const preference = localLyricsOverride(uri, lifetime, rawSource);
  setLyricsOverrideSessionPreference(preference);
  invalidateLyricsPipeline();
  setActiveLyricsCandidateRevision(uri, null);
  $currentLyricsData.set("");
  const result = await fetchLyrics(uri);
  if (
    result &&
    SpotifyPlayer.GetUri() === uri &&
    isCurrentLyricsOverridePreference(uri, preference.preferenceId)
  ) {
    if (lifetime === "persistent") {
      try {
        await setLyricsOverridePreference(preference);
      } catch (error) {
        if (isCurrentLyricsOverridePreference(uri, preference.preferenceId)) {
          if (previous) await setLyricsOverridePreference(previous);
          else clearLyricsOverrideSessionIfCurrent(uri, preference.preferenceId);
        }
        throw error;
      }
    }
    return result;
  }
  if (isCurrentLyricsOverridePreference(uri, preference.preferenceId)) {
    if (previous) await setLyricsOverridePreference(previous);
    else clearLyricsOverrideSessionIfCurrent(uri, preference.preferenceId);
  }
  return null;
}

export async function PrefetchLyrics(uri: string): Promise<void> {
  const trackId = uri?.split(":")?.[2];
  if (!trackId || uri.startsWith("spotify:local:")) return;
  if (prefetchInFlight.has(trackId)) return;
  const preference = await getLyricsOverridePreference(uri);
  if (preference?.kind === "candidate") return;

  try {
    if (preference?.kind === "local") {
      const rawSource = preference.rawSource ?? (await LocalLyricsManager.getRaw(uri));
      const localLyrics = LocalLyricsManager.parseRaw(rawSource);
      if (!localLyrics) return;
      const lyrics = { ...localLyrics, id: trackId, uri };
      markLyricsOverridePreference(lyrics, preference);
      captureSourceTranslations(lyrics);
      if (hasRomanizationWorkQuick(lyrics) || hasTranslationWorkQuick(lyrics)) {
        await ProcessLyrics(lyrics, { allowRemoteRomanization: $romanization.get() });
      } else {
        markProcessedWithoutBackground(lyrics);
      }
      await setProcessedLyricsStoreItem(trackId, lyrics, undefined, { persistTrack: false });
      return;
    }
    const cached = await LyricsStore.GetItem(trackId);
    if (cached && (!isSourceCacheCompatible(cached) || cached?.source === "ldb")) {
      await LyricsStore.RemoveItem(trackId);
    } else if (cached) return;
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
      await ProcessLyrics(lyrics, {
        allowRemoteRomanization: $romanization.get(),
      });
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
  session: LyricsRequestSession
): Promise<FetchLyricsResult> {
  lyricsLogger.debug("Fetch requested", uri);
  clearLyricsCandidateSessionForTrackChange(uri);
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

  if (mediaType && mediaType !== "audio") {
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
  const resolvedOverride = await getLyricsOverridePreference(uri);
  if (!session.isCurrent()) return null;

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
          // The current negative sentinel has no source signature. Retry so a
          // newly enabled provider gets a chance to resolve the current track.
          $currentLyricsData.set("");
        }
      } else {
        const lyricsData = JSON.parse(savedLyricsData);
        const isCurrentTrack = lyricsData?.uri === uri;
        if (
          isCurrentTrack &&
          lyricsData?.ProcessingPending !== true &&
          isSourceCacheCompatible(lyricsData) &&
          lyricsMatchOverridePreference(lyricsData, resolvedOverride)
        ) {
          const persistTrack = lyricsData?.ManualLyricsSelection !== true;
          const processed = await ensureProcessingVersion(
            trackId,
            uri,
            lyricsData,
            session,
            persistTrack
          );
          if (!session.isCurrent()) return null;
          const processedLyrics = processed.lyrics;
          presentLyrics(processedLyrics, session);
          if (processed.translationPending) {
            void finishTranslationInBackground(trackId, processedLyrics, session, persistTrack);
          }
          return [processedLyrics, 200];
        }
      }
    } catch (error) {
      lyricsCacheLogger.error("Error parsing saved lyrics data", error);
      HideLoaderContainer();
    }
  }

  const override = await restoreLyricsOverrideForSession(trackId, uri, session, resolvedOverride);
  if (override.handled) return override.result;
  const automaticPreference = override.preference;

  // Local files have no real track id (uri.split(":")[2] is the URL-encoded
  // artist name), so they can't be looked up in LyricsStore or fetched from the
  // API. Bail out here — after LocalLyricsManager.get() (which serves any
  // user-uploaded lyrics) but before the meaningless remote cache read.
  if (uri.startsWith("spotify:local:")) {
    return ["local-track", 400];
  }

  if (LyricsStore) {
    try {
      const lyricsFromCacheRes = await LyricsStore.GetItem(trackId);
      if (lyricsFromCacheRes) {
        if (
          !isSourceCacheCompatible(lyricsFromCacheRes) ||
          lyricsFromCacheRes?.source === "ldb" ||
          lyricsFromCacheRes?.ManualLyricsSelection === true
        ) {
          await LyricsStore.RemoveItem(trackId);
        } else {
          markLyricsOverridePreference(lyricsFromCacheRes, automaticPreference);
          const processed = await ensureProcessingVersion(
            trackId,
            uri,
            lyricsFromCacheRes,
            session
          );
          if (!session.isCurrent()) return null;
          const lyricsFromCache = processed.lyrics;
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

    return processFreshLyrics(trackId, uri, lyrics, session, {
      overridePreference: automaticPreference,
    });
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
