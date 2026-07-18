import { useStore } from "@nanostores/react";
import {
  $chineseCharacterForm,
  $chineseTones,
  $chineseTranslitMode,
  $cyrillicKeepSigns,
  $cyrillicRomanizationMode,
  $japaneseReadingMode,
  $koreanDisplayMode,
} from "../../../utils/uiState.ts";
import { matches, Row, Select, SectionTitle, SubsectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Languages & Readings";
interface Props {
  query: string;
  sectionFilter: string;
}

export default function LanguagesSection({ query, sectionFilter }: Props) {
  const chineseForm = useStore($chineseCharacterForm);
  const chineseMode = useStore($chineseTranslitMode);
  const chineseTones = useStore($chineseTones);
  const japaneseMode = useStore($japaneseReadingMode);
  const koreanMode = useStore($koreanDisplayMode);
  const cyrillicMode = useStore($cyrillicRomanizationMode);
  const keepCyrillicSigns = useStore($cyrillicKeepSigns);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;
  const rows = {
    chineseForm: matches(
      query,
      "Chinese Character Form",
      "Keep original characters or convert Chinese lyrics locally."
    ),
    chineseMode: matches(query, "Chinese Reading", "Choose Mandarin Pinyin or Cantonese Jyutping."),
    chineseTones: matches(
      query,
      "Chinese Tones",
      "Show Pinyin tone marks or Jyutping tone numbers."
    ),
    japanese: matches(query, "Japanese Reading", "Choose romaji, furigana, or both."),
    korean: matches(query, "Korean Reading", "Choose transliteration or pronunciation output."),
    cyrillic: matches(
      query,
      "Cyrillic Language",
      "Choose Russian or Ukrainian romanization rules."
    ),
    signs: matches(query, "Keep Cyrillic Signs", "Preserve hard and soft sign marks."),
  };
  if (!Object.values(rows).some(Boolean)) return null;

  return (
    <>
      <SectionTitle>{SECTION_NAME}</SectionTitle>
      {(rows.chineseForm || rows.chineseMode || rows.chineseTones) && (
        <SubsectionTitle>Chinese</SubsectionTitle>
      )}
      {rows.chineseForm && (
        <Row
          label="Chinese Character Form"
          description="Keep original characters or convert Chinese lyrics locally."
        >
          <Select
            value={chineseForm}
            options={["original", "simplified", "traditional"]}
            labels={["Original", "Simplified", "Traditional"]}
            onChange={(value) => $chineseCharacterForm.set(value as typeof chineseForm)}
          />
        </Row>
      )}
      {rows.chineseMode && (
        <Row label="Chinese Reading" description="Choose Mandarin Pinyin or Cantonese Jyutping.">
          <Select
            value={chineseMode}
            options={["pinyin", "jyutping"]}
            labels={["Mandarin Pinyin", "Cantonese Jyutping"]}
            onChange={(value) => $chineseTranslitMode.set(value as typeof chineseMode)}
          />
        </Row>
      )}
      {rows.chineseTones && (
        <Row label="Chinese Tones" description="Show Pinyin tone marks or Jyutping tone numbers.">
          <Toggle checked={chineseTones} onChange={(value) => $chineseTones.set(value)} />
        </Row>
      )}

      {rows.japanese && <SubsectionTitle>Japanese</SubsectionTitle>}
      {rows.japanese && (
        <Row label="Japanese Reading" description="Choose romaji, furigana, or both.">
          <Select
            value={japaneseMode}
            options={["romaji", "furigana", "both"]}
            labels={["Romaji line only", "Furigana only", "Furigana + romaji line"]}
            onChange={(value) => $japaneseReadingMode.set(value as typeof japaneseMode)}
          />
        </Row>
      )}

      {rows.korean && <SubsectionTitle>Korean</SubsectionTitle>}
      {rows.korean && (
        <Row label="Korean Reading" description="Choose transliteration or pronunciation output.">
          <Select
            value={koreanMode}
            options={["wordTranslit", "rrStandard", "rrPronunciation", "vnPronunciation"]}
            labels={[
              "Word-by-word transliteration",
              "Standard Korean RR",
              "Follow pronunciation (RR)",
              "Follow pronunciation (VN)",
            ]}
            onChange={(value) => $koreanDisplayMode.set(value as typeof koreanMode)}
          />
        </Row>
      )}

      {(rows.cyrillic || rows.signs) && <SubsectionTitle>Cyrillic</SubsectionTitle>}
      {rows.cyrillic && (
        <Row
          label="Cyrillic Language"
          description="Choose Russian or Ukrainian romanization rules."
        >
          <Select
            value={cyrillicMode}
            options={["Russian", "Ukrainian"]}
            onChange={(value) => $cyrillicRomanizationMode.set(value as typeof cyrillicMode)}
          />
        </Row>
      )}
      {rows.signs && (
        <Row label="Keep Cyrillic Signs" description="Preserve hard and soft sign marks.">
          <Toggle checked={keepCyrillicSigns} onChange={(value) => $cyrillicKeepSigns.set(value)} />
        </Row>
      )}
    </>
  );
}
