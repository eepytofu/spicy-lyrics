import type { RenderPlan, TimedReadingUnit } from "../Processing/Model.ts";

export type TimedReadingBinder = (
  spanId: string,
  element: HTMLElement,
  unit: TimedReadingUnit
) => void;

export function renderReadingPlan(
  parent: HTMLElement,
  plan: RenderPlan,
  bindTimedTarget: TimedReadingBinder,
  readabilityGapBeforeSpanIds: ReadonlySet<string> = new Set(),
): HTMLElement {
  const row = document.createElement("div");
  row.className = "romanized-below reading-plan-row";
  let currentGroupId: string | undefined;
  let group: HTMLSpanElement | undefined;
  for (const unit of plan.timedReadingUnits) {
    const readabilityGapBefore = readabilityGapBeforeSpanIds.has(unit.spanId);
    if (unit.logicalGroupId !== currentGroupId) {
      currentGroupId = unit.logicalGroupId;
      group = document.createElement("span");
      group.className = "reading-plan-group";
      group.dataset.logicalGroupId = currentGroupId;
      if (
        row.childElementCount > 0 &&
        (/^\s/u.test(unit.text) || readabilityGapBefore)
      ) {
        group.style.marginLeft = "0.25em";
      }
      row.appendChild(group);
    }
    const child = document.createElement("span");
    child.className = "romanized-syllable reading-plan-timed-unit";
    child.dataset.spanId = unit.spanId;
    if (group!.childElementCount > 0 && readabilityGapBefore) {
      child.style.marginLeft = "0.25em";
    }
    if (unit.provenance === "providerExplicit") {
      child.classList.add("reading-origin-provider-explicit");
      child.dataset.readingOrigin = "provider-explicit";
    }
    child.textContent = unit.text.trimStart();
    group!.appendChild(child);
    bindTimedTarget(unit.spanId, child, unit);
  }
  parent.appendChild(row);
  return row;
}
