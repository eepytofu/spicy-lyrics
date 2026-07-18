import { useStore } from "@nanostores/react";
import { $developerMode, $playbackOffset } from "../../../utils/stores.ts";
import {
  RemoveCurrentLyrics_AllCaches,
  RemoveCurrentLyrics_StateCache,
  RemoveLyricsCache,
} from "../../../utils/LyricsCacheTools.ts";
import { SPICY_LYRICS_BUILD_MARKER } from "../../../utils/buildMarker.ts";
import { matches, Row, SectionTitle, Slider, SubsectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Advanced";
interface Props {
  query: string;
  sectionFilter: string;
}

export default function AdvancedSection({ query, sectionFilter }: Props) {
  const offset = useStore($playbackOffset);
  const developerMode = useStore($developerMode);
  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;
  const playback = matches(query, "Playback Offset", "Shift lyrics timing earlier or later."),
    currentCaches = matches(
      query,
      "Clear Current Song Caches",
      "Remove cached lyrics for the current track."
    ),
    storedCache = matches(
      query,
      "Clear Stored Lyrics Cache",
      "Delete lyrics cached for up to three days."
    ),
    stateCache = matches(
      query,
      "Clear Current Song State",
      "Remove the current song from in-memory state."
    ),
    developer = matches(query, "Developer Mode", "Enable extra logging and debug utilities."),
    marker = matches(query, "Build Marker", SPICY_LYRICS_BUILD_MARKER);
  if (![playback, currentCaches, storedCache, stateCache, developer, marker].some(Boolean))
    return null;

  return (
    <>
      <SectionTitle>{SECTION_NAME}</SectionTitle>
      {playback && <SubsectionTitle>Timing</SubsectionTitle>}
      {playback && (
        <Row
          label="Playback Offset"
          description="Negative values show lyrics earlier; positive values delay them."
          stacked
        >
          <Slider
            value={offset}
            min={-5000}
            max={5000}
            step={10}
            defaultValue={0}
            unit="ms"
            onChange={(value) => $playbackOffset.set(value)}
          />
        </Row>
      )}

      {(currentCaches || storedCache || stateCache) && (
        <SubsectionTitle>Cache and recovery</SubsectionTitle>
      )}
      {currentCaches && (
        <Row
          label="Clear Current Song Caches"
          description="Remove all cached lyrics data for the current track."
        >
          <button
            type="button"
            className="sl-sp-btn"
            onClick={() => RemoveCurrentLyrics_AllCaches(true)}
          >
            Clear
          </button>
        </Row>
      )}
      {storedCache && (
        <Row
          label="Clear Stored Lyrics Cache"
          description="Delete lyrics cached for up to three days."
        >
          <button type="button" className="sl-sp-btn" onClick={() => RemoveLyricsCache(true)}>
            Clear Cache
          </button>
        </Row>
      )}
      {stateCache && (
        <Row
          label="Clear Current Song State"
          description="Remove the current song from in-memory state only."
        >
          <button
            type="button"
            className="sl-sp-btn"
            onClick={() => RemoveCurrentLyrics_StateCache(true)}
          >
            Clear State
          </button>
        </Row>
      )}

      {(developer || marker) && <SubsectionTitle>Diagnostics</SubsectionTitle>}
      {developer && (
        <Row label="Developer Mode" description="Enable extra logging and debug utilities.">
          <Toggle checked={developerMode} onChange={(value) => $developerMode.set(value)} />
        </Row>
      )}
      {marker && (
        <Row label="Build Marker" description={SPICY_LYRICS_BUILD_MARKER}>
          <code>{SPICY_LYRICS_BUILD_MARKER}</code>
        </Row>
      )}
    </>
  );
}
