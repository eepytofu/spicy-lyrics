import type {
  CanonicalLine,
  ParsedLine,
  ReadingAnnotation,
  RenderPlan,
  TimedReadingUnit,
  ValidationResult,
} from "./Model.ts";

export function buildRenderPlan(
  line: ParsedLine,
  canonical: CanonicalLine,
  annotations: readonly ReadingAnnotation[],
): RenderPlan {
  const readingUnits = annotations.flatMap((annotation) => annotation.units)
    .sort((a, b) => a.canonicalRange.startCp - b.canonicalRange.startCp);
  const timedReadingUnits: TimedReadingUnit[] = readingUnits.flatMap((unit) =>
    unit.timingRefs.map((spanId) => ({
      spanId,
      canonicalRange: unit.canonicalRange,
      text: unit.text,
      logicalGroupId: unit.logicalGroupId,
      ...(unit.animationTimingRefs
        ? { animationTimingRefs: unit.animationTimingRefs }
        : {}),
      ...(unit.animationRange
        ? { animationRange: unit.animationRange }
        : {}),
      ...(unit.provenance ? { provenance: unit.provenance } : {}),
    }))
  );
  const furigana = annotations.flatMap((annotation) => annotation.furigana ?? []);
  return {
    lineId: line.id,
    sourceUnits: canonical.spanMappings,
    readingUnits,
    timedReadingUnits,
    joinedDisplayText: readingUnits.map((unit) => unit.text).join(""),
    ...(furigana.length > 0 ? { furigana } : {}),
  };
}

export function validateRenderPlan(plan: RenderPlan): ValidationResult {
  const errors: string[] = [];
  const owners = new Set<string>();
  for (const unit of plan.timedReadingUnits) {
    if (owners.has(unit.spanId)) errors.push(`duplicate timing owner:${unit.spanId}`);
    owners.add(unit.spanId);
  }
  if (plan.readingUnits.map((unit) => unit.text).join("") !== plan.joinedDisplayText) {
    errors.push("joined display mismatch");
  }
  return { valid: errors.length === 0, errors };
}
