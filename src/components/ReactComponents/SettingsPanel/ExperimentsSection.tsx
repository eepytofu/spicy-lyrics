import { EXPERIMENTS } from "../../../utils/experiments.ts";
import { matches, Row, SectionTitle } from "./components.tsx";

const SECTION_NAME = "Experiments";
const DESCRIPTION = "Try in-progress features or restore their previous appearance.";

export default function ExperimentsSection({ query, sectionFilter, onOpen }: {
  query: string;
  sectionFilter: string;
  onOpen: () => void;
}) {
  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;
  const visible = matches(query, SECTION_NAME, DESCRIPTION)
    || EXPERIMENTS.some((experiment) => matches(query, experiment.label, experiment.description));
  if (!visible) return null;
  return (
    <>
      <SectionTitle>{SECTION_NAME}</SectionTitle>
      <Row label={SECTION_NAME} description={DESCRIPTION}>
        <button className="sl-sp-btn" onClick={onOpen}>Open ({EXPERIMENTS.length})</button>
      </Row>
    </>
  );
}
