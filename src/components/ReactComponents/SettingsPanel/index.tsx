import { useState } from "react";
import AdvancedSection from "./AdvancedSection.tsx";
import AppearanceLayoutSection from "./AppearanceLayoutSection.tsx";
import LanguagesSection from "./LanguagesSection.tsx";
import LyricsControlsSection from "./LyricsControlsSection.tsx";
import SourcesSection from "./SourcesSection.tsx";
import TranslationsSection from "./TranslationsSection.tsx";
import { FilterDropdown, SearchBar } from "./components.tsx";

const SECTIONS = [
  "Lyrics & Controls",
  "Languages & Readings",
  "Translations",
  "Sources",
  "Appearance & Layout",
  "Advanced",
];

export default function SettingsPanel() {
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("All");

  return (
    <div style={{ padding: "8px 0" }} className="slm w-40">
      <div className="sl-sp-toolbar">
        <SearchBar value={query} onChange={setQuery} />
        <FilterDropdown sections={SECTIONS} value={sectionFilter} onChange={setSectionFilter} />
      </div>

      <LyricsControlsSection query={query} sectionFilter={sectionFilter} />
      <LanguagesSection query={query} sectionFilter={sectionFilter} />
      <TranslationsSection query={query} sectionFilter={sectionFilter} />
      <SourcesSection query={query} sectionFilter={sectionFilter} />
      <AppearanceLayoutSection query={query} sectionFilter={sectionFilter} />
      <AdvancedSection query={query} sectionFilter={sectionFilter} />
    </div>
  );
}
