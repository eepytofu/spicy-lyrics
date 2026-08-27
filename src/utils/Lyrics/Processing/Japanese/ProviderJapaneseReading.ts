import type { ProviderReadingEvidence } from "../../ProviderReadingEvidence.ts";
import { utf16IndexToCodePointOffset } from "../CodePoint.ts";
import { buildCanonicalLine } from "../Canonical.ts";
import type { ParsedLine, ReadingAnnotation, RenderPlan } from "../Model.ts";
import { buildRenderPlan, validateRenderPlan } from "../RenderPlan.ts";
import type { FuriganaSegment, JapaneseReading } from "../../Reading/JapaneseReadingModel.ts";
import { romanizeJapaneseKana } from "./JapaneseRomanizer.ts";

const ProviderKanaReading = /^[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]+$/u;
const UncoveredHan = /[\p{Script=Han}々〆]+/gu;

export type ProviderJapaneseOwnerSpan = {
  readonly index: number;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly start: number;
  readonly end: number;
};

export type ProviderJapaneseLineReading = {
  readonly providerId: "qq" | "kugou";
  readonly furigana: readonly FuriganaSegment[];
};

function providerFurigana(
  evidence: ProviderReadingEvidence,
  rowOrdinal: number,
  sourceText: string,
  owners: readonly ProviderJapaneseOwnerSpan[],
): FuriganaSegment[] {
  if (evidence.providerId !== "qq" && evidence.providerId !== "kugou") return [];
  const result: FuriganaSegment[] = [];
  const seen = new Set<string>();

  for (const layer of evidence.kanaLayers ?? []) {
    if (layer.validation.walkState === "layerRejected") continue;
    for (const unit of layer.units) {
      if (
        unit.source.rowOrdinal !== rowOrdinal ||
        unit.coverage !== "covered" ||
        !unit.reading ||
        !ProviderKanaReading.test(unit.reading)
      ) continue;
      const projectedSource = unit.groupSource ?? unit.source;
      const owner = owners.find((candidate) => candidate.index === projectedSource.tokenOrdinal);
      if (!owner) continue;
      const localStart = projectedSource.utf16Start;
      const localEnd = projectedSource.utf16End;
      if (owner.rawText.slice(localStart, localEnd) !== projectedSource.exactSourceSlice) continue;
      const directOwnerStart = sourceText.slice(owner.start, owner.start + owner.rawText.length)
        === owner.rawText
        ? owner.start
        : sourceText.indexOf(
            owner.rawText,
            Math.max(0, owner.start - (owner.rawText.match(/^\s*/u)?.[0].length ?? 0)),
          );
      if (directOwnerStart < 0 || directOwnerStart > owner.start) continue;
      const start = directOwnerStart + localStart;
      const end = directOwnerStart + localEnd;
      if (start < directOwnerStart || end > directOwnerStart + owner.rawText.length) continue;
      if (sourceText.slice(start, end) !== projectedSource.exactSourceSlice) continue;
      const key = `${start}:${end}:${unit.reading}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        start,
        end,
        reading: unit.reading,
        provenance: "providerExplicit",
      });
    }
  }
  return result.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function getProviderJapaneseLineReading(
  evidence: ProviderReadingEvidence | undefined,
  rowOrdinal: number | undefined,
  sourceText: string,
  owners: readonly ProviderJapaneseOwnerSpan[],
): ProviderJapaneseLineReading | undefined {
  if (!evidence || rowOrdinal === undefined) return undefined;
  if (evidence.providerId !== "qq" && evidence.providerId !== "kugou") return undefined;
  const furigana = providerFurigana(evidence, rowOrdinal, sourceText, owners);
  if (furigana.length === 0) return undefined;
  return {
    providerId: evidence.providerId,
    furigana,
  };
}

export function buildProviderOnlyJapaneseReading(
  sourceText: string,
  provider: ProviderJapaneseLineReading | undefined,
): JapaneseReading | undefined {
  if (!provider) return undefined;
  const furigana = provider.furigana.filter((segment, index, segments) =>
    Number.isInteger(segment.start) &&
    Number.isInteger(segment.end) &&
    segment.start >= 0 &&
    segment.start < segment.end &&
    segment.end <= sourceText.length &&
    ProviderKanaReading.test(segment.reading) &&
    (index === 0 || segment.start >= segments[index - 1].end)
  );
  if (furigana.length === 0) return undefined;

  let cursor = 0;
  let kanaProjection = "";
  for (const segment of furigana) {
    kanaProjection += sourceText.slice(cursor, segment.start).replace(UncoveredHan, "…");
    kanaProjection += segment.reading;
    cursor = segment.end;
  }
  kanaProjection += sourceText.slice(cursor).replace(UncoveredHan, "…");
  const romaji = romanizeJapaneseKana(kanaProjection);
  return {
    sourceText,
    romaji,
    romajiSegments: [{ text: romaji, provenance: "providerExplicit" }],
    furigana,
  };
}

export function buildProviderOnlyJapaneseRenderPlan(
  sourceText: string,
  spans: readonly ProviderJapaneseOwnerSpan[],
  times: readonly { StartTime?: number; EndTime?: number }[],
  reading: JapaneseReading,
): RenderPlan | undefined {
  const parsed: ParsedLine = {
    id: `japanese-provider-only-${times[0]?.StartTime ?? 0}`,
    displayText: sourceText,
    paragraphProvenance: "unavailable",
    spans: spans.map((span, index) => ({
      id: String(span.index),
      rawText: sourceText.slice(span.start, span.end),
      cleanText: span.normalizedText,
      startMs: Number(times[span.index]?.StartTime ?? 0),
      endMs: Number(times[span.index]?.EndTime ?? 0),
      providerPartOfWord: !/\s/u.test(
        sourceText.slice(span.end, spans[index + 1]?.start ?? sourceText.length),
      ),
    })),
  };
  const canonical = buildCanonicalLine(parsed);
  if (canonical.text !== sourceText) return undefined;
  const timingRefs = canonical.spanMappings.map((mapping) => mapping.spanId);
  const provenance = reading.romajiSegments?.[0]?.provenance ?? "providerExplicit";
  const annotation: ReadingAnnotation = {
    processor: "JapaneseProvider",
    mode: "providerOnly",
    provenance,
    units: reading.romaji === undefined || timingRefs.length === 0
      ? []
      : [{
          canonicalRange: { startCp: 0, endCp: Array.from(canonical.text).length },
          text: reading.romaji,
          kind: "transformed",
          logicalGroupId: "japanese-provider-line",
          timingRefs: [timingRefs[0]],
          ...(timingRefs.length > 1 ? { animationTimingRefs: timingRefs } : {}),
          provenance,
        }],
    furigana: reading.furigana.map((segment) => ({
      canonicalRange: {
        startCp: utf16IndexToCodePointOffset(sourceText, segment.start),
        endCp: utf16IndexToCodePointOffset(sourceText, segment.end),
      },
      reading: segment.reading,
      provenance: segment.provenance ?? "providerExplicit",
    })),
  };
  const plan = buildRenderPlan(parsed, canonical, [annotation]);
  return validateRenderPlan(plan).valid ? plan : undefined;
}

export function sourceOwnerSpans(sourceText: string): ProviderJapaneseOwnerSpan[] {
  return [{
    index: 0,
    rawText: sourceText,
    normalizedText: sourceText,
    start: 0,
    end: sourceText.length,
  }];
}
