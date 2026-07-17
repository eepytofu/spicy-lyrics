import type { RenderPlan } from "../../Model.ts";

/** Timed unit IDs are provider owner IDs, never array positions. */
export function timedLogicalGroupIds(plan: RenderPlan | undefined): Map<string, string> {
  return new Map((plan?.timedReadingUnits || []).map((unit) => [unit.spanId, unit.logicalGroupId]));
}

export type TimedFuriganaGroup = {
  id: string;
  reading: string;
  spanIds: readonly string[];
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
  const ruby = (plan?.furigana || []) as Array<{
    start?: number;
    end?: number;
    reading?: string;
    canonicalRange?: { startCp: number; endCp: number };
  }>;
  const groups: TimedFuriganaGroup[] = [];
  const bySpanId = new Map<string, TimedFuriganaGroup>();

  ruby.forEach((segment, index) => {
    const start = segment.canonicalRange?.startCp ?? segment.start;
    const end = segment.canonicalRange?.endCp ?? segment.end;
    if (typeof start !== "number" || typeof end !== "number" || end <= start || !segment.reading) return;

    const intersecting = sourceUnits.filter((unit) =>
      start < unit.canonicalRange.endCp && end > unit.canonicalRange.startCp
    );
    if (intersecting.length < 2) return;

    // Do not create nested or duplicated timing owners for malformed overlapping ruby.
    if (intersecting.some((unit) => bySpanId.has(unit.spanId))) return;

    const group: TimedFuriganaGroup = {
      id: `timed-ruby-${index}`,
      reading: segment.reading,
      spanIds: intersecting.map((unit) => unit.spanId),
      rubyCenterCh: start - intersecting[0].canonicalRange.startCp + (end - start) / 2,
    };
    groups.push(group);
    intersecting.forEach((unit) => bySpanId.set(unit.spanId, group));
  });

  return { groups, bySpanId };
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
