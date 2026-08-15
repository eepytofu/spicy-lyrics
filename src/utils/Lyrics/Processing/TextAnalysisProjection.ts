export type TextRange = {
  readonly start: number;
  readonly end: number;
};

type ProjectionSegment = {
  readonly displayUtf16: TextRange;
  readonly analysisUtf16: TextRange;
  readonly displayCp: TextRange;
  readonly analysisCp: TextRange;
};

export type TextAnalysisProjection = {
  readonly displayText: string;
  readonly analysisText: string;
  readonly segments: readonly ProjectionSegment[];
  readonly coordinateSafe: boolean;
};

const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

const codePointLength = (value: string): number => Array.from(value).length;

export function buildTextAnalysisProjection(displayText: string): TextAnalysisProjection {
  const analysisText = displayText.normalize("NFKC");
  let materialized:
    | { segments: readonly ProjectionSegment[]; coordinateSafe: boolean }
    | undefined;
  const materialize = () => {
    if (materialized) return materialized;
    if (analysisText === displayText) {
      const utf16End = displayText.length;
      const cpEnd = codePointLength(displayText);
      materialized = {
        segments: displayText
          ? [{
              displayUtf16: { start: 0, end: utf16End },
              analysisUtf16: { start: 0, end: utf16End },
              displayCp: { start: 0, end: cpEnd },
              analysisCp: { start: 0, end: cpEnd },
            }]
          : [],
        coordinateSafe: true,
      };
      return materialized;
    }

    const parts = graphemeSegmenter
      ? Array.from(graphemeSegmenter.segment(displayText), ({ segment }) => segment)
      : Array.from(displayText);
    const segments: ProjectionSegment[] = [];
    let displayUtf16 = 0;
    let analysisUtf16 = 0;
    let displayCp = 0;
    let analysisCp = 0;
    let segmentedAnalysis = "";

    for (const part of parts) {
      const normalized = part.normalize("NFKC");
      const displayUtf16End = displayUtf16 + part.length;
      const analysisUtf16End = analysisUtf16 + normalized.length;
      const displayCpEnd = displayCp + codePointLength(part);
      const analysisCpEnd = analysisCp + codePointLength(normalized);
      segments.push({
        displayUtf16: { start: displayUtf16, end: displayUtf16End },
        analysisUtf16: { start: analysisUtf16, end: analysisUtf16End },
        displayCp: { start: displayCp, end: displayCpEnd },
        analysisCp: { start: analysisCp, end: analysisCpEnd },
      });
      segmentedAnalysis += normalized;
      displayUtf16 = displayUtf16End;
      analysisUtf16 = analysisUtf16End;
      displayCp = displayCpEnd;
      analysisCp = analysisCpEnd;
    }
    materialized = {
      segments,
      coordinateSafe: segmentedAnalysis === analysisText,
    };
    return materialized;
  };

  return {
    displayText,
    analysisText,
    get segments() {
      return materialize().segments;
    },
    get coordinateSafe() {
      return materialize().coordinateSafe;
    },
  };
}

function mapBoundary(
  projection: TextAnalysisProjection,
  offset: number,
  from: "analysisUtf16" | "analysisCp" | "displayUtf16" | "displayCp",
  to: "analysisUtf16" | "analysisCp" | "displayUtf16" | "displayCp",
): number | undefined {
  if (!projection.coordinateSafe) return undefined;
  if (offset === 0) return 0;
  const final = projection.segments.at(-1);
  if (!final) return offset === 0 ? 0 : undefined;
  if (offset === final[from].end) return final[to].end;

  for (const segment of projection.segments) {
    if (offset === segment[from].start) return segment[to].start;
    if (offset === segment[from].end) return segment[to].end;
    if (offset > segment[from].start && offset < segment[from].end) {
      const fromLength = segment[from].end - segment[from].start;
      const toLength = segment[to].end - segment[to].start;
      if (fromLength !== toLength) return undefined;
      return segment[to].start + (offset - segment[from].start);
    }
  }
  return undefined;
}

function mapRange(
  projection: TextAnalysisProjection,
  range: TextRange,
  from: "analysisUtf16" | "analysisCp" | "displayUtf16" | "displayCp",
  to: "analysisUtf16" | "analysisCp" | "displayUtf16" | "displayCp",
): TextRange | undefined {
  if (range.start < 0 || range.end < range.start) return undefined;
  const start = mapBoundary(projection, range.start, from, to);
  const end = mapBoundary(projection, range.end, from, to);
  return start === undefined || end === undefined || end < start ? undefined : { start, end };
}

export const mapAnalysisUtf16RangeToDisplay = (
  projection: TextAnalysisProjection,
  range: TextRange,
): TextRange | undefined => mapRange(projection, range, "analysisUtf16", "displayUtf16");

export const mapDisplayUtf16RangeToAnalysis = (
  projection: TextAnalysisProjection,
  range: TextRange,
): TextRange | undefined => mapRange(projection, range, "displayUtf16", "analysisUtf16");

export const mapAnalysisCodePointRangeToDisplay = (
  projection: TextAnalysisProjection,
  range: TextRange,
): TextRange | undefined => mapRange(projection, range, "analysisCp", "displayCp");

export const mapDisplayCodePointRangeToAnalysis = (
  projection: TextAnalysisProjection,
  range: TextRange,
): TextRange | undefined => mapRange(projection, range, "displayCp", "analysisCp");
