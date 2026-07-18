import { useStore } from "@nanostores/react";
import { $prefetchNextLyrics } from "../../../utils/uiState.ts";
import { OpenLyricsSourcesManager } from "../../../utils/openLyricsSourcesManager.tsx";
import { matches, Row, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Sources";
interface Props {
  query: string;
  sectionFilter: string;
}

export default function SourcesSection({ query, sectionFilter }: Props) {
  const prefetch = useStore($prefetchNextLyrics);
  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;
  const showManager = matches(
      query,
      "Lyrics Sources",
      "Choose providers, priority, Worker, and custom servers."
    ),
    showPrefetch = matches(query, "Prefetch Next Lyrics", "Prepare lyrics for the upcoming track.");
  if (!showManager && !showPrefetch) return null;

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
    </>
  );
}
