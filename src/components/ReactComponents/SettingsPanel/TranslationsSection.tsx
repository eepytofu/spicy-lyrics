import { useStore } from "@nanostores/react";
import { $providerTranslationsEnabled } from "../../../utils/uiState.ts";
import { matches, Row, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Translations";

interface Props {
  query: string;
  sectionFilter: string;
}

export default function TranslationsSection({ query, sectionFilter }: Props) {
  const sourceTranslations = useStore($providerTranslationsEnabled);
  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const showSource = matches(
    query,
    "Source Translations",
    "Show translations supplied with the selected lyrics."
  );
  if (!showSource) return null;

  return (
    <>
      <SectionTitle>{SECTION_NAME}</SectionTitle>
      {showSource && (
        <Row
          label="Source Translations"
          description="Show translations supplied with the selected lyrics."
        >
          <Toggle
            checked={sourceTranslations}
            onChange={(value) => $providerTranslationsEnabled.set(value)}
          />
        </Row>
      )}
    </>
  );
}
