import { useStore } from "@nanostores/react";
import {
  $providerTranslationsEnabled,
  $translationEnabled,
  $translationTargetLang,
} from "../../../utils/uiState.ts";
import { matches, Row, Select, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Translations";
const TARGETS = [
  ["en", "English"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh-CN", "Chinese (Simplified)"],
  ["zh-TW", "Chinese (Traditional)"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["pl", "Polish"],
  ["ru", "Russian"],
  ["uk", "Ukrainian"],
  ["tr", "Turkish"],
  ["id", "Indonesian"],
  ["vi", "Vietnamese"],
  ["th", "Thai"],
  ["hi", "Hindi"],
] as const;
interface Props {
  query: string;
  sectionFilter: string;
}

export default function TranslationsSection({ query, sectionFilter }: Props) {
  const sourceTranslations = useStore($providerTranslationsEnabled);
  const googleFallback = useStore($translationEnabled);
  const target = useStore($translationTargetLang);
  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const showSource = matches(
      query,
      "Source Translations",
      "Show translations supplied with the selected lyrics."
    ),
    showGoogle = matches(
      query,
      "Google Translation Fallback",
      "Fill lines that do not have a source translation."
    ),
    showTarget = matches(
      query,
      "Translation Target Language",
      "Choose the language for Google fallback translations."
    );
  if (!showSource && !showGoogle && !showTarget) return null;

  return (
    <>
      <SectionTitle>{SECTION_NAME}</SectionTitle>
      {showSource && (
        <Row
          label="Source Translations"
          description="Show translations supplied with the selected lyrics. Languages may vary between lines."
        >
          <Toggle
            checked={sourceTranslations}
            onChange={(value) => $providerTranslationsEnabled.set(value)}
          />
        </Row>
      )}
      {showGoogle && (
        <Row
          label="Google Translation Fallback"
          description="Fill lines that do not have a source translation."
        >
          <Toggle checked={googleFallback} onChange={(value) => $translationEnabled.set(value)} />
        </Row>
      )}
      {showTarget && (
        <Row
          label="Translation Target Language"
          description="Choose the language for Google fallback translations."
          disabled={!googleFallback}
          disabledReason="Enable Google Translation Fallback first."
        >
          <Select
            value={target}
            options={TARGETS.map(([value]) => value)}
            labels={TARGETS.map(([, label]) => label)}
            onChange={(value) => $translationTargetLang.set(value)}
            disabled={!googleFallback}
          />
        </Row>
      )}
    </>
  );
}
