import type { LyricsCandidateAssessment, LyricsMatchMetadata } from "./LyricsCandidateSelector.ts";
import type { LyricsCandidateRecord } from "./ExternalSources.ts";
import { isLyricRevision } from "./LyricRevision.ts";
import type { LyricsSourceProviderId } from "./LyricsSourcePreferences.ts";

type CurrentCandidateLyrics = {
  ManualLyricsSelection?: boolean;
  LyricRevision?: unknown;
  SourceMatch?: LyricsMatchMetadata;
  SelectionDiagnostics?: { candidates?: LyricsCandidateAssessment[] };
  fetchProvider?: string;
  source?: string;
  [key: string]: unknown;
};

function currentManualCandidateRecord(
  lyrics: CurrentCandidateLyrics | null,
): LyricsCandidateRecord | null {
  if (!lyrics?.ManualLyricsSelection || !isLyricRevision(lyrics.LyricRevision)) return null;
  const provider = String(
    lyrics.fetchProvider || lyrics.LyricRevision.providerId || lyrics.source || "",
  ) as LyricsSourceProviderId;
  const assessment = lyrics.SelectionDiagnostics?.candidates?.find(
    (candidate) => candidate.provider === provider,
  );
  if (!provider || !assessment) return null;
  return {
    provider,
    result: { lyrics, status: 200, match: lyrics.SourceMatch },
    assessment,
    revision: lyrics.LyricRevision,
  };
}

export function chooserCandidateRecords(
  records: LyricsCandidateRecord[],
  currentLyrics: CurrentCandidateLyrics | null,
  automaticRecord: LyricsCandidateRecord | null,
): LyricsCandidateRecord[] {
  if (!currentLyrics?.ManualLyricsSelection) return records;
  const currentRevisionId = isLyricRevision(currentLyrics.LyricRevision)
    ? currentLyrics.LyricRevision.id
    : null;
  const currentRecord = records.find(
    (record) => record.revision.id === currentRevisionId,
  ) ?? currentManualCandidateRecord(currentLyrics);
  const ordered: LyricsCandidateRecord[] = [];
  const seen = new Set<string>();
  for (const record of [automaticRecord, currentRecord, ...records]) {
    if (!record || seen.has(record.revision.id)) continue;
    seen.add(record.revision.id);
    ordered.push(record);
  }
  return ordered;
}
