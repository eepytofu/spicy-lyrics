import OpenCC from "opencc-js";
import type { ProviderMatchMetadata, TrackMetadata } from "../types";

// Search-query and metadata-matching behavior is adapted from Lyricify Lyrics
// Helper (Apache-2.0). The implementation and safety gates here are specific to
// Spicy Lyrics. See worker/NOTICE.md and worker/LICENSES/Apache-2.0.txt.

const traditionalToSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
const languageTags = new Set(["粤", "粤语", "国", "国语", "普通话", "台", "台语", "闽南语", "日", "日语", "日文", "韩", "韩语", "韩文", "英", "英语", "英文"]);
const versionPatterns: Array<[string, RegExp]> = [
  ["remix", /\bremix(?:ed)?\b|混音|重混/iu],
  ["dj", /(?:^|[^\p{L}\p{N}])dj(?:$|[^\p{L}\p{N}])|dj(?:\p{Script=Han}{0,6})?版/iu],
  ["live", /\blive\b|现场(?:版)?|演唱会版/iu],
  ["instrumental", /\binstrumental\b|伴奏(?:版)?|纯音乐/iu],
  ["karaoke", /\bkaraoke\b|卡拉ok/iu],
  ["acoustic", /\bacoustic\b|不插电/iu],
  ["sped-up", /\bsped\s*up\b|加速版/iu],
  ["slowed", /\bslowed\b|慢速版/iu],
  ["cover", /\bcover\b|翻唱/iu],
  ["demo", /\bdemo\b|小样/iu],
];

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function simplify(value: string): string {
  return traditionalToSimplified(value.normalize("NFKC"));
}

function compact(value: string): string {
  return simplify(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function stripLanguageTags(value: string): string {
  return value.replace(/\(([^)]*)\)|\[([^\]]*)\]|（([^）]*)）|【([^】]*)】/gu, (match, ...groups: string[]) => {
    const tag = groups.find((group) => typeof group === "string") ?? "";
    return languageTags.has(compact(tag)) ? "" : match;
  });
}

export function normalize(value: string): string {
  return compact(stripLanguageTags(value));
}

export function versionTags(value: string): Set<string> {
  const simplified = simplify(value).toLowerCase();
  return new Set(versionPatterns.filter(([, pattern]) => pattern.test(simplified)).map(([tag]) => tag));
}

const softTitleTag = /\b(?:feat(?:uring)?\.?|ft\.?|with|explicit|deluxe(?:\s+edition)?|special\s+edition|bonus\s+track)\b/iu;
const artistSeparator = /\s*(?:,|，|、|\/|／|;|；|&|＆)\s*|\s+(?:feat(?:uring)?\.?|ft\.?|with|x)\s+/giu;

function stripSoftTitleSuffix(value: string): string {
  let result = simplify(value).trim();
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result
      .replace(/\s+(?:-|–|—)\s*(?:feat(?:uring)?\.?|ft\.?|with)\s+.+$/iu, "")
      .replace(/\s*(?:\(|\[|（|【)([^)\]）】]+)(?:\)|\]|）|】)\s*$/u, (match, inner: string) => softTitleTag.test(inner) ? "" : match)
      .trim();
  }
  return result;
}

function artistForms(value: string): string[] {
  const withoutOfficial = value.replace(/official(?:\s*(?:account|channel|music))?\s*$/iu, "");
  const withoutCjkInfinity = value.replace(/(?<=\p{Script=Han})infinity\s*$/iu, "");
  const pieces = value.split(artistSeparator);
  return unique([value, withoutOfficial, withoutCjkInfinity, ...pieces].map(normalize));
}

function versionConflict(wanted: string, candidate: string): boolean {
  const wantedTags = versionTags(wanted);
  const candidateTags = versionTags(candidate);
  if (!wantedTags.size && !candidateTags.size) return false;
  return wantedTags.size !== candidateTags.size || [...wantedTags].some((tag) => !candidateTags.has(tag));
}

function similarity(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  if (!a.length || !b.length) return 0;
  if (left === right) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function localizedSuffixEvidence(wanted: string, candidate: string): number {
  const wantedTokens = simplify(wanted).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const candidateTokens = simplify(candidate).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  let sharedPrefix = 0;
  while (wantedTokens[sharedPrefix] && wantedTokens[sharedPrefix] === candidateTokens[sharedPrefix]) sharedPrefix += 1;
  if (sharedPrefix < 2 || sharedPrefix / Math.min(wantedTokens.length, candidateTokens.length) < 0.6) return 0;

  const wantedSuffix = wantedTokens.slice(sharedPrefix).join("");
  const candidateSuffix = candidateTokens.slice(sharedPrefix).join("");
  if (!wantedSuffix || !candidateSuffix) return 0.72;

  const hasLatin = (value: string) => /\p{Script=Latin}/u.test(value);
  const hasCjk = (value: string) => /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(value);
  const suffixesUseDifferentScripts =
    (hasLatin(wantedSuffix) && !hasCjk(wantedSuffix) && hasCjk(candidateSuffix) && !hasLatin(candidateSuffix))
    || (hasCjk(wantedSuffix) && !hasLatin(wantedSuffix) && hasLatin(candidateSuffix) && !hasCjk(candidateSuffix));
  return suffixesUseDifferentScripts ? 0.72 : 0;
}

function nameEvidence(wanted: string, candidate: string): number {
  const normalizedWanted = normalize(wanted);
  const normalizedCandidate = normalize(candidate);
  if (!normalizedWanted || !normalizedCandidate) return 0;
  if (normalizedWanted === normalizedCandidate) return 1;

  const baseWanted = compact(stripSoftTitleSuffix(wanted));
  const baseCandidate = compact(stripSoftTitleSuffix(candidate));
  if (baseWanted && baseWanted === baseCandidate) return 0.94;

  const shorter = normalizedWanted.length <= normalizedCandidate.length ? normalizedWanted : normalizedCandidate;
  const longer = shorter === normalizedWanted ? normalizedCandidate : normalizedWanted;
  if (shorter.length >= 4 && longer.includes(shorter)) return 0.72;
  const localizedSuffix = localizedSuffixEvidence(wanted, candidate);
  if (localizedSuffix) return localizedSuffix;

  const ratio = similarity(normalizedWanted, normalizedCandidate);
  if (ratio >= 0.9) return 0.9;
  if (ratio >= 0.8) return 0.8;
  if (ratio >= 0.68) return 0.65;
  if (ratio >= 0.55) return 0.45;
  return 0;
}

function artistEvidence(wanted: string[], candidate: string[]): number | null {
  const wantedForms = unique(wanted.flatMap(artistForms));
  const candidateForms = unique(candidate.flatMap(artistForms));
  if (!wantedForms.length || !candidateForms.length) return null;

  if (wanted.length > 5 && candidateForms.some((artist) => artist === "variousartists" || artist === "群星")) return 0.85;

  const exact = wantedForms.filter((artist) => candidateForms.includes(artist));
  if (exact.length === wantedForms.length && exact.length === candidateForms.length) return 1;

  const perArtist = wanted.map((artist) => {
    const forms = artistForms(artist);
    let best = 0;
    for (const wantedForm of forms) {
      for (const candidateForm of candidateForms) {
        const shorterLength = Math.min([...wantedForm].length, [...candidateForm].length);
        if (wantedForm === candidateForm) best = Math.max(best, 1);
        else if (shorterLength >= 3 && (wantedForm.includes(candidateForm) || candidateForm.includes(wantedForm))) best = Math.max(best, 0.75);
        else if (shorterLength >= 4 && similarity(wantedForm, candidateForm) >= 0.8) best = Math.max(best, 0.65);
      }
    }
    return best;
  });
  const coverage = perArtist.reduce((sum, value) => sum + value, 0) / Math.max(1, perArtist.length);
  if (coverage >= 0.99) return candidateForms.length > wantedForms.length ? 0.95 : 1;
  if (coverage >= 0.8) return 0.88;
  if (coverage >= 0.55) return 0.65;
  if (coverage > 0) return 0.4;
  return 0;
}

function durationEvidence(wanted?: number, candidate?: number): number | null {
  if (!wanted || !candidate) return null;
  const difference = Math.abs(wanted - candidate);
  if (difference === 0) return 1;
  if (difference < 300) return 0.95;
  if (difference < 700) return 0.9;
  if (difference < 1500) return 0.8;
  if (difference < 3500) return 0.55;
  return 0;
}

export type TrackCandidate = {
  title: string;
  artists: string[];
  album?: string;
  albumArtists?: string[];
  durationMs?: number;
};

export type CandidateAssessment = {
  score: number;
  confidence: number;
  coherent: boolean;
  evidence: {
    title: number;
    artists: number | null;
    album: number | null;
    albumArtists: number | null;
    duration: number | null;
    versionConflict: boolean;
  };
};

export function searchQueries(track: TrackMetadata): string[] {
  const title = track.title.trim();
  const artists = track.artists.map((artist) => artist.trim()).filter(Boolean).join(" ");
  const album = track.album.trim();
  const baseTitle = stripSoftTitleSuffix(title);
  const titleVariants = unique([simplify(title), title]);
  const baseTitleVariants = unique([simplify(baseTitle), baseTitle]);
  const artistVariants = unique([simplify(artists), artists]);
  const albumVariants = unique([simplify(album), album]);
  const queries: string[] = [];
  for (let index = 0; index < titleVariants.length; index += 1) {
    const candidateTitle = titleVariants[index];
    const candidateArtists = artistVariants[Math.min(index, artistVariants.length - 1)] ?? artists;
    const candidateAlbum = albumVariants[Math.min(index, albumVariants.length - 1)] ?? album;
    queries.push(`${candidateTitle} ${candidateArtists} ${candidateAlbum}`);
  }
  for (let index = 0; index < baseTitleVariants.length; index += 1) {
    const candidateArtists = artistVariants[Math.min(index, artistVariants.length - 1)] ?? artists;
    queries.push(`${baseTitleVariants[index]} ${candidateArtists}`);
  }
  queries.push(...baseTitleVariants, ...titleVariants);
  return unique(queries);
}

export function assessCandidate(track: TrackMetadata, candidate: TrackCandidate): CandidateAssessment {
  const conflict = versionConflict(track.title, candidate.title);
  const title = candidate.title.trim() ? nameEvidence(track.title, candidate.title) : 0;
  const artists = artistEvidence(track.artists, candidate.artists);
  const album = track.album.trim() && candidate.album?.trim() ? nameEvidence(track.album, candidate.album) : null;
  const albumArtists = candidate.albumArtists?.length ? artistEvidence(track.artists, candidate.albumArtists) : null;
  const duration = durationEvidence(track.durationMs, candidate.durationMs);
  if (!normalize(track.title) || !normalize(candidate.title)) {
    return {
      score: -100,
      confidence: 0,
      coherent: false,
      evidence: { title, artists, album, albumArtists, duration, versionConflict: conflict },
    };
  }

  // Lyricify treats title, artist, and duration as equal primary evidence,
  // with album and album-artist metadata as lighter supporting evidence.
  const fields: Array<[number, number | null]> = [
    [30, title],
    [30, artists],
    [12, album],
    [6, albumArtists],
    [30, duration],
  ];
  const availableMaximum = fields.reduce((sum, [weight, evidence]) => sum + (evidence === null ? 0 : weight), 0);
  const rawScore = fields.reduce((sum, [weight, evidence]) => sum + weight * (evidence ?? 0), 0);
  const scaledScore = rawScore * 110 / Math.max(30, availableMaximum);
  // A title-version disagreement remains recoverable when album or duration
  // corroborates the identity. Legacy results with neither must not inflate a
  // base/original title into a confident match for an explicit DJ/live/remix.
  const versionPenalty = conflict ? (album === null && duration === null ? 55 : 18) : 0;
  const score = Math.round(Math.max(0, Math.min(110, scaledScore - versionPenalty)) * 100) / 100;
  const coherent = title > 0 || (title === 0 && (artists ?? 0) >= 0.85 && (duration ?? 0) >= 0.8);
  return {
    score,
    confidence: Math.max(0, Math.min(1, score / 110)),
    coherent,
    evidence: { title, artists, album, albumArtists, duration, versionConflict: conflict },
  };
}

export function isAcceptableCandidate(assessment: CandidateAssessment, minimumScore = 45): boolean {
  return assessment.coherent && assessment.score >= minimumScore;
}

export function isStrongCandidate(assessment: CandidateAssessment): boolean {
  const corroborated = (assessment.evidence.artists ?? 0) >= 0.85
    || ((assessment.evidence.album ?? 0) >= 0.85 && (assessment.evidence.duration ?? 0) >= 0.8);
  return isAcceptableCandidate(assessment) && assessment.confidence >= 0.85
    && assessment.evidence.title >= 0.9
    && corroborated;
}

export function candidateScore(track: TrackMetadata, title: string, artists: string[], durationMs?: number, album?: string): number {
  return assessCandidate(track, { title, artists, durationMs, album }).score;
}

export function matchMetadata(track: TrackMetadata, title: string, artists: string[], durationMs: number | undefined, method: string, album?: string): ProviderMatchMetadata {
  const assessment = assessCandidate(track, { title, artists, album, durationMs });
  return {
    title,
    artists,
    album,
    durationMs,
    score: assessment.score,
    confidence: assessment.confidence,
    coherent: assessment.coherent,
    evidence: assessment.evidence,
    method,
  };
}

export async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
}
