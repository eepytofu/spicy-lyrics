import OpenCC from "opencc-js";
import type { ProviderMatchMetadata, TrackMetadata } from "../types";

const traditionalToSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
const languageTags = new Set(["粤", "粤语", "国", "国语", "普通话", "台", "台语", "闽南语", "日", "日语", "日文", "韩", "韩语", "韩文", "英", "英语", "英文"]);
const versionPatterns: Array<[string, RegExp]> = [
  ["remix", /\bremix(?:ed)?\b|混音|重混/iu],
  ["dj", /(?:^|[^\p{L}\p{N}])dj(?:$|[^\p{L}\p{N}])|dj版/iu],
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
  return simplify(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
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
  const simplified = simplify(value).toLocaleLowerCase();
  return new Set(versionPatterns.filter(([, pattern]) => pattern.test(simplified)).map(([tag]) => tag));
}

function artistVariants(value: string): string[] {
  const normalized = normalize(value);
  const withoutOfficial = value.replace(/official(?:\s*(?:account|channel|music))?\s*$/iu, "");
  const withoutCjkInfinity = value.replace(/(?<=\p{Script=Han})infinity\s*$/iu, "");
  return unique([normalized, normalize(withoutOfficial), normalize(withoutCjkInfinity)]);
}

function versionConflict(wanted: string, candidate: string): boolean {
  const wantedTags = versionTags(wanted);
  const candidateTags = versionTags(candidate);
  if (!wantedTags.size && !candidateTags.size) return false;
  return wantedTags.size !== candidateTags.size || [...wantedTags].some((tag) => !candidateTags.has(tag));
}

export function searchQueries(track: TrackMetadata): string[] {
  const title = track.title.trim();
  const artist = track.artists[0]?.trim() ?? "";
  const simplifiedTitle = simplify(title);
  const simplifiedArtist = simplify(artist);
  return unique([
    `${simplifiedTitle} ${simplifiedArtist}`,
    `${title} ${artist}`,
    simplifiedTitle,
    title,
  ]);
}

export function candidateScore(track: TrackMetadata, title: string, artists: string[], durationMs?: number): number {
  if (!title.trim() || versionConflict(track.title, title)) return -100;
  const wantedTitle = normalize(track.title);
  const candidateTitle = normalize(title);
  if (!wantedTitle || !candidateTitle) return -100;
  let score = wantedTitle === candidateTitle ? 60 : wantedTitle.includes(candidateTitle) || candidateTitle.includes(wantedTitle) ? 35 : 0;
  const wantedArtists = track.artists.flatMap(artistVariants);
  const candidateArtists = artists.flatMap(artistVariants);
  if (wantedArtists.some((artist) => candidateArtists.includes(artist))) score += 30;
  else if (wantedArtists.some((artist) => candidateArtists.some((candidate) => artist.includes(candidate) || candidate.includes(artist)))) score += 15;
  if (durationMs && track.durationMs) {
    const difference = Math.abs(durationMs - track.durationMs);
    score += difference <= 1500 ? 20 : difference <= 5000 ? 10 : difference > 15000 ? -20 : 0;
  }
  return score;
}

export function matchMetadata(track: TrackMetadata, title: string, artists: string[], durationMs: number | undefined, method: string, album?: string): ProviderMatchMetadata {
  const score = candidateScore(track, title, artists, durationMs);
  const maximumScore = durationMs && track.durationMs ? 110 : 90;
  const confidence = Math.max(0, Math.min(1, score / maximumScore));
  return { title, artists, album, durationMs, score, confidence, method };
}

export async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
}
