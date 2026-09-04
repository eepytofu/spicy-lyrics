import { ConvertTime } from "../../ConvertTime.ts";
import isRtl from "../../isRtl.ts";
import type { TimedSyllableEntry, TimedSyllableGroup } from "../../Reading/JapaneseReading.ts";
import { needsSyllableSpaceBefore } from "../../Processing/SyllableBoundaries.ts";
import {
  aboveReadingSegmentsForSpan,
  resolveReadingRowPresentation,
  shouldRenderAboveReadings,
  shouldRenderFurigana,
  type ReadingRenderOptions,
  type ReadingRowPresentation,
} from "../ReadingRenderer.ts";
import {
  timedAboveReadingGroups,
  timedFuriganaGroups,
  timedLogicalGroupIds,
  type TimedAboveReadingGroup,
  type TimedAboveReadingGroups,
  type TimedFuriganaGroup,
  type TimedFuriganaGroups,
} from "../../Processing/Japanese/TimedGroupIds.ts";

type SyllableData = TimedSyllableEntry;

export const joinSyllableDisplayText = (syllables: SyllableData[]): string => {
  return syllables
    .reduce((acc, syl, index) => {
      const text = syl.Text || "";
      if (index === 0) return text;
      return `${acc}${needsSyllableSpaceBefore(syllables, index) ? " " : ""}${text}`;
    }, "")
    .trim();
};

export type SyllableWordTiming = Readonly<{
  startTime: number;
  endTime: number;
  totalDuration: number;
}>;

const EMPTY_TIMED_FURIGANA: TimedFuriganaGroups = { groups: [], bySpanId: new Map() };
const EMPTY_TIMED_ABOVE_READING: TimedAboveReadingGroups = { groups: [], bySpanId: new Map() };
export type TimedRubyGroup = TimedFuriganaGroup | TimedAboveReadingGroup;

type SyllableWordRenderPlan = Readonly<{
  syllable: SyllableData;
  index: number;
  timing: SyllableWordTiming;
  readingRow: ReadingRowPresentation;
  renderOptions: ReadingRenderOptions;
  timedRubyGroup?: TimedRubyGroup;
  semanticGroupId?: string;
  timedFuriganaBaseSweepRange?: { start: number; end: number };
}>;

export type SyllableGroupRenderPlan = Readonly<{
  sourceText: string;
  hasRtl: boolean;
  usesSemanticGroups: boolean;
  texts: readonly string[];
  timedRubyLookup: { bySpanId: ReadonlyMap<string, TimedRubyGroup> };
  words: readonly SyllableWordRenderPlan[];
  romanizedText?: string;
}>;

export const prepareSyllableGroupRenderPlan = (
  group: TimedSyllableGroup,
  baseRenderOptions: ReadingRenderOptions,
  sourceText = group.JapaneseReading?.sourceText || joinSyllableDisplayText(group.Syllables)
): SyllableGroupRenderPlan => {
  const rendersFurigana = (entry: TimedSyllableEntry | TimedSyllableGroup) =>
    !shouldRenderAboveReadings(entry, baseRenderOptions) &&
    shouldRenderFurigana(entry, baseRenderOptions);
  const groupHasFurigana = rendersFurigana(group);
  const groupHasAboveReading = shouldRenderAboveReadings(group, baseRenderOptions);
  const hasFurigana = groupHasFurigana || group.Syllables.some(rendersFurigana);
  const hasAboveReading =
    groupHasAboveReading ||
    group.Syllables.some((syllable) => shouldRenderAboveReadings(syllable, baseRenderOptions));
  const reservedReadingRow = hasAboveReading ? "pinyinAbove" : hasFurigana ? "furigana" : undefined;
  const groupRenderOptions = {
    ...baseRenderOptions,
    reservedReadingRow,
    primaryScript: group.ReadingRenderPlan?.primaryScript,
  } satisfies ReadingRenderOptions;
  const timedFurigana = hasFurigana
    ? timedFuriganaGroups(group.ReadingRenderPlan)
    : EMPTY_TIMED_FURIGANA;
  const timedAboveReading = hasAboveReading
    ? timedAboveReadingGroups(group.ReadingRenderPlan)
    : EMPTY_TIMED_ABOVE_READING;
  const logicalGroupIds = timedLogicalGroupIds(group.ReadingRenderPlan);
  const timedRubyLookup = {
    bySpanId: new Map<string, TimedRubyGroup>([
      ...timedFurigana.bySpanId,
      ...timedAboveReading.bySpanId,
    ]),
  };

  return {
    sourceText,
    hasRtl: group.Syllables.some((syllable) => isRtl(syllable.Text)),
    usesSemanticGroups:
      group.Syllables.some((syllable) => !!syllable.JapaneseReading) && !!group.ReadingRenderPlan,
    texts: group.Syllables.map((syllable) => syllable.Text || ""),
    timedRubyLookup,
    words: group.Syllables.map((syllable, index) => {
      const spanId = String(index);
      const startTime = ConvertTime(syllable.StartTime);
      const endTime = ConvertTime(syllable.EndTime);
      const timedFuriganaGroup = timedFurigana.bySpanId.get(spanId);
      const timedRubyGroup = timedFuriganaGroup ?? timedAboveReading.bySpanId.get(spanId);
      const renderOptions = {
        ...groupRenderOptions,
        aboveReadingSegments: aboveReadingSegmentsForSpan(group.ReadingRenderPlan, spanId),
        ...(timedFuriganaGroup ? { suppressedFuriganaKeys: [timedFuriganaGroup.segmentKey] } : {}),
      } satisfies ReadingRenderOptions;
      return {
        syllable,
        index,
        timing: { startTime, endTime, totalDuration: endTime - startTime },
        readingRow: resolveReadingRowPresentation(syllable, renderOptions),
        renderOptions,
        timedRubyGroup,
        semanticGroupId: logicalGroupIds.get(spanId),
        timedFuriganaBaseSweepRange: timedFuriganaGroup?.baseSweepRanges.get(spanId),
      };
    }),
    romanizedText: group.RomanizedText || group.TransliteratedText,
  };
};
