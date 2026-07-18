import { useStore } from "@nanostores/react";
import {
  $minimalLyricsMode,
  $simpleLyricsMode,
  $simpleLyricsModeRenderingType,
} from "../../../utils/stores.ts";
import {
  $lyricsCopyFormat,
  $showBuiltInTranslationButton,
  $showChineseTranslitButton,
} from "../../../utils/uiState.ts";
import { matches, Row, Select, SectionTitle, SubsectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Lyrics & Controls";
const COPY_OPTIONS = [
  { value: "plain", label: "Plain lyrics" },
  { value: "timestamps", label: "Lyrics + timestamps" },
  { value: "translation", label: "Lyrics + translation" },
  { value: "metadata", label: "Artist/title + lyrics" },
] as const;

interface Props {
  query: string;
  sectionFilter: string;
}

export default function LyricsControlsSection({ query, sectionFilter }: Props) {
  const simpleMode = useStore($simpleLyricsMode);
  const renderingType = useStore($simpleLyricsModeRenderingType);
  const minimalMode = useStore($minimalLyricsMode);
  const copyFormat = useStore($lyricsCopyFormat);
  const showTranslationButton = useStore($showBuiltInTranslationButton);
  const showChineseButton = useStore($showChineseTranslitButton);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const displayRows = {
    simple: matches(query, "Simple Lyrics Mode", "Remove extra visual effects from lyrics."),
    animation: matches(
      query,
      "Simple Mode Animation",
      "Choose how text transitions render in Simple Lyrics Mode."
    ),
    minimal: matches(
      query,
      "Minimal Lyrics Mode",
      "Hide sung lines in Fullscreen and Cinema Mode."
    ),
  };
  const controlRows = {
    translation: matches(
      query,
      "Show Translation Button",
      "Show the Google fallback control in lyrics view controls."
    ),
    chinese: matches(
      query,
      "Show Chinese Reading Button",
      "Show the Pinyin or Jyutping control when Chinese lyrics are detected."
    ),
    copy: matches(
      query,
      "Copy Lyrics Format",
      "Choose what the lyrics copy button writes to the clipboard."
    ),
  };
  if (![...Object.values(displayRows), ...Object.values(controlRows)].some(Boolean)) return null;

  return (
    <>
      <SectionTitle>{SECTION_NAME}</SectionTitle>
      {Object.values(displayRows).some(Boolean) && <SubsectionTitle>Display modes</SubsectionTitle>}
      {displayRows.simple && (
        <Row label="Simple Lyrics Mode" description="Remove extra visual effects from lyrics.">
          <Toggle checked={simpleMode} onChange={(value) => $simpleLyricsMode.set(value)} />
        </Row>
      )}
      {displayRows.animation && (
        <Row
          label="Simple Mode Animation"
          description="Choose how text transitions render in Simple Lyrics Mode."
          disabled={!simpleMode}
          disabledReason="Enable Simple Lyrics Mode first."
        >
          <Select
            value={renderingType}
            options={["calculate", "animate"]}
            labels={["Calculated", "Animated"]}
            onChange={(value) => $simpleLyricsModeRenderingType.set(value)}
            disabled={!simpleMode}
          />
        </Row>
      )}
      {displayRows.minimal && (
        <Row
          label="Minimal Lyrics Mode"
          description="Hide sung lines in Fullscreen and Cinema Mode."
        >
          <Toggle checked={minimalMode} onChange={(value) => $minimalLyricsMode.set(value)} />
        </Row>
      )}

      {Object.values(controlRows).some(Boolean) && (
        <SubsectionTitle>Controls and output</SubsectionTitle>
      )}
      {controlRows.translation && (
        <Row
          label="Show Translation Button"
          description="Show the Google fallback control in lyrics view controls."
        >
          <Toggle
            checked={showTranslationButton}
            onChange={(value) => $showBuiltInTranslationButton.set(value)}
          />
        </Row>
      )}
      {controlRows.chinese && (
        <Row
          label="Show Chinese Reading Button"
          description="Show the Pinyin or Jyutping control when Chinese lyrics are detected."
        >
          <Toggle
            checked={showChineseButton}
            onChange={(value) => $showChineseTranslitButton.set(value)}
          />
        </Row>
      )}
      {controlRows.copy && (
        <Row
          label="Copy Lyrics Format"
          description="Choose what the lyrics copy button writes to the clipboard."
        >
          <Select
            value={copyFormat}
            options={COPY_OPTIONS.map(({ value }) => value)}
            labels={COPY_OPTIONS.map(({ label }) => label)}
            onChange={(value) => $lyricsCopyFormat.set(value as typeof copyFormat)}
          />
        </Row>
      )}
    </>
  );
}
