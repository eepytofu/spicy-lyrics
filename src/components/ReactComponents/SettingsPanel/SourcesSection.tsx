import { useStore } from "@nanostores/react";
import { useState } from "react";
import { toast } from "sonner";
import { SpotifyPlayer } from "../../Global/SpotifyPlayer.ts";
import { returnToAutomaticLyrics } from "../../../utils/Lyrics/fetchLyrics.ts";
import ApplyLyrics from "../../../utils/Lyrics/Global/Applyer.ts";
import { resetLyricsCandidateOverrides } from "../../../utils/Lyrics/LyricsOverridePreference.ts";
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
  const [updatingLifetime, setUpdatingLifetime] = useState(false);

  async function updateManualSelectionLifetime(value: string) {
    const next = value as typeof manualSelectionLifetime;
    if (next === manualSelectionLifetime || updatingLifetime) return;

    setUpdatingLifetime(true);
    let resetUris: string[];
    try {
      resetUris = await resetLyricsCandidateOverrides();
      $manualLyricsSelectionLifetime.set(next);
    } catch (error) {
      console.error("Manual selection lifetime update failed:", error);
      toast.error("Could not update manual selection lifetime.");
      setUpdatingLifetime(false);
      return;
    }

    const currentUri = SpotifyPlayer.GetUri();
    if (currentUri && resetUris.includes(currentUri)) {
      try {
        const lyrics = await returnToAutomaticLyrics(currentUri);
        if (lyrics) await ApplyLyrics(lyrics);
      } catch (error) {
        console.error("Automatic lyrics refresh failed:", error);
        toast.error("Setting saved, but current lyrics could not refresh.");
        setUpdatingLifetime(false);
        return;
      }
    }
    if (resetUris.length > 0) toast.success("Previous manual selections reset to Auto Match.");
    setUpdatingLifetime(false);
  }

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;
  const showManager = matches(
      query,
      "Lyrics Sources",
      "Choose providers, priority, Worker, and custom servers."
    ),
    showManualSelectionLifetime = matches(
      query,
      "Manual Selection Lifetime",
      "Choose whether a manually selected source is remembered after Spotify restarts. Changing this resets previous manual selections to Auto Match."
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
          description="Choose whether a manually selected source is remembered after Spotify restarts. Changing this resets previous manual selections to Auto Match."
        >
          <Select
            value={manualSelectionLifetime}
            options={["temporary", "persistent"]}
            labels={["This session", "Persistent"]}
            aria-label="Manual selection lifetime"
            onChange={(value) => void updateManualSelectionLifetime(value)}
            disabled={updatingLifetime}
          />
        </Row>
      )}
    </>
  );
}
