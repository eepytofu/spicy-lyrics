import { useStore } from "@nanostores/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { SpotifyPlayer } from "../Global/SpotifyPlayer.ts";
import { useCurrentUri } from "./LyricsManager/hooks/useCurrentUri.ts";
import {
  getLyricsCandidateSession,
  loadLyricsCandidates,
  searchLyricsCandidates,
  type LyricsCandidateFailure,
  type LyricsCandidateRecord,
  type LyricsCandidateSession,
} from "../../utils/Lyrics/ExternalSources.ts";
import { returnToAutomaticLyrics, useLyricsCandidate } from "../../utils/Lyrics/fetchLyrics.ts";
import ApplyLyrics from "../../utils/Lyrics/Global/Applyer.ts";
import { getActiveLyricsSourceOrder } from "../../utils/Lyrics/LyricsSourceConfiguration.ts";
import {
  completeLyricsSearchOverrides,
  manualLyricsSearchProviders,
  normalizeLyricsSearchOverrides,
  type CompleteLyricsSearchOverrides,
} from "../../utils/Lyrics/ManualLyricsSearch.ts";
import { resolveLyricsSourceLabel } from "../../utils/Lyrics/LyricsSourcePreferences.ts";
import { chooserCandidateRecords } from "../../utils/Lyrics/LyricsCandidateDisplay.ts";
import { $currentLyricsData, $developerMode } from "../../utils/stores.ts";

type CurrentLyrics = {
  uri?: string;
  Type?: string;
  source?: string;
  sourceDisplayName?: string;
  fetchProvider?: string;
  ManualLyricsSelection?: boolean;
  ManualLyricsSearchOverrides?: CompleteLyricsSearchOverrides;
  AutomaticLyricRevisionId?: string;
  LyricRevision?: LyricsCandidateRecord["revision"];
  SourceMatch?: LyricsCandidateRecord["result"]["match"];
  SelectionDiagnostics?: {
    candidates?: LyricsCandidateRecord["assessment"][];
  };
};

type RequestKind = "initial" | "search";

function parseCurrentLyrics(raw: string, uri: string): CurrentLyrics | null {
  if (!raw || raw.startsWith("NO_LYRICS:")) return null;
  try {
    const lyrics = JSON.parse(raw) as CurrentLyrics;
    return lyrics.uri === uri ? lyrics : null;
  } catch {
    return null;
  }
}

function sourceLabel(lyrics: CurrentLyrics | LyricsCandidateRecord["result"]["lyrics"]): string {
  return (
    resolveLyricsSourceLabel(lyrics?.source, lyrics?.sourceDisplayName, lyrics?.fetchProvider) ??
    "Unknown source"
  );
}

function formatLabel(type: string | undefined): string {
  if (type === "Syllable") return "Syllable synced";
  if (type === "Line") return "Line synced";
  if (type === "Static") return "Static";
  return "Unknown timing";
}

function failureLabel(failure: LyricsCandidateFailure): string {
  if (failure.kind === "no-match") return "No match";
  if (failure.kind === "queued") return "Still processing";
  if (failure.kind === "rate-limited") return "Rate limited";
  if (failure.kind === "upstream-error") {
    return failure.status ? `Upstream error ${failure.status}` : "Upstream error";
  }
  if (failure.kind === "timeout") return "Timed out";
  if (failure.kind === "aborted") return "Cancelled";
  return "Request failed";
}

function groupFailures(failures: LyricsCandidateFailure[]) {
  const groups = new Map<string, string[]>();
  for (const failure of failures) {
    const label = failureLabel(failure);
    const providers = groups.get(label) ?? [];
    providers.push(resolveLyricsSourceLabel(failure.provider) ?? failure.provider);
    groups.set(label, providers);
  }
  return [...groups].map(([label, providers]) => ({ label, providers }));
}

function candidateMetadata(
  record: LyricsCandidateRecord,
  fallback: { title: string; artist: string; album: string },
): { title: string; artist: string; album: string } {
  return {
    title: record.result.match?.title || fallback.title,
    artist: record.result.match?.artists?.join(", ") || fallback.artist,
    album: record.result.match?.album || fallback.album,
  };
}

function recommendedRecord(session: LyricsCandidateSession | null): LyricsCandidateRecord | null {
  if (!session?.recommendedRevisionId) return null;
  return session.records.find(
    (record) => record.revision.id === session.recommendedRevisionId,
  ) ?? null;
}

type QualitySignal = {
  label: string;
};

function qualitySignals(record: LyricsCandidateRecord): QualitySignal[] {
  const { signals } = record.assessment;
  const match: QualitySignal = {
    label:
      signals.trackMatch === "strong"
        ? "Strong track match"
        : signals.trackMatch === "weak"
          ? "Weak track match"
          : "Usable track match",
  };
  const timingDiverges = signals.timingConsistency === "divergent";
  const timingLabel =
    signals.timingHealth === "unavailable"
      ? "No synced timing"
      : signals.timingHealth === "healthy"
        ? "Healthy timing"
        : signals.timingHealth === "suspicious"
          ? "Suspicious timing"
          : "Usable timing";
  const timing: QualitySignal = {
    label: timingDiverges ? `${timingLabel}; differs from agreeing sources` : timingLabel,
  };
  const agreement: QualitySignal = {
    label:
      signals.lyricAgreement === "agreeing"
        ? "Agrees with other sources"
        : signals.lyricAgreement === "low"
          ? "Low lyric agreement"
          : "Agreement inconclusive",
  };
  return [match, timing, agreement];
}

function confidenceLabel(record: LyricsCandidateRecord): string {
  const confidence = record.assessment.signals.confidence;
  return `${confidence[0].toUpperCase()}${confidence.slice(1)} confidence`;
}

function LoadingRows() {
  return (
    <div className="sl-chooser-skeleton-list" aria-hidden="true">
      {[0, 1].map((index) => (
        <div className="sl-chooser-skeleton-row" key={index}>
          <span className="sl-chooser-skeleton-main">
            <span className="sl-chooser-skeleton-bar title" />
            <span className="sl-chooser-skeleton-bar metadata" />
          </span>
          <span className="sl-chooser-skeleton-source">
            <span className="sl-chooser-skeleton-bar provider" />
            <span className="sl-chooser-skeleton-bar sync" />
          </span>
          <span className="sl-chooser-skeleton-arrow" />
        </div>
      ))}
    </div>
  );
}

export default function LyricsChooser({ onClose }: { onClose: () => void }) {
  const uri = useCurrentUri() ?? SpotifyPlayer.GetUri() ?? "";
  const rawLyrics = useStore($currentLyricsData);
  const developerMode = useStore($developerMode);
  const current = useMemo(() => parseCurrentLyrics(rawLyrics, uri), [rawLyrics, uri]);
  const activeProviders = useMemo(() => getActiveLyricsSourceOrder(), [uri]);
  const searchableProviders = useMemo(
    () => manualLyricsSearchProviders(activeProviders),
    [activeProviders],
  );
  const spotifyTitle = SpotifyPlayer.GetName() ?? "";
  const spotifyArtist = SpotifyPlayer.GetArtists()?.map((entry) => entry.name).join(", ") ?? "";
  const spotifyAlbum = SpotifyPlayer.GetAlbumName() ?? "";
  const restoredSearchOverrides = current?.ManualLyricsSelection
    ? completeLyricsSearchOverrides(current.ManualLyricsSearchOverrides)
    : null;
  const [title, setTitle] = useState(restoredSearchOverrides?.title ?? spotifyTitle);
  const [artist, setArtist] = useState(restoredSearchOverrides?.artist ?? spotifyArtist);
  const [resultFallback, setResultFallback] = useState({
    title: spotifyTitle,
    artist: spotifyArtist,
    album: spotifyAlbum,
  });
  const [candidateSession, setCandidateSession] = useState<LyricsCandidateSession | null>(() =>
    uri ? getLyricsCandidateSession(uri) : null,
  );
  const [automaticRecord, setAutomaticRecord] = useState<LyricsCandidateRecord | null>(null);
  const [requestKind, setRequestKind] = useState<RequestKind | null>(null);
  const [busyRevisionId, setBusyRevisionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);

  const currentRevisionId = current?.LyricRevision?.id ?? candidateSession?.activeRevisionId ?? null;
  const automaticRevisionId =
    current?.AutomaticLyricRevisionId ??
    candidateSession?.automaticRevisionId ??
    currentRevisionId;

  function selectionContext() {
    return {
      automaticRevisionId: automaticRecord?.revision.id ?? automaticRevisionId,
      activeRevisionId: currentRevisionId,
    };
  }

  async function runCandidateRequest(
    kind: RequestKind,
    providers: typeof activeProviders,
    overrides?: { title?: string; artist?: string },
  ) {
    if (!uri || requestKind) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setRequestKind(kind);
    setError(null);
    try {
      const requestContext = kind === "initial"
        ? { activeRevisionId: currentRevisionId }
        : selectionContext();
      const next = overrides
        ? await searchLyricsCandidates(
            uri,
            providers,
            overrides,
            controller.signal,
            requestContext,
          )
        : await loadLyricsCandidates(
            uri,
            providers,
            controller.signal,
            requestContext,
          );
      if (controller.signal.aborted || SpotifyPlayer.GetUri() !== uri) return;
      setResultFallback({
        title: overrides?.title?.trim() || spotifyTitle,
        artist: overrides?.artist?.trim() || spotifyArtist,
        album: spotifyAlbum,
      });
      setCandidateSession(next);
      if (kind === "initial") setAutomaticRecord(recommendedRecord(next));
      if (!next) setError("No lyrics matched this search.");
    } catch {
      if (!controller.signal.aborted) setError("Could not search lyric sources. Try again.");
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setRequestKind(null);
      }
    }
  }

  useEffect(() => {
    requestController.current?.abort();
    requestController.current = null;
    const next = uri ? getLyricsCandidateSession(uri) : null;
    setCandidateSession(next);
    setAutomaticRecord(null);
    setTitle(restoredSearchOverrides?.title ?? SpotifyPlayer.GetName() ?? "");
    setArtist(
      restoredSearchOverrides?.artist
      ?? SpotifyPlayer.GetArtists()?.map((entry) => entry.name).join(", ")
      ?? "",
    );
    setResultFallback({
      title: SpotifyPlayer.GetName() ?? "",
      artist: SpotifyPlayer.GetArtists()?.map((entry) => entry.name).join(", ") ?? "",
      album: SpotifyPlayer.GetAlbumName() ?? "",
    });
    setRequestKind(null);
    setBusyRevisionId(null);
    setError(null);
    if (uri && (current?.ManualLyricsSelection === true || !next?.alternativesLoaded)) {
      void runCandidateRequest("initial", activeProviders);
    }
    return () => requestController.current?.abort();
    // The current URI is the lifetime boundary for this playback-scoped panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  useEffect(() => {
    if (!restoredSearchOverrides) return;
    setTitle(restoredSearchOverrides.title);
    setArtist(restoredSearchOverrides.artist);
  }, [uri, restoredSearchOverrides?.title, restoredSearchOverrides?.artist]);

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const overrides = normalizeLyricsSearchOverrides({ title, artist });
    if (!overrides.title || !overrides.artist) return;
    await runCandidateRequest("search", searchableProviders, overrides);
  }

  async function handleUse(record: LyricsCandidateRecord) {
    if (busyRevisionId || requestKind) return;
    setBusyRevisionId(record.revision.id);
    setError(null);
    try {
      const result = await useLyricsCandidate(record, candidateSession?.searchOverrides ?? null);
      if (!result) throw new Error("Candidate no longer belongs to the current track");
      await ApplyLyrics(result);
      onClose();
    } catch {
      setError(`Could not use ${sourceLabel(record.result.lyrics)}.`);
    } finally {
      setBusyRevisionId(null);
    }
  }

  async function handleReturnToAuto() {
    if (busyRevisionId || requestKind || !uri) return;
    setBusyRevisionId("auto");
    setError(null);
    try {
      const result = await returnToAutomaticLyrics(uri);
      if (!result) throw new Error("Automatic lyrics are unavailable");
      await ApplyLyrics(result);
      onClose();
    } catch {
      setError("Could not restore automatic selection.");
    } finally {
      setBusyRevisionId(null);
    }
  }

  const records = candidateSession?.records ?? [];
  const displayRecords = chooserCandidateRecords(records, current, automaticRecord);
  const currentManualProvider = current?.ManualLyricsSelection
    ? current.LyricRevision?.providerId || current.fetchProvider || current.source || null
    : null;
  const restoredOverrideFailure = candidateSession?.searchOverrides === null && currentManualProvider
    ? candidateSession.failures.find((failure) => failure.provider === currentManualProvider) ?? null
    : null;
  const failureGroups = groupFailures(
    (candidateSession?.failures ?? []).filter((failure) => failure !== restoredOverrideFailure),
  );

  return (
    <div className="sl-chooser-root">
      <form className="sl-chooser-search" onSubmit={(event) => void handleSearch(event)}>
        <label className="sl-chooser-field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            spellCheck={false}
          />
        </label>
        <label className="sl-chooser-field">
          <span>Artist</span>
          <input
            type="text"
            value={artist}
            onChange={(event) => setArtist(event.currentTarget.value)}
            spellCheck={false}
          />
        </label>
        <button
          type="submit"
          className="sl-sp-btn sl-chooser-search-button"
          disabled={
            requestKind !== null ||
            busyRevisionId !== null ||
            !title.trim() ||
            !artist.trim() ||
            searchableProviders.length === 0
          }
        >
          {requestKind === "search" ? "Searching…" : "Search"}
        </button>
      </form>

      <div
        className={`sl-chooser-progress${requestKind ? " active" : ""}`}
        role="progressbar"
        aria-label={requestKind === "search" ? "Searching lyrics" : "Loading lyric sources"}
        aria-hidden={requestKind ? undefined : true}
      />

      {error && <div className="sl-chooser-error" role="alert">{error}</div>}

      <div className="sl-chooser-results" aria-live="polite" aria-busy={requestKind !== null}>
        <div className="sl-chooser-list">
          {requestKind !== null && displayRecords.length === 0 ? <LoadingRows /> : displayRecords.map((record) => {
            const selected = record.revision.id === currentRevisionId;
            const automaticOption = current?.ManualLyricsSelection === true
              && record.revision.id === automaticRecord?.revision.id;
            const automatic = !automaticOption
              && record.revision.id === candidateSession?.recommendedRevisionId;
            const busy = automaticOption
              ? busyRevisionId === "auto"
              : record.revision.id === busyRevisionId;
            const unavailable = selected || busyRevisionId !== null || requestKind !== null;
            const metadata = candidateMetadata(record, resultFallback);
            const metadataLine = [metadata.artist, metadata.album].filter(Boolean).join(" · ");
            const signalSummary = qualitySignals(record).map((signal) => signal.label).join(", ");
            const confidence = confidenceLabel(record);
            const providerLabel = sourceLabel(record.result.lyrics);
            return (
              <button
                type="button"
                className={`sl-chooser-result${selected ? " selected" : ""}${automatic || automaticOption ? " automatic" : ""}`}
                key={record.revision.id}
                onClick={() => {
                  if (!unavailable) {
                    if (automaticOption) void handleReturnToAuto();
                    else void handleUse(record);
                  }
                }}
                aria-disabled={unavailable}
                aria-pressed={selected}
                aria-label={`${selected ? "Current" : automaticOption ? "Restore automatic" : "Select"} ${providerLabel} lyrics for ${metadata.title}. ${signalSummary}`}
                title={metadata.title}
              >
                <span className="sl-chooser-result-main">
                  <strong>{metadata.title}</strong>
                  <span className="sl-chooser-result-meta">
                    <small title={metadataLine}>{metadataLine || "Unknown artist"}</small>
                    {automaticOption ? (
                      <span className="sl-chooser-auto-badge">Automatic</span>
                    ) : automatic ? (
                      <span className="sl-chooser-auto-badge">Auto pick</span>
                    ) : null}
                  </span>
                </span>
                <span className="sl-chooser-result-source">
                  <span className="sl-chooser-result-provider">
                    <strong>{providerLabel}</strong>
                  </span>
                  <span className="sl-chooser-result-quality">
                    <small title={signalSummary}>
                      {formatLabel(record.result.lyrics.Type)}
                      <span aria-hidden="true"> · </span>
                      <span className={`sl-chooser-confidence sl-chooser-confidence--${record.assessment.signals.confidence}`}>
                        {confidence}
                      </span>
                    </small>
                  </span>
                </span>
                <span className="sl-chooser-result-action" aria-hidden="true">
                  {selected ? (
                    <>
                      <svg viewBox="0 0 16 16">
                        <path d="m3 8 3 3 7-7" />
                      </svg>
                      <span>Current</span>
                    </>
                  ) : busy ? (
                    <>
                      <span className="sl-chooser-spinner" />
                      <span>Applying</span>
                    </>
                  ) : (
                    <svg viewBox="0 0 16 16">
                      <path d="m6 3 5 5-5 5" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {!displayRecords.length && requestKind === null && (
          <div className="sl-chooser-empty">No lyrics found from searchable sources.</div>
        )}
      </div>

      <div className="sl-chooser-footer">
        <span>
          {requestKind === "initial"
            ? "Checking enabled lyric sources…"
            : requestKind === "search"
              ? "Searching enabled lyric sources…"
            : `${displayRecords.length} result${displayRecords.length === 1 ? "" : "s"}`}
        </span>
        {developerMode && (!!candidateSession?.failures.length || !!displayRecords.length) && (
          <details className="sl-chooser-diagnostics">
            <summary>Diagnostics</summary>
            <div className="sl-chooser-diagnostics-content">
              {restoredOverrideFailure && (
                <section>
                  <strong>Saved override</strong>
                  <ul>
                    <li>
                      <span>{resolveLyricsSourceLabel(restoredOverrideFailure.provider) ?? restoredOverrideFailure.provider}</span>
                      <span>
                        Restored from cache · auto lookup {failureLabel(restoredOverrideFailure).toLocaleLowerCase()}
                      </span>
                    </li>
                  </ul>
                </section>
              )}
              {!!failureGroups.length && (
                <section>
                  <strong>Unavailable sources</strong>
                  <ul>
                    {failureGroups.map((group) => (
                      <li className="sl-chooser-diagnostics-failure" key={group.label}>
                        <span>{group.providers.join(", ")}</span>
                        <span>{group.label}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {!!displayRecords.length && (
                <section>
                  <strong>Candidate scores</strong>
                  <ul>
                    {displayRecords.map((record) => (
                      <li key={record.revision.id}>
                        <span>{sourceLabel(record.result.lyrics)}</span>
                        <span>
                          score {record.assessment.selectionScore} · match {record.assessment.trackMatchScore} · timing {record.assessment.structuralTimingScore}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
