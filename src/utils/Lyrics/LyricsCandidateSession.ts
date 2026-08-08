import type { CompleteLyricsSearchOverrides } from "./ManualLyricsSearch.ts";

export type CandidateSession<TRecord, TFailure> = {
  uri: string;
  signature: string;
  expiresAt: number;
  records: TRecord[];
  failures: TFailure[];
  recommendedRevisionId: string | null;
  automaticRevisionId: string | null;
  activeRevisionId: string | null;
  alternativesLoaded: boolean;
  searchOverrides: CompleteLyricsSearchOverrides | null;
};

const CANDIDATE_SESSION_TTL_MS = 5 * 60_000;

export class LyricsCandidateSessionStore<TRecord, TFailure> {
  private session: CandidateSession<TRecord, TFailure> | null = null;

  set(
    session: Omit<CandidateSession<TRecord, TFailure>, "expiresAt">,
    now = Date.now()
  ): CandidateSession<TRecord, TFailure> {
    this.session = structuredClone({
      ...session,
      expiresAt: now + CANDIDATE_SESSION_TTL_MS,
    });
    return structuredClone(this.session);
  }

  get(
    uri: string,
    signature: string,
    now = Date.now()
  ): CandidateSession<TRecord, TFailure> | null {
    const session = this.session;
    if (
      !session ||
      session.uri !== uri ||
      session.signature !== signature ||
      session.expiresAt <= now
    ) {
      return null;
    }
    return structuredClone(session);
  }

  setActiveRevision(uri: string, revisionId: string | null): void {
    if (!this.session || this.session.uri !== uri) return;
    this.session.activeRevisionId = revisionId;
  }

  clearForTrackChange(uri: string): void {
    if (this.session && this.session.uri !== uri) this.session = null;
  }
}
