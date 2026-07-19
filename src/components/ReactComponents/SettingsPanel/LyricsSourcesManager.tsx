import { useStore } from "@nanostores/react";
import React, { useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_DISABLED_LYRICS_SOURCES,
  DEFAULT_LYRICS_SOURCE_ORDER,
  getLyricsSourceDefinition,
  normalizeLyricsServerUrl,
  normalizeDisabledLyricsSourceIds,
  normalizeLyricsSourceOrder,
  parseCustomLyricsServers,
  stringifyDisabledLyricsSourceIds,
  stringifyLyricsSourceOrder,
  type CustomLyricsServer,
  type LyricsSourceProviderId,
} from "../../../utils/Lyrics/LyricsSourcePreferences.ts";
import {
  $customLyricsServers,
  $disabledLyricsSources,
  $externalLyricsWorkerUrl,
  $ignoreMusixmatchWordSync,
  $lyricsSelectionDiagnostics,
  $lyricsSelectionMode,
  $lyricsSourceOrder,
  $musixmatchToken,
  $prioritizeAppleMusicQuality,
} from "../../../utils/stores.ts";
import { refreshMusixmatchToken } from "../../../utils/Lyrics/ExternalSources.ts";
import { commitSourceSettingsChange } from "../../../utils/Lyrics/SourceSettingsRefresh.ts";
import { Select, Toggle } from "./components.tsx";

export default function LyricsSourcesManager() {
  const storedOrder = useStore($lyricsSourceOrder);
  const storedDisabled = useStore($disabledLyricsSources);
  const workerUrl = useStore($externalLyricsWorkerUrl);
  const customJson = useStore($customLyricsServers);
  const ignoreMusixmatchWordSync = useStore($ignoreMusixmatchWordSync);
  const prioritizeAppleMusicQuality = useStore($prioritizeAppleMusicQuality);
  const lyricsSelectionMode = useStore($lyricsSelectionMode);
  const selectionDiagnostics = useStore($lyricsSelectionDiagnostics);
  const musixmatchToken = useStore($musixmatchToken);
  const customServers = parseCustomLyricsServers(customJson);
  const order = normalizeLyricsSourceOrder(storedOrder, customServers);
  const disabledIds = new Set(normalizeDisabledLyricsSourceIds(storedDisabled, customServers));
  const [expandedOptions, setExpandedOptions] = useState<Set<LyricsSourceProviderId>>(new Set());
  const [addingCustomSource, setAddingCustomSource] = useState(false);
  const [serverName, setServerName] = useState("");
  const [serverUrl, setServerUrl] = useState("");

  const closeCustomSourceForm = () => {
    setAddingCustomSource(false);
    setServerName("");
    setServerUrl("");
  };

  const setOrder = (nextOrder: LyricsSourceProviderId[]) => {
    $lyricsSourceOrder.set(stringifyLyricsSourceOrder(nextOrder));
    commitSourceSettingsChange();
  };

  const setDisabled = (nextDisabled: Set<LyricsSourceProviderId>) => {
    $disabledLyricsSources.set(stringifyDisabledLyricsSourceIds([...nextDisabled]));
    commitSourceSettingsChange();
  };

  const moveSource = (id: LyricsSourceProviderId, direction: -1 | 1) => {
    const currentIndex = order.indexOf(id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const nextOrder = [...order];
    [nextOrder[currentIndex], nextOrder[nextIndex]] = [
      nextOrder[nextIndex],
      nextOrder[currentIndex],
    ];
    setOrder(nextOrder);
  };

  const setSourceEnabled = (id: LyricsSourceProviderId, enabled: boolean) => {
    const nextDisabled = new Set(disabledIds);
    if (enabled) nextDisabled.delete(id);
    else nextDisabled.add(id);
    setDisabled(nextDisabled);
  };

  const resetSources = () => {
    setOrder(DEFAULT_LYRICS_SOURCE_ORDER);
    setDisabled(new Set(DEFAULT_DISABLED_LYRICS_SOURCES));
  };

  const refreshToken = async () => {
    const token = await refreshMusixmatchToken(true);
    if (token) {
      commitSourceSettingsChange();
      toast.success("Musixmatch token refreshed.", { duration: 3000 });
    } else toast.error("Failed to refresh Musixmatch token.", { duration: 4000 });
  };

  const addCustomSource = () => {
    const name = serverName.trim();
    const url = normalizeLyricsServerUrl(serverUrl);
    if (!name || !url) {
      toast.error("Enter a name and valid HTTPS URL. HTTP is allowed for localhost.");
      return;
    }
    if (customServers.some((server) => server.url === url)) {
      toast.error("That server URL is already configured.");
      return;
    }
    const id = `custom:${globalThis.crypto?.randomUUID?.() ?? Date.now()}` as const;
    const next: CustomLyricsServer[] = [...customServers, { id, name, url }];
    $customLyricsServers.set(JSON.stringify(next));
    setOrder([...order, id]);
    closeCustomSourceForm();
    toast.success(`${name} added.`);
  };

  const removeCustomSource = (id: LyricsSourceProviderId) => {
    $customLyricsServers.set(JSON.stringify(customServers.filter((server) => server.id !== id)));
    setOrder(order.filter((entry) => entry !== id));
    const nextDisabled = new Set(disabledIds);
    nextDisabled.delete(id);
    setDisabled(nextDisabled);
  };

  const optionCounts: Partial<Record<LyricsSourceProviderId, number>> = { musixmatch: 2, apple: 1 };
  const sourceLabel = (provider: string) =>
    getLyricsSourceDefinition(provider as LyricsSourceProviderId, customServers).label;
  const selectedSourceLabel = selectionDiagnostics?.selectedProvider
    ? sourceLabel(selectionDiagnostics.selectedProvider)
    : "none";
  const selectionModeLabel =
    (
      { smart: "Smart Match", syncType: "Sync Type First", strict: "Strict Priority" } as Record<
        string,
        string
      >
    )[selectionDiagnostics?.mode ?? ""] ?? "Unknown mode";
  const selectionSummary = selectionDiagnostics
    ? selectionDiagnostics.candidates
        .slice()
        .sort((left, right) => right.selectionScore - left.selectionScore)
        .slice(0, 3)
        .map(
          (candidate) =>
            `${sourceLabel(candidate.provider)} score ${candidate.selectionScore}: ${candidate.reasons.join(", ")}`
        )
        .join(" | ")
    : "";
  const toggleOptions = (id: LyricsSourceProviderId) => {
    setExpandedOptions((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="sl-sp-source-manager">
      <div className="sl-sp-source-option-row sl-sp-source-worker-row">
        <div className="sl-sp-source-copy">
          <span className="sl-sp-source-label">External Sources Worker</span>
          <span className="sl-sp-source-description">
            Used by AMLL TTML DB, QQ Music, KuGou, and NetEase Cloud Music. Paste the Worker origin
            only.
          </span>
        </div>
        <input
          className="sl-sp-text-input sl-sp-source-worker-input"
          value={workerUrl}
          onChange={(event) => $externalLyricsWorkerUrl.set(event.currentTarget.value)}
          onBlur={(event) => {
            const url = normalizeLyricsServerUrl(event.currentTarget.value);
            if (url) $externalLyricsWorkerUrl.set(url);
            commitSourceSettingsChange();
          }}
          placeholder="https://lyrics.example.workers.dev"
          spellCheck={false}
          aria-label="External Sources Worker URL"
        />
      </div>
      <div className="sl-sp-source-option-row">
        <div className="sl-sp-source-copy">
          <span className="sl-sp-source-label">Selection Mode</span>
          <span className="sl-sp-source-description">
            Smart Match checks track confidence, timing health, and lyric agreement before using
            sync detail and source order.
          </span>
        </div>
        <Select
          value={lyricsSelectionMode}
          options={["smart", "syncType", "strict"]}
          labels={["Smart Match", "Sync Type First", "Strict Priority"]}
          aria-label="Lyrics selection mode"
          onChange={(value) => {
            $lyricsSelectionMode.set(value as typeof lyricsSelectionMode);
            commitSourceSettingsChange();
          }}
        />
      </div>

      {selectionDiagnostics && (
        <div className="sl-sp-source-option-row">
          <div className="sl-sp-source-copy">
            <span className="sl-sp-source-label">Last Selection</span>
            <span className="sl-sp-source-description">
              Selected: {selectedSourceLabel} | {selectionModeLabel} | {selectionSummary}
            </span>
          </div>
        </div>
      )}

      <div className="sl-sp-source-list">
        {order.map((id, index) => {
          const definition = getLyricsSourceDefinition(id, customServers);
          const enabled = !disabledIds.has(id);
          const optionCount = optionCounts[id] ?? 0;
          const optionsExpanded = expandedOptions.has(id);
          const isCustom = id.startsWith("custom:");

          return (
            <React.Fragment key={id}>
              <div
                className={`sl-sp-source-stack${optionCount > 0 ? " sl-sp-source-stack--has-options" : ""}${optionsExpanded ? " sl-sp-source-stack--open" : ""}`}
              >
                {optionCount > 1 && !optionsExpanded && (
                  <div className="sl-sp-source-stack-layer sl-sp-source-stack-layer--2" />
                )}
                {optionCount > 0 && !optionsExpanded && (
                  <div className="sl-sp-source-stack-layer sl-sp-source-stack-layer--1" />
                )}
                <div
                  className={`sl-sp-source-card${enabled ? "" : " sl-sp-source-card--disabled"}${optionCount > 0 ? " sl-sp-source-card--has-options" : ""}${optionsExpanded ? " sl-sp-source-card--options-open" : ""}`}
                >
                  <div className="sl-sp-source-rank">{index + 1}</div>
                  {optionCount > 0 ? (
                    <button
                      type="button"
                      className="sl-sp-source-copy sl-sp-source-copy--expandable"
                      onClick={() => toggleOptions(id)}
                      aria-expanded={optionsExpanded}
                      aria-label={`${optionsExpanded ? "Hide" : "Show"} ${definition.label} options`}
                    >
                      <span className="sl-sp-source-label">{definition.label}</span>
                      <span className="sl-sp-source-description">{definition.description}</span>
                    </button>
                  ) : (
                    <div className="sl-sp-source-copy">
                      <span className="sl-sp-source-label">{definition.label}</span>
                      <span className="sl-sp-source-description">{definition.description}</span>
                    </div>
                  )}
                  <div className="sl-sp-source-actions">
                    <div className="sl-sp-source-priority">
                      <button
                        className="sl-sp-icon-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          moveSource(id, -1);
                        }}
                        disabled={index === 0}
                        aria-label={`Move ${definition.label} up`}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        className="sl-sp-icon-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          moveSource(id, 1);
                        }}
                        disabled={index === order.length - 1}
                        aria-label={`Move ${definition.label} down`}
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>
                    <Toggle
                      checked={enabled}
                      onChange={(nextEnabled) => setSourceEnabled(id, nextEnabled)}
                      aria-label={`${enabled ? "Disable" : "Enable"} ${definition.label}`}
                    />
                    {isCustom && (
                      <button
                        className="sl-sp-icon-btn sl-sp-source-remove"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeCustomSource(id);
                        }}
                        aria-label={`Remove ${definition.label}`}
                        title="Remove custom source"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {id === "musixmatch" && optionsExpanded && (
                <div className="sl-sp-source-settings-group sl-sp-source-settings-group--inline sl-sp-source-settings-group--opening">
                  <div className="sl-sp-source-settings-inner">
                    <div className="sl-sp-source-token-row">
                      <div className="sl-sp-source-copy">
                        <span className="sl-sp-source-label">Musixmatch Token</span>
                        <span className="sl-sp-source-description">
                          Optional user token. Leave empty to use automatic refresh.
                        </span>
                      </div>
                      <div className="sl-sp-source-token-control">
                        <input
                          className="sl-sp-text-input sl-sp-source-token-input"
                          type="password"
                          value={musixmatchToken}
                          onChange={(event) =>
                            $musixmatchToken.set(event.currentTarget.value.trim())
                          }
                          onBlur={() => commitSourceSettingsChange()}
                          placeholder="Token"
                          spellCheck={false}
                          aria-label="Musixmatch token"
                        />
                        <button className="sl-sp-btn" onClick={() => void refreshToken()}>
                          Refresh
                        </button>
                      </div>
                    </div>
                    <div className="sl-sp-source-option-row">
                      <div className="sl-sp-source-copy">
                        <span className="sl-sp-source-label">Ignore Musixmatch Word Sync</span>
                        <span className="sl-sp-source-description">
                          Prefer Musixmatch line timing over word timing.
                        </span>
                      </div>
                      <Toggle
                        checked={ignoreMusixmatchWordSync}
                        onChange={(value) => {
                          $ignoreMusixmatchWordSync.set(value);
                          commitSourceSettingsChange();
                        }}
                        aria-label="Ignore Musixmatch word sync"
                      />
                    </div>
                  </div>
                </div>
              )}

              {id === "apple" && optionsExpanded && (
                <div className="sl-sp-source-settings-group sl-sp-source-settings-group--inline sl-sp-source-settings-group--opening">
                  <div className="sl-sp-source-settings-inner">
                    <div className="sl-sp-source-option-row">
                      <div className="sl-sp-source-copy">
                        <span className="sl-sp-source-label">Apple Music Tie Override</span>
                        <span className="sl-sp-source-description">
                          In Sync Type First mode, let Apple Music win equal-format ties.
                        </span>
                      </div>
                      <Toggle
                        checked={prioritizeAppleMusicQuality}
                        onChange={(value) => {
                          $prioritizeAppleMusicQuality.set(value);
                          commitSourceSettingsChange();
                        }}
                        aria-label="Apple Music tie override"
                      />
                    </div>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {addingCustomSource && (
        <div className="sl-sp-source-settings-group sl-sp-source-settings-group--opening">
          <div className="sl-sp-source-settings-inner">
            <form
              className="sl-sp-source-custom-form"
              onSubmit={(event) => {
                event.preventDefault();
                addCustomSource();
              }}
            >
              <input
                className="sl-sp-text-input"
                value={serverName}
                onChange={(event) => setServerName(event.currentTarget.value)}
                placeholder="Source name"
                aria-label="Custom source name"
                autoFocus
              />
              <input
                className="sl-sp-text-input"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.currentTarget.value)}
                placeholder="https://server.example/v1/lyrics"
                spellCheck={false}
                aria-label="Custom source URL"
              />
              <div className="sl-sp-source-custom-actions">
                <button type="submit" className="sl-sp-btn">
                  Add
                </button>
                <button type="button" className="sl-sp-btn" onClick={closeCustomSourceForm}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="sl-sp-source-footer">
        <div className="sl-sp-source-manager-copy">
          <span className="sl-sp-source-manager-title">Source Priority</span>
          <span className="sl-sp-source-manager-description">
            Higher sources are tried first. Disabled sources are skipped.
          </span>
        </div>
        <div className="sl-sp-btn-group">
          {!addingCustomSource && (
            <button className="sl-sp-btn" onClick={() => setAddingCustomSource(true)}>
              Add custom
            </button>
          )}
          <button className="sl-sp-btn" onClick={resetSources}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
