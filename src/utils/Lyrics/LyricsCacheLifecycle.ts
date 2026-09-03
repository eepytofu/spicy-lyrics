import type { LyricsCandidateOverrideReset } from "./LyricsOverridePreference.ts";

export type LyricsCacheLifecycleDependencies = {
  removeProcessed(trackId: string): Promise<void>;
  clearProcessed(): Promise<void>;
  removeRevision(revisionId: string): Promise<void>;
  clearRevisions(): Promise<void>;
  resetCandidate(trackUri: string): Promise<LyricsCandidateOverrideReset>;
  resetCandidates(): Promise<string[]>;
  clearLegacySelection(trackUri: string): Promise<void>;
  clearCandidateSession(trackUri?: string): void;
};

export async function clearCurrentLyricsCaches(
  trackId: string,
  trackUri: string,
  dependencies: LyricsCacheLifecycleDependencies,
): Promise<void> {
  const reset = await dependencies.resetCandidate(trackUri);
  dependencies.clearCandidateSession(trackUri);
  await Promise.all([
    dependencies.removeProcessed(trackId),
    dependencies.clearLegacySelection(trackUri),
    ...reset.revisionIds.map((revisionId) => dependencies.removeRevision(revisionId)),
  ]);
}

export async function clearAllLyricsCaches(
  dependencies: LyricsCacheLifecycleDependencies,
): Promise<void> {
  await dependencies.resetCandidates();
  dependencies.clearCandidateSession();
  await Promise.all([
    dependencies.clearProcessed(),
    dependencies.clearRevisions(),
  ]);
}
