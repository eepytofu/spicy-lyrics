import type { JapaneseTokenEntry } from "../../Reading/JapaneseReadingModel.ts";
import type { JapaneseAnalyzerToken } from "./JapaneseAnalyzer.ts";
import {
  deinflectJapaneseSurface,
  type JapaneseDeinflectionCandidate,
} from "./JapaneseDeinflection.ts";

export type JapaneseDeinflectionResolverStatus =
  | "corrected"
  | "wouldCorrect"
  | "agreesWithProduction"
  | "providerWins"
  | "ambiguous"
  | "geometryMissing"
  | "overlap"
  | "budgetExceeded";

export type JapaneseDeinflectionResolverRecord = {
  status: JapaneseDeinflectionResolverStatus;
  start: number;
  end: number;
  surface: string;
  baselineReading?: string;
  lemma?: string;
  lemmaReading?: string;
  projectedReading?: string;
  traceFamilies?: readonly string[];
  candidateCount?: number;
};

const MAX_SPAN_TOKENS = 6;
const MAX_SPAN_UTF16 = 32;
const JAPANESE_TERM = /^[々〆ヶぁ-ゖァ-ヺー一-鿿豈-﫿]+$/u;
const HAS_KANJI = /[々〆ヶ一-鿿豈-﫿]/u;
const CONTEXTUALLY_AMBIGUOUS_SURFACES = new Set(["大人気なく"]);

type SafeSpan = {
  startToken: number;
  endToken: number;
  start: number;
  end: number;
  surface: string;
  candidate: JapaneseDeinflectionCandidate;
};

function recordForSpan(
  status: JapaneseDeinflectionResolverStatus,
  span: Omit<SafeSpan, "candidate">,
  details: Partial<JapaneseDeinflectionResolverRecord> = {},
): JapaneseDeinflectionResolverRecord {
  return {
    status,
    start: span.start,
    end: span.end,
    surface: span.surface,
    ...details,
  };
}

function spansOverlap(left: SafeSpan, right: SafeSpan): boolean {
  return left.start < right.end && right.start < left.end;
}

function baselineReading(
  entries: readonly JapaneseTokenEntry[],
  startToken: number,
  endToken: number,
): string {
  return entries
    .slice(startToken, endToken + 1)
    .filter((entry) => !entry.consumed)
    .map((entry) => entry.readingKana)
    .join("");
}

function hasProviderReading(
  entries: readonly JapaneseTokenEntry[],
  startToken: number,
  endToken: number,
): boolean {
  return entries
    .slice(startToken, endToken + 1)
    .some((entry) => entry.readingProvenance === "providerExplicit");
}

export async function collectJapaneseDeinflectionCandidates(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[],
  entries: readonly JapaneseTokenEntry[],
): Promise<JapaneseDeinflectionResolverRecord[]> {
  const records: JapaneseDeinflectionResolverRecord[] = [];
  const safeSpans: SafeSpan[] = [];

  for (let startToken = 0; startToken < tokens.length; startToken += 1) {
    if (tokens[startToken].morphologyFeatures.includes("suffix")) continue;
    for (
      let endToken = startToken;
      endToken < tokens.length && endToken < startToken + MAX_SPAN_TOKENS;
      endToken += 1
    ) {
      if (endToken > startToken && tokens[endToken - 1].end !== tokens[endToken].start) break;
      const start = tokens[startToken].start;
      const end = tokens[endToken].end;
      const surface = text.slice(start, end);
      if (surface.length > MAX_SPAN_UTF16) break;
      if (!JAPANESE_TERM.test(surface)) break;
      if (!HAS_KANJI.test(surface)) continue;

      const span = { startToken, endToken, start, end, surface };
      if (CONTEXTUALLY_AMBIGUOUS_SURFACES.has(surface)) {
        records.push(recordForSpan("ambiguous", span, { candidateCount: 2 }));
        continue;
      }
      const result = await deinflectJapaneseSurface(surface);
      if (result.budgetExceeded) {
        records.push(recordForSpan("budgetExceeded", span));
        continue;
      }
      if (result.rejectedAmbiguous > 0) {
        records.push(recordForSpan("ambiguous", span, {
          candidateCount: result.candidates.length + result.rejectedAmbiguous,
        }));
        continue;
      }
      if (result.candidates.length === 0) {
        if (result.rejectedGeometry > 0) {
          records.push(recordForSpan("geometryMissing", span));
        }
        continue;
      }
      if (result.candidates.length !== 1) {
        records.push(recordForSpan("ambiguous", span, {
          candidateCount: result.candidates.length,
        }));
        continue;
      }
      safeSpans.push({ ...span, candidate: result.candidates[0] });
    }
  }

  // A shorter prefix carrying the same lemma/readout is only an incomplete
  // conjugation of the longer span, not an independent overlap.
  const maximalSpans = safeSpans.filter((span) => !safeSpans.some((other) =>
    other !== span
    && other.start === span.start
    && other.end > span.end
    && other.candidate.lemma === span.candidate.lemma
    && other.candidate.projectedReading.startsWith(span.candidate.projectedReading)
  ));

  for (const span of maximalSpans) {
    if (maximalSpans.some((other) => other !== span && spansOverlap(span, other))) {
      records.push(recordForSpan("overlap", span, {
        lemma: span.candidate.lemma,
        projectedReading: span.candidate.projectedReading,
      }));
      continue;
    }
    const baseline = baselineReading(entries, span.startToken, span.endToken);
    const details = {
      baselineReading: baseline,
      lemma: span.candidate.lemma,
      lemmaReading: span.candidate.lemmaReading,
      projectedReading: span.candidate.projectedReading,
      traceFamilies: span.candidate.trace.map((frame) => frame.family),
    };
    const status = hasProviderReading(entries, span.startToken, span.endToken)
      ? "providerWins"
      : baseline === span.candidate.projectedReading
        ? "agreesWithProduction"
        : "wouldCorrect";
    records.push(recordForSpan(status, span, details));
  }

  return records;
}

function applyJapaneseDeinflectionCorrection(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[],
  entries: readonly JapaneseTokenEntry[],
  record: JapaneseDeinflectionResolverRecord,
): JapaneseDeinflectionResolverRecord {
  if (record.status !== "wouldCorrect" || !record.projectedReading) return record;
  const startToken = tokens.findIndex((token) => token.start === record.start);
  const endToken = tokens.findIndex((token) => token.end === record.end);
  if (startToken < 0 || endToken < startToken) return record;
  const ownedEntries = entries.slice(startToken, endToken + 1);
  if (
    ownedEntries.length !== endToken - startToken + 1
    || ownedEntries.some((entry) => entry.consumed)
    || baselineReading(entries, startToken, endToken) !== record.baselineReading
  ) {
    return record;
  }

  const first = entries[startToken];
  first.surface = text.slice(record.start, record.end);
  first.end = record.end;
  first.readingKana = record.projectedReading;
  first.furigana = undefined;
  const readingGroupId = `deinflection:${record.start}:${record.end}`;
  for (let index = startToken; index <= endToken; index += 1) {
    entries[index].readingGroupId = readingGroupId;
    if (index > startToken) entries[index].consumed = true;
  }
  return { ...record, status: "corrected" };
}

export async function resolveJapaneseDeinflectionReadings(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[],
  entries: readonly JapaneseTokenEntry[],
): Promise<readonly JapaneseDeinflectionResolverRecord[]> {
  let records: JapaneseDeinflectionResolverRecord[];
  try {
    records = await collectJapaneseDeinflectionCandidates(text, tokens, entries);
  } catch (error) {
    console.error("[Spicy Lyrics][Japanese deinflection resolver] analysis failed", error);
    return [];
  }
  return records.map((record) =>
    applyJapaneseDeinflectionCorrection(text, tokens, entries, record));
}
