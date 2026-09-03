export type ExternalTranslationSubmission = {
  trackUri: string;
  lyricRevisionId?: string;
  providerId?: string;
  sourceCandidateId?: string;
  targetLanguage: string;
  showProviderTranslation?: boolean;
  lines: Array<{ id: string; text: string }>;
};

export type ExternalTranslationResult =
  | { ok: true; appliedLines: number; changed: boolean }
  | { ok: false; error: string };

export type ExternalTranslationIdentity = {
  trackUri: string;
  lyricRevisionId?: string;
  providerId?: string;
  sourceCandidateId?: string;
  lines: Array<{ id: string }>;
};

type ActiveExternalTranslation = Omit<ExternalTranslationSubmission, "lines"> & {
  lines: ReadonlyMap<string, string>;
};

let activeExternalTranslation: ActiveExternalTranslation | null = null;

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const optionalIdentity = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const validLanguageTag = (value: unknown): value is string =>
  nonEmpty(value) && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(value.trim());

function matchesIdentity(
  active: Pick<ActiveExternalTranslation, "trackUri" | "lyricRevisionId" | "providerId" | "sourceCandidateId">,
  identity: Omit<ExternalTranslationIdentity, "lines">,
): boolean {
  return active.trackUri === identity.trackUri
    && optionalIdentity(active.lyricRevisionId) === optionalIdentity(identity.lyricRevisionId)
    && optionalIdentity(active.providerId) === optionalIdentity(identity.providerId)
    && optionalIdentity(active.sourceCandidateId) === optionalIdentity(identity.sourceCandidateId);
}

function matchesSubmission(
  active: ActiveExternalTranslation | null,
  submission: ExternalTranslationSubmission,
  translations: ReadonlyMap<string, string>,
): boolean {
  if (!active || !matchesIdentity(active, submission)) return false;
  if (active.targetLanguage !== submission.targetLanguage.trim()) return false;
  if (active.showProviderTranslation !== (submission.showProviderTranslation === true)) return false;
  if (active.lines.size !== translations.size) return false;
  for (const [id, text] of translations) {
    if (active.lines.get(id) !== text) return false;
  }
  return true;
}

export function submitExternalTranslation(
  identity: ExternalTranslationIdentity | null,
  submission: ExternalTranslationSubmission,
): ExternalTranslationResult {
  if (!identity) return { ok: false, error: "No current Spicy Lyrics snapshot" };
  if (!submission || typeof submission !== "object") {
    return { ok: false, error: "Invalid external translation payload" };
  }
  if (!optionalIdentity(identity.lyricRevisionId) && !optionalIdentity(identity.providerId)) {
    return { ok: false, error: "Current lyrics have no stable source identity" };
  }
  if (!matchesIdentity(submission, identity)) {
    return { ok: false, error: "Stale lyric source identity" };
  }
  if (!validLanguageTag(submission.targetLanguage)) {
    return { ok: false, error: "Invalid target language" };
  }
  if (
    submission.showProviderTranslation !== undefined
    && typeof submission.showProviderTranslation !== "boolean"
  ) {
    return { ok: false, error: "Invalid provider translation visibility" };
  }
  if (!Array.isArray(submission.lines) || submission.lines.length === 0) {
    return { ok: false, error: "No translated lines supplied" };
  }

  const knownLineIds = new Set(identity.lines.map((line) => line.id));
  const translations = new Map<string, string>();
  for (const line of submission.lines) {
    if (!line || !nonEmpty(line.id) || !knownLineIds.has(line.id)) {
      return { ok: false, error: "Unknown lyric line id" };
    }
    if (!nonEmpty(line.text)) {
      return { ok: false, error: `Empty translation for ${line.id}` };
    }
    if (translations.has(line.id)) {
      return { ok: false, error: `Duplicate translation for ${line.id}` };
    }
    translations.set(line.id, line.text);
  }

  if (matchesSubmission(activeExternalTranslation, submission, translations)) {
    return { ok: true, appliedLines: translations.size, changed: false };
  }

  activeExternalTranslation = Object.freeze({
    trackUri: submission.trackUri,
    ...(submission.lyricRevisionId ? { lyricRevisionId: submission.lyricRevisionId.trim() } : {}),
    ...(submission.providerId ? { providerId: submission.providerId.trim() } : {}),
    ...(submission.sourceCandidateId
      ? { sourceCandidateId: submission.sourceCandidateId.trim() }
      : {}),
    targetLanguage: submission.targetLanguage.trim(),
    showProviderTranslation: submission.showProviderTranslation === true,
    lines: translations,
  });
  return { ok: true, appliedLines: translations.size, changed: true };
}

export function clearExternalTranslation(
  identity?: Partial<Pick<ExternalTranslationIdentity, "trackUri" | "lyricRevisionId" | "providerId" | "sourceCandidateId">>,
): boolean {
  if (!activeExternalTranslation) return false;
  if (identity?.trackUri && identity.trackUri !== activeExternalTranslation.trackUri) return false;
  if (
    identity?.lyricRevisionId
    && optionalIdentity(identity.lyricRevisionId) !== optionalIdentity(activeExternalTranslation.lyricRevisionId)
  ) return false;
  if (identity?.providerId && optionalIdentity(identity.providerId) !== optionalIdentity(activeExternalTranslation.providerId)) {
    return false;
  }
  if (
    identity?.sourceCandidateId
    && optionalIdentity(identity.sourceCandidateId) !== optionalIdentity(activeExternalTranslation.sourceCandidateId)
  ) return false;
  activeExternalTranslation = null;
  return true;
}

export function synchronizeExternalTranslation(identity: ExternalTranslationIdentity): boolean {
  if (!activeExternalTranslation || matchesIdentity(activeExternalTranslation, identity)) return false;
  activeExternalTranslation = null;
  return true;
}

function lyricsIdentity(lyrics: any): Omit<ExternalTranslationIdentity, "lines"> {
  return {
    trackUri: String(lyrics?.uri ?? "").trim(),
    lyricRevisionId: optionalIdentity(lyrics?.LyricRevision?.id) || undefined,
    providerId: optionalIdentity(
      lyrics?.LyricRevision?.providerId || lyrics?.fetchProvider || lyrics?.source,
    ) || undefined,
    sourceCandidateId: optionalIdentity(
      lyrics?.LyricRevision?.candidateId || lyrics?.SourceCandidateId,
    ) || undefined,
  };
}

function projectEntry(entry: any, lineId: string): any {
  const translated = activeExternalTranslation?.lines.get(lineId);
  if (!translated) return entry;
  return {
    ...entry,
    TranslatedText: translated,
    TranslatedTextLanguage: activeExternalTranslation!.targetLanguage,
  };
}

/** Project the active companion lane onto a render-only copy of the source document. */
export function projectExternalTranslations(lyrics: any): any {
  if (!activeExternalTranslation || !matchesIdentity(activeExternalTranslation, lyricsIdentity(lyrics))) {
    return lyrics;
  }

  const root = {
    ...lyrics,
    ExternalTranslationActive: true,
    ExternalTranslationShowProvider: activeExternalTranslation.showProviderTranslation === true,
  };

  if (lyrics.Type === "Static") {
    root.Lines = (lyrics.Lines || []).map((line: any, index: number) =>
      projectEntry(line, `lead:${index}`)
    );
  } else if (lyrics.Type === "Line") {
    root.Content = (lyrics.Content || []).map((line: any, index: number) => {
      const projected = line?.Text !== undefined
        ? projectEntry(line, `lead:${index}`)
        : { ...line, Lead: projectEntry(line?.Lead, `lead:${index}`) };
      return {
        ...projected,
        Background: (line?.Background || []).map((background: any, backgroundIndex: number) =>
          projectEntry(background, `background:${index}:${backgroundIndex}`)
        ),
      };
    });
  } else if (lyrics.Type === "Syllable") {
    root.Content = (lyrics.Content || []).map((group: any, index: number) => ({
      ...group,
      Lead: projectEntry(group?.Lead, `lead:${index}`),
      Background: (group?.Background || []).map((background: any, backgroundIndex: number) =>
        projectEntry(background, `background:${index}:${backgroundIndex}`)
      ),
    }));
  }

  return root;
}
