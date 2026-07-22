import type { PlanFuriganaSegment, ReadingProvenance, RenderPlan } from "../Model.ts";
import { furiganaSegmentKey } from "./FuriganaIdentity.ts";

/** Timed unit IDs are provider owner IDs, never array positions. */
export function timedLogicalGroupIds(plan: RenderPlan | undefined): Map<string, string> {
  return new Map((plan?.timedReadingUnits || []).map((unit) => [unit.spanId, unit.logicalGroupId]));
}

export type TimedFuriganaGroup = {
  id: string;
  segmentKey: string;
  reading: string;
  spanIds: readonly string[];
  provenance?: ReadingProvenance;
  /**
   * Code points from the group's first character to the middle of the
   * annotated range. Lyric CJK glyphs are full-width, so a renderer can
   * horizontally center the ruby at this many em without DOM measurement.
   */
  rubyCenterCh: number;
};

export type TimedFuriganaGroups = {
  groups: readonly TimedFuriganaGroup[];
  bySpanId: ReadonlyMap<string, TimedFuriganaGroup>;
};

/**
 * Ruby that crosses timed syllable boundaries cannot be drawn per karaoke
 * fragment without duplication. Group the intersecting provider spans so a
 * renderer can draw the reading once above them while every span keeps its
 * own timing owner. Accepts annotation-shaped ({canonicalRange}) and raw
 * ({start,end}) furigana; both use canonical code points.
 */
export function timedFuriganaGroups(plan: RenderPlan | undefined): TimedFuriganaGroups {
  const sourceUnits = plan?.sourceUnits || [];
  const ruby = plan?.furigana || [];
  const groups: TimedFuriganaGroup[] = [];
  const bySpanId = new Map<string, TimedFuriganaGroup>();

  ruby.forEach((segment, index) => {
    const { start, end } = planFuriganaRange(segment);
    if (end <= start || !segment.reading) return;

    const intersecting = sourceUnits.filter((unit) =>
      start < unit.canonicalRange.endCp && end > unit.canonicalRange.startCp
    );
    if (intersecting.length < 2) return;

    // Do not create nested or duplicated timing owners for malformed overlapping ruby.
    if (intersecting.some((unit) => bySpanId.has(unit.spanId))) return;

    const group: TimedFuriganaGroup = {
      id: `timed-ruby-${index}`,
      segmentKey: furiganaSegmentKey(start, end, segment.reading),
      reading: segment.reading,
      spanIds: intersecting.map((unit) => unit.spanId),
      ...(segment.provenance ? { provenance: segment.provenance } : {}),
      rubyCenterCh: start - intersecting[0].canonicalRange.startCp + (end - start) / 2,
    };
    groups.push(group);
    intersecting.forEach((unit) => bySpanId.set(unit.spanId, group));
  });

  return { groups, bySpanId };
}

function planFuriganaRange(segment: PlanFuriganaSegment): { start: number; end: number } {
  return "canonicalRange" in segment
    ? { start: segment.canonicalRange.startCp, end: segment.canonicalRange.endCp }
    : { start: segment.start, end: segment.end };
}

/**
 * True when the same group resumes after only whitespace-only syllables.
 * Authored AMLL whitespace spans sit between group members without owning a
 * canonical range, so the renderer keeps them inside the open group instead
 * of splitting the ruby into duplicates.
 */
export function timedGroupContinuesAt(
  syllableTexts: readonly string[],
  groups: TimedFuriganaGroups,
  fromIndex: number,
  groupId: string | undefined
): boolean {
  if (!groupId) return false;
  for (let j = fromIndex; j < syllableTexts.length; j += 1) {
    const member = groups.bySpanId.get(String(j));
    if (member) return member.id === groupId;
    if ((syllableTexts[j] || "").trim()) return false;
  }
  return false;
}
