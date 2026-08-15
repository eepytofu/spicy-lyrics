import assert from "node:assert/strict";
import test from "node:test";
import { chooserCandidateRecords } from "../src/utils/Lyrics/LyricsCandidateDisplay.ts";
import { LYRIC_REVISION_SCHEMA_VERSION } from "../src/utils/Lyrics/LyricRevision.ts";

const revision = (digit: string, providerId: string) => ({
  schemaVersion: LYRIC_REVISION_SCHEMA_VERSION,
  trackUri: "spotify:track:fixture",
  providerId,
  candidateId: providerId,
  contentHash: digit.repeat(64),
  id: digit.repeat(64),
});

const assessment = (provider: string) => ({
  provider,
  format: "Line" as const,
  totalScore: 80,
  selectionScore: 80,
  trackMatchScore: 80,
  rankingTrackMatchScore: 80,
  structuralTimingScore: 100,
  timingAgreementScore: 65,
  timingScore: 89.5,
  textAgreementScore: 65,
  syncDetailScore: 70,
  priorityScore: 100,
  rejected: false,
  signals: {
    confidence: "medium" as const,
    trackMatch: "usable" as const,
    timingHealth: "healthy" as const,
    lyricAgreement: "neutral" as const,
    timingConsistency: "consistent" as const,
  },
  reasons: [],
});

const automatic = {
  provider: "apple" as const,
  result: { lyrics: { Type: "Line", source: "apple" }, status: 200 },
  assessment: assessment("apple"),
  revision: revision("a", "apple"),
};

test("chooser pins a restored manual candidate beside the recalculated automatic result", () => {
  const current = {
    Type: "Line",
    source: "netease",
    fetchProvider: "netease",
    ManualLyricsSelection: true,
    LyricRevision: revision("b", "netease"),
    SourceMatch: { title: "忘却の翼", artists: ["霜月はるか"] },
    SelectionDiagnostics: { candidates: [assessment("netease")] },
  };

  const records = chooserCandidateRecords([automatic], current, automatic);
  assert.deepEqual(records.map((record) => record.provider), ["apple", "netease"]);
  assert.equal(records[1].result.match?.title, "忘却の翼");
  assert.equal(records[1].revision.id, current.LyricRevision.id);
});

test("chooser deduplicates a manual candidate already returned by search", () => {
  const manual = {
    provider: "netease" as const,
    result: { lyrics: { Type: "Line", source: "netease" }, status: 200 },
    assessment: assessment("netease"),
    revision: revision("b", "netease"),
  };
  const current = {
    ManualLyricsSelection: true,
    LyricRevision: manual.revision,
    SelectionDiagnostics: { candidates: [manual.assessment] },
  };

  const records = chooserCandidateRecords([manual, automatic], current, automatic);
  assert.deepEqual(records.map((record) => record.provider), ["apple", "netease"]);
});
