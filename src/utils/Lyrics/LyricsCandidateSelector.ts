import { convertChineseText } from "./ChineseCharacterConversion.ts";

export type LyricsSelectionMode = "smart" | "syncType" | "strict";

export type LyricsMatchMetadata = {
  title?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
  confidence?: number;
  score?: number;
  method?: string;
};

export type LyricsCandidate = {
  provider: string;
  orderIndex: number;
  lyrics: any;
  match?: LyricsMatchMetadata;
};

export type LyricsCandidateAssessment = {
  provider: string;
  format: "Syllable" | "Line" | "Static" | "Unknown";
  totalScore: number;
  trackMatchScore: number;
  timingScore: number;
  textAgreementScore: number;
  syncDetailScore: number;
  priorityScore: number;
  rejected: boolean;
  reasons: string[];
};

export type LyricsSelectionDiagnostics = {
  mode: LyricsSelectionMode;
  selectedProvider: string | null;
  candidates: LyricsCandidateAssessment[];
};

export type LyricsSelectionResult = {
  candidate: LyricsCandidate | null;
  diagnostics: LyricsSelectionDiagnostics;
};

type LineSnapshot = { text: string; normalized: string; start?: number; end?: number };

const PLAIN_LYRICS_PENALTY = 15;

const CREDIT_LINE = /^(?:作\s*[词詞曲]|编\s*曲|編\s*曲|词\s*曲|詞\s*曲|制作人|製作人|监\s*制|監\s*製|lyric(?:s|ist)?|composer|arranger|producer)\s*[:：]/iu;

function finite(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeLyricsComparisonText(value: string): string {
  const simplified = convertChineseText(String(value || "").normalize("NFKC"), "simplified");
  return simplified.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function syllableText(syllables: any[]): string {
  return syllables.map((syllable) => String(syllable?.Text ?? "")).join("");
}

export function lyricsLineSnapshots(lyrics: any): LineSnapshot[] {
  if (lyrics?.Type === "Static") {
    return (lyrics.Lines ?? []).flatMap((line: any): LineSnapshot[] => {
      const text = String(line?.Text ?? "").trim();
      return text && !CREDIT_LINE.test(text) ? [{ text, normalized: normalizeLyricsComparisonText(text) }] : [];
    });
  }
  if (lyrics?.Type === "Line") {
    return (lyrics.Content ?? []).flatMap((line: any): LineSnapshot[] => {
      const text = String(line?.Text ?? "").trim();
      if (!text || CREDIT_LINE.test(text)) return [];
      return [{ text, normalized: normalizeLyricsComparisonText(text), start: finite(line?.StartTime), end: finite(line?.EndTime) }];
    });
  }
  if (lyrics?.Type === "Syllable") {
    return (lyrics.Content ?? []).flatMap((vocal: any): LineSnapshot[] => {
      const lead = vocal?.Lead;
      const text = syllableText(Array.isArray(lead?.Syllables) ? lead.Syllables : []).trim();
      if (!text || CREDIT_LINE.test(text)) return [];
      return [{ text, normalized: normalizeLyricsComparisonText(text), start: finite(lead?.StartTime), end: finite(lead?.EndTime) }];
    });
  }
  return [];
}

function ngrams(value: string, width = 2): Map<string, number> {
  const points = Array.from(value);
  const output = new Map<string, number>();
  if (points.length < width) {
    if (value) output.set(value, 1);
    return output;
  }
  for (let index = 0; index <= points.length - width; index += 1) {
    const gram = points.slice(index, index + width).join("");
    output.set(gram, (output.get(gram) ?? 0) + 1);
  }
  return output;
}

export function lyricsTextSimilarity(left: any, right: any): number {
  const leftText = lyricsLineSnapshots(left).map((line) => line.normalized).join("");
  const rightText = lyricsLineSnapshots(right).map((line) => line.normalized).join("");
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;
  const leftGrams = ngrams(leftText);
  const rightGrams = ngrams(rightText);
  let overlap = 0;
  let leftCount = 0;
  let rightCount = 0;
  for (const count of leftGrams.values()) leftCount += count;
  for (const count of rightGrams.values()) rightCount += count;
  for (const [gram, count] of leftGrams) overlap += Math.min(count, rightGrams.get(gram) ?? 0);
  return leftCount + rightCount ? (2 * overlap) / (leftCount + rightCount) : 0;
}

function structuralTimingScore(candidate: LyricsCandidate, durationMs: number): number {
  const lyrics = candidate.lyrics;
  if (lyrics?.Type === "Static") return lyricsLineSnapshots(lyrics).length >= 3 ? 55 : 25;
  const lines = lyricsLineSnapshots(lyrics);
  if (!lines.length) return 0;
  const duration = Math.max(1, durationMs / 1000);
  let invalid = 0;
  let backwards = 0;
  let previousStart = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    if (line.start === undefined || line.end === undefined || line.start < -0.5 || line.end < line.start) invalid += 1;
    if (line.start !== undefined && line.start + 0.25 < previousStart) backwards += 1;
    if (line.start !== undefined) previousStart = Math.max(previousStart, line.start);
  }
  let score = 100 - (invalid / lines.length) * 90 - (backwards / lines.length) * 45;
  const finiteLines = lines.filter((line) => line.start !== undefined && line.end !== undefined);
  if (finiteLines.length) {
    const first = Math.min(...finiteLines.map((line) => line.start!));
    const last = Math.max(...finiteLines.map((line) => line.end!));
    const coverage = (last - Math.max(0, first)) / duration;
    if (coverage < 0.25) score -= 35;
    else if (coverage < 0.45) score -= 18;
    if (last > duration + 15) score -= Math.min(35, (last - duration - 15) * 1.5);
  }
  if (lines.length < 3) score -= 20;
  if (lyrics?.Type === "Syllable") {
    let words = 0;
    let invalidWords = 0;
    for (const vocal of lyrics.Content ?? []) {
      const syllables = Array.isArray(vocal?.Lead?.Syllables) ? vocal.Lead.Syllables : [];
      let previousWordStart = Number.NEGATIVE_INFINITY;
      for (const word of syllables) {
        words += 1;
        const start = finite(word?.StartTime);
        const end = finite(word?.EndTime);
        if (start === undefined || end === undefined || end <= start || start + 0.05 < previousWordStart || end > duration + 15) invalidWords += 1;
        if (start !== undefined) previousWordStart = Math.max(previousWordStart, start);
      }
    }
    if (words < lines.length * 1.25) score -= 20;
    if (words) score -= (invalidWords / words) * 100;
  }
  return clamp(score);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function timingAgreementScore(candidate: LyricsCandidate, peers: LyricsCandidate[]): number {
  const candidateLines = lyricsLineSnapshots(candidate.lyrics);
  const deltas: number[] = [];
  for (const peer of peers) {
    if (peer === candidate || lyricsTextSimilarity(candidate.lyrics, peer.lyrics) < 0.58) continue;
    const peerBuckets = new Map<string, number[]>();
    for (const line of lyricsLineSnapshots(peer.lyrics)) {
      if (line.normalized.length < 4 || line.start === undefined) continue;
      const bucket = peerBuckets.get(line.normalized) ?? [];
      bucket.push(line.start);
      peerBuckets.set(line.normalized, bucket);
    }
    const occurrences = new Map<string, number>();
    for (const line of candidateLines) {
      if (line.normalized.length < 4 || line.start === undefined) continue;
      const index = occurrences.get(line.normalized) ?? 0;
      occurrences.set(line.normalized, index + 1);
      const peerStart = peerBuckets.get(line.normalized)?.[index];
      if (peerStart !== undefined) deltas.push(Math.abs(line.start - peerStart));
    }
  }
  if (deltas.length < 3) return 65;
  const difference = median(deltas);
  if (difference <= 0.75) return 100;
  if (difference <= 1.5) return 85;
  if (difference <= 3) return 60;
  if (difference <= 7) return 30;
  return 5;
}

function matchScore(match: LyricsMatchMetadata | undefined): number {
  if (Number.isFinite(match?.confidence)) return clamp(Number(match!.confidence) * 100);
  if (Number.isFinite(match?.score)) return clamp((Number(match!.score) / 110) * 100);
  return 65;
}

function agreementScore(candidate: LyricsCandidate, candidates: LyricsCandidate[]): number {
  const similarities = candidates
    .filter((peer) => peer !== candidate)
    .map((peer) => lyricsTextSimilarity(candidate.lyrics, peer.lyrics))
    .sort((a, b) => b - a);
  if (!similarities.length) return 65;
  const agreeing = similarities.filter((similarity) => similarity >= 0.58);
  const evidence = agreeing.length ? agreeing : similarities.slice(0, Math.min(2, similarities.length));
  return clamp((evidence.reduce((sum, value) => sum + value, 0) / evidence.length) * 100);
}

function syncDetailScore(lyrics: any): number {
  return lyrics?.Type === "Syllable" ? 100 : lyrics?.Type === "Line" ? 70 : lyrics?.Type === "Static" ? 20 : 0;
}

function reasonList(track: number, structural: number, timingAgreement: number, agreement: number, format: LyricsCandidateAssessment["format"]): string[] {
  const reasons: string[] = [];
  reasons.push(track >= 85 ? "strong track match" : track < 45 ? "weak track match" : "usable track match");
  reasons.push(format === "Static" ? "no synced timing" : structural >= 80 ? "healthy timing" : structural < 45 ? "suspicious timing" : "usable timing");
  if (agreement >= 78) reasons.push("lyrics agree with other sources");
  else if (agreement < 42) reasons.push("low text agreement");
  if (format !== "Static" && timingAgreement < 45) reasons.push("line timing differs from agreeing sources");
  return reasons;
}

export function assessLyricsCandidates(candidates: LyricsCandidate[], durationMs: number): LyricsCandidateAssessment[] {
  const priorityOrder = [...candidates].sort((left, right) => left.orderIndex - right.orderIndex);
  return candidates.map((candidate) => {
    const track = matchScore(candidate.match);
    const structural = structuralTimingScore(candidate, durationMs);
    const timingAgreement = timingAgreementScore(candidate, candidates);
    const timing = structural * 0.7 + timingAgreement * 0.3;
    const agreement = agreementScore(candidate, candidates);
    const detail = syncDetailScore(candidate.lyrics);
    const format: LyricsCandidateAssessment["format"] = ["Syllable", "Line", "Static"].includes(candidate.lyrics?.Type) ? candidate.lyrics.Type : "Unknown";
    const priorityRank = priorityOrder.indexOf(candidate);
    const priority = candidates.length === 1 ? 100 : 100 * (1 - priorityRank / (candidates.length - 1));
    const rejected = track < 30 || structural < 25 || detail === 0;
    const plainPenalty = format === "Static" ? PLAIN_LYRICS_PENALTY : 0;
    const total = rejected ? 0 : clamp(track * 0.4 + timing * 0.3 + agreement * 0.2 + detail * 0.05 + clamp(priority) * 0.05 - plainPenalty);
    return {
      provider: candidate.provider,
      format,
      totalScore: rounded(total),
      trackMatchScore: rounded(track),
      timingScore: rounded(timing),
      textAgreementScore: rounded(agreement),
      syncDetailScore: detail,
      priorityScore: rounded(clamp(priority)),
      rejected,
      reasons: reasonList(track, structural, timingAgreement, agreement, format),
    };
  });
}

function legacyCandidate(candidates: LyricsCandidate[], appleTieOverride: boolean): LyricsCandidate | null {
  let best: LyricsCandidate | null = null;
  for (const candidate of candidates) {
    const candidateDetail = syncDetailScore(candidate.lyrics);
    const bestDetail = syncDetailScore(best?.lyrics);
    if (!best || candidateDetail > bestDetail || (appleTieOverride && candidate.provider === "apple" && candidateDetail === bestDetail)) best = candidate;
  }
  return best;
}

export function selectLyricsCandidate(
  candidates: LyricsCandidate[],
  durationMs: number,
  mode: LyricsSelectionMode,
  appleTieOverride = false,
): LyricsSelectionResult {
  const ordered = [...candidates].sort((a, b) => a.orderIndex - b.orderIndex);
  const assessments = assessLyricsCandidates(ordered, durationMs);
  let candidate: LyricsCandidate | null = null;
  if (mode === "strict") candidate = ordered[0] ?? null;
  else if (mode === "syncType") candidate = legacyCandidate(ordered, appleTieOverride);
  else {
    const assessmentByProvider = new Map(assessments.map((assessment) => [assessment.provider, assessment]));
    candidate = [...ordered].sort((left, right) => {
      const leftAssessment = assessmentByProvider.get(left.provider);
      const rightAssessment = assessmentByProvider.get(right.provider);
      const scoreDifference = (rightAssessment?.totalScore ?? 0) - (leftAssessment?.totalScore ?? 0);
      if (Math.abs(scoreDifference) > 4) return scoreDifference;
      const detailDifference = (rightAssessment?.syncDetailScore ?? 0) - (leftAssessment?.syncDetailScore ?? 0);
      return detailDifference || scoreDifference || left.orderIndex - right.orderIndex;
    }).find((entry) => !assessmentByProvider.get(entry.provider)?.rejected) ?? null;
  }
  return {
    candidate,
    diagnostics: { mode, selectedProvider: candidate?.provider ?? null, candidates: assessments },
  };
}
