import { useStore } from "@nanostores/react";
import { $manualLyricsSelectionLifetime } from "../../../utils/stores.ts";
import { $prefetchNextLyrics } from "../../../utils/uiState.ts";
import { OpenLyricsSourcesManager } from "../../../utils/openLyricsSourcesManager.tsx";
import { matches, Row, SectionTitle, Select, Toggle } from "./components.tsx";

const SECTION_NAME = "Sources";
interface Props {
  query: string;
  sectionFilter: string;
}

export default function SourcesSection({ query, sectionFilter }: Props) {
  const prefetch = useStore($prefetchNextLyrics);
  const manualSelectionLifetime = useStore($manualLyricsSelectionLifetime);
  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;
  const showManager = matches(
      query,
      "Lyrics Sources",
      "Choose providers, priority, Worker, and custom servers."
    ),
    showManualSelectionLifetime = matches(
      query,
      "Manual Selection Lifetime",
      "Choose whether a manually selected source is remembered after Spotify restarts."
    ),
    showPrefetch = matches(query, "Prefetch Next Lyrics", "Prepare lyrics for the upcoming track.");
  if (!showManager && !showManualSelectionLifetime && !showPrefetch) return null;

  return (
    <>
      <SectionTitle>{SECTION_NAME}</SectionTitle>
      {showManager && (
        <Row
          label="Lyrics Sources"
          description="Choose providers, priority, external Worker, and custom servers."
        >
          <button type="button" className="sl-sp-btn" onClick={OpenLyricsSourcesManager}>
            Manage Sources
          </button>
        </Row>
      )}
      {showPrefetch && (
        <Row
          label="Prefetch Next Lyrics"
          description="Prepare lyrics for the upcoming track before the song changes."
        >
          <Toggle checked={prefetch} onChange={(value) => $prefetchNextLyrics.set(value)} />
        </Row>
      )}
      {showManualSelectionLifetime && (
        <Row
          label="Manual Selection Lifetime"
          description="Choose whether a manually selected source is remembered after Spotify restarts."
        >
          <Select
            value={manualSelectionLifetime}
            options={["temporary", "persistent"]}
            labels={["This session", "Persistent"]}
            aria-label="Manual selection lifetime"
            onChange={(value) =>
              $manualLyricsSelectionLifetime.set(value as typeof manualSelectionLifetime)
            }
          />
        </Row>
      )}
    </>
  );
}
