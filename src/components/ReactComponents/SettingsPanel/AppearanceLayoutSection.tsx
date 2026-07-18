import { useStore } from "@nanostores/react";
import {
  $fixHanGlyphVariants,
  $lockedMediaBox,
  $popupLyricsAllowed,
  $showNpvDynamicBg,
  $skipSpicyFont,
  $staticBackgroundMode,
  $systemFontStack,
  $timelineOutsideMediaContent,
  $viewControlsPosition,
} from "../../../utils/stores.ts";
import { $flatViewControls, $forceDarkBackground, $isGlobalNav } from "../../../utils/uiState.ts";
import { matches, Row, Select, SectionTitle, SubsectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Appearance & Layout";
interface Props {
  query: string;
  sectionFilter: string;
}

export default function AppearanceLayoutSection({ query, sectionFilter }: Props) {
  const staticBackground = useStore($staticBackgroundMode);
  const dynamicNpv = useStore($showNpvDynamicBg);
  const forceDark = useStore($forceDarkBackground);
  const systemFont = useStore($skipSpicyFont);
  const fontStack = useStore($systemFontStack);
  const fixHan = useStore($fixHanGlyphVariants);
  const lockedMedia = useStore($lockedMediaBox);
  const popupAllowed = useStore($popupLyricsAllowed);
  const controlPosition = useStore($viewControlsPosition);
  const timelineOutside = useStore($timelineOutsideMediaContent);
  const flatControls = useStore($flatViewControls);
  const globalNav = useStore($isGlobalNav);
  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const background = {
    static: matches(query, "Static Background", "Pin the background to an image or color."),
    npv: matches(
      query,
      "Now Playing Dynamic Background",
      "Show the animated background in Now Playing View."
    ),
    dark: matches(
      query,
      "Force Dark Background",
      "Darken and desaturate bright background colors."
    ),
  };
  const typography = {
    system: matches(
      query,
      "Use System Font",
      "Use Spotify's font or an installed font-family stack."
    ),
    stack: matches(query, "Font Family Stack", "Choose installed fonts in fallback order."),
    han: matches(
      query,
      "Fix Han Glyph Variants",
      "Prefer language-appropriate Japanese and Chinese glyph forms."
    ),
  };
  const layout = {
    lock: matches(query, "Lock Media Box Size", "Prevent resizing in Compact Mode."),
    popup: matches(query, "Popup Lyrics Window", "Allow lyrics to open in a floating window."),
    position: matches(
      query,
      "Lyrics Controls Position",
      "Place lyrics controls at the top or bottom."
    ),
    timeline: matches(
      query,
      "Timeline Outside Media Box",
      "Place the timeline in the NowBar header."
    ),
    flat: matches(query, "Flat Controls", "Use flat controls instead of liquid-glass buttons."),
  };
  if (
    ![...Object.values(background), ...Object.values(typography), ...Object.values(layout)].some(
      Boolean
    )
  )
    return null;

  return (
    <>
      <SectionTitle>{SECTION_NAME}</SectionTitle>
      {Object.values(background).some(Boolean) && <SubsectionTitle>Background</SubsectionTitle>}
      {background.static && (
        <Row
          label="Static Background"
          description="Pin the background to an image or color instead of animating it."
        >
          <Select
            value={staticBackground}
            options={["off", "auto", "artistHeader", "coverArt", "color"]}
            labels={["Off", "Auto", "Artist Header", "Cover Art", "Color"]}
            onChange={(value) => $staticBackgroundMode.set(value)}
          />
        </Row>
      )}
      {background.npv && (
        <Row
          label="Now Playing Dynamic Background"
          description="Show the animated background in Now Playing View."
        >
          <Toggle checked={dynamicNpv} onChange={(value) => $showNpvDynamicBg.set(value)} />
        </Row>
      )}
      {background.dark && (
        <Row
          label="Force Dark Background"
          description="Darken and desaturate bright dynamic background colors."
        >
          <Toggle checked={forceDark} onChange={(value) => $forceDarkBackground.set(value)} />
        </Row>
      )}

      {Object.values(typography).some(Boolean) && <SubsectionTitle>Typography</SubsectionTitle>}
      {typography.system && (
        <Row
          label="Use System Font"
          description="Use Spotify's font or choose an installed font-family stack below."
        >
          <Toggle checked={systemFont} onChange={(value) => $skipSpicyFont.set(value)} />
        </Row>
      )}
      {typography.stack && (
        <Row
          label="Font Family Stack"
          description="Comma-separated installed fonts, tried from left to right."
          disabled={!systemFont}
          disabledReason="Enable Use System Font first."
        >
          <input
            className="sl-sp-text-input"
            value={fontStack}
            onChange={(event) => $systemFontStack.set(event.currentTarget.value)}
            placeholder={'"Inter", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", sans-serif'}
            spellCheck={false}
            disabled={!systemFont}
          />
        </Row>
      )}
      {typography.han && (
        <Row
          label="Fix Han Glyph Variants"
          description="Prefer Noto Sans JP, SC, or TC according to each lyric line."
          disabled={!systemFont}
          disabledReason="Enable Use System Font first."
        >
          <Toggle
            checked={fixHan}
            onChange={(value) => $fixHanGlyphVariants.set(value)}
            disabled={!systemFont}
          />
        </Row>
      )}

      {Object.values(layout).some(Boolean) && <SubsectionTitle>Layout and windows</SubsectionTitle>}
      {layout.lock && (
        <Row
          label="Lock Media Box Size"
          description="Prevent the media box from resizing while Compact Mode is active."
        >
          <Toggle checked={lockedMedia} onChange={(value) => $lockedMediaBox.set(value)} />
        </Row>
      )}
      {layout.popup && (
        <Row
          label="Popup Lyrics Window"
          description="Allow lyrics to open in a floating picture-in-picture window."
        >
          <Toggle checked={popupAllowed} onChange={(value) => $popupLyricsAllowed.set(value)} />
        </Row>
      )}
      {layout.position && (
        <Row
          label="Lyrics Controls Position"
          description="Place lyrics view controls at the top or bottom."
          disabled={!globalNav}
          disabledReason="Only available in Spotify's new navigation layout."
        >
          <Select
            value={controlPosition}
            options={["Top", "Bottom"]}
            onChange={(value) => $viewControlsPosition.set(value)}
            disabled={!globalNav}
          />
        </Row>
      )}
      {layout.timeline && (
        <Row
          label="Timeline Outside Media Box"
          description="Place the timeline in the NowBar header except in Compact Mode or PIP."
        >
          <Toggle
            checked={timelineOutside}
            onChange={(value) => $timelineOutsideMediaContent.set(value)}
          />
        </Row>
      )}
      {layout.flat && (
        <Row
          label="Flat Controls"
          description="Use flat lyrics controls instead of liquid-glass buttons."
        >
          <Toggle checked={flatControls} onChange={(value) => $flatViewControls.set(value)} />
        </Row>
      )}
    </>
  );
}
