import { ensureSourceEvidence, type SourceLyricsEvidence } from "./Processing/SourceEvidence.ts";

export const LYRIC_REVISION_SCHEMA_VERSION = 2;

export type LyricRevision = {
  schemaVersion: typeof LYRIC_REVISION_SCHEMA_VERSION;
  trackUri: string;
  providerId: string;
  candidateId: string;
  contentHash: string;
  id: string;
};

type RevisionLyrics = {
  source?: string;
  fetchProvider?: string;
  SourceCandidateId?: string;
  LyricRevision?: LyricRevision;
};

function canonicalSourceEvidence(evidence: SourceLyricsEvidence): string {
  return JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    lyricsType: evidence.lyricsType,
    lines: evidence.lines.map((line) => ({
      id: line.id,
      providerText: line.providerText,
      providerTranslation: line.providerTranslation ?? null,
      providerInfoKind: line.providerInfoKind ?? null,
      startTime: line.startTime,
      endTime: line.endTime,
      role: line.role,
      timingOwners: line.timingOwners.map((owner) => ({
        id: owner.id,
        providerText: owner.providerText,
        startTime: owner.startTime,
        endTime: owner.endTime,
        isPartOfWord: owner.isPartOfWord ?? null,
        providerRuby: owner.providerRuby ?? null,
      })),
    })),
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isLyricRevision(value: unknown): value is LyricRevision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const revision = value as Record<string, unknown>;
  return (
    revision.schemaVersion === LYRIC_REVISION_SCHEMA_VERSION &&
    typeof revision.trackUri === "string" &&
    revision.trackUri.length > 0 &&
    typeof revision.providerId === "string" &&
    revision.providerId.length > 0 &&
    typeof revision.candidateId === "string" &&
    revision.candidateId.length > 0 &&
    typeof revision.contentHash === "string" &&
    /^[a-f0-9]{64}$/u.test(revision.contentHash) &&
    typeof revision.id === "string" &&
    /^[a-f0-9]{64}$/u.test(revision.id)
  );
}

export async function ensureLyricRevision(
  trackUri: string,
  lyrics: RevisionLyrics,
  candidateId?: string
): Promise<LyricRevision> {
  if (
    isLyricRevision(lyrics.LyricRevision) &&
    lyrics.LyricRevision.trackUri === trackUri &&
    (!candidateId || lyrics.LyricRevision.candidateId === candidateId)
  ) {
    return lyrics.LyricRevision;
  }

  const evidence = ensureSourceEvidence(lyrics);
  if (!evidence) throw new TypeError("Cannot create a lyric revision without source evidence");

  const providerId = String(
    lyrics.fetchProvider || lyrics.source || evidence.providerId || "unknown"
  );
  const resolvedCandidateId = String(candidateId || lyrics.SourceCandidateId || providerId);
  const contentHash = await sha256(canonicalSourceEvidence(evidence));
  const id = await sha256(
    JSON.stringify([
      LYRIC_REVISION_SCHEMA_VERSION,
      trackUri,
      providerId,
      resolvedCandidateId,
      contentHash,
    ])
  );
  const revision: LyricRevision = Object.freeze({
    schemaVersion: LYRIC_REVISION_SCHEMA_VERSION,
    trackUri,
    providerId,
    candidateId: resolvedCandidateId,
    contentHash,
    id,
  });
  lyrics.LyricRevision = revision;
  return revision;
}
