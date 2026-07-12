import { useStore } from "@nanostores/react";
import React from "react";
import { $fixHanGlyphVariants, $skipSpicyFont, $systemFontStack } from "../../../utils/stores.ts";
import { matches, Row, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Appearance";

interface Props {
  query: string;
  sectionFilter: string;
}

export default function AppearanceSection({ query, sectionFilter }: Props) {
  const skipSpicyFont = useStore($skipSpicyFont);
  const systemFontStack = useStore($systemFontStack);
  const fixHanGlyphVariants = useStore($fixHanGlyphVariants);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const r1 = matches(query, "Use System Font", "Use Spotify's default font or a custom installed font-family stack.");
  const r2 = skipSpicyFont && matches(query, "Font Family Stack", "Choose installed fonts in fallback order.");
  const r3 = skipSpicyFont && matches(query, "Fix Han Glyph Variants", "Use Japanese or Simplified Chinese Noto glyph forms based on lyric language.");

  if (!r1 && !r2 && !r3) return null;

  return (
    <>
      <SectionTitle>Appearance</SectionTitle>

      {r1 && (
        <Row label="Use System Font" description="Use Spotify's default font or choose installed fonts below.">
          <Toggle checked={skipSpicyFont} onChange={(v) => $skipSpicyFont.set(v)} />
        </Row>
      )}

      {r2 && (
        <Row label="Font Family Stack" description="Comma-separated installed fonts, tried from left to right. Leave empty for Spotify's default.">
          <input
            className="sl-sp-text-input"
            type="text"
            placeholder={'"Inter", "Noto Sans JP", "Segoe UI", sans-serif'}
            value={systemFontStack}
            onChange={(event) => $systemFontStack.set(event.currentTarget.value)}
            spellCheck={false}
          />
        </Row>
      )}

      {r3 && (
        <Row label="Fix Han Glyph Variants" description='Keep your stack order, but prefer "Noto Sans JP" for Japanese and "Noto Sans SC" for Chinese lyric lines.'>
          <Toggle checked={fixHanGlyphVariants} onChange={(value) => $fixHanGlyphVariants.set(value)} />
        </Row>
      )}
    </>
  );
}
