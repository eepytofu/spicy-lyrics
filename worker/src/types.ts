export type ProviderId = "qq" | "kugou" | "netease" | "soda";
export type ProviderInfoKind = "trackHeader" | "credit" | "rightsHolder" | "rightsNotice" | "providerNotice";
export type VocalCueForm = "labelColon" | "bracketedLabel";
export type VocalCue = {
  Label: string;
  Form: VocalCueForm;
};

const PROVIDER_INFO_KINDS = new Set<ProviderInfoKind>([
  "trackHeader",
  "credit",
  "rightsHolder",
  "rightsNotice",
  "providerNotice",
]);

export function isProviderInfoKind(value: unknown): value is ProviderInfoKind {
  return PROVIDER_INFO_KINDS.has(value as ProviderInfoKind);
}

export function isVocalCue(value: unknown): value is VocalCue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const cue = value as Record<string, unknown>;
  return typeof cue.Label === "string"
    && cue.Label.length > 0
    && (cue.Form === "labelColon" || cue.Form === "bracketedLabel");
}

export type ProviderCreditRole = "syncedLyrics" | "lyrics" | "translation" | "romanization" | "credit";
export type ProviderCredit = {
  role: ProviderCreditRole;
  name: string;
  provider: ProviderId;
  userId?: string;
};

export type TrackMetadata = {
  id: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
};

export type ProviderReadingFinding =
  | "walkNotClosed"
  | "truncatedLine"
  | "extraEntries"
  | "zeroCount"
  | "oversizeCount"
  | "emptyReadingWithGroup"
  | "groupSpansToken"
  | "groupSpansRow"
  | "readingContainsNonKana"
  | "malformedTimingGroup"
  | "partialSubTiming"
  | "anchorMismatch"
  | "spanEndOutOfTolerance"
  | "nonMonotonicTiming"
  | "overlappingTiming"
  | "zeroDurationTiming"
  | "duplicateKanaLine"
  | "redundantLayerMismatch"
  | "unknownSourceUnit";

export type ProviderKanaTime = { startMs: number; durationMs: number };

export type ProviderKanaTiming = {
  state: "timingProven" | "timingAbsent" | "timingRejected";
  offsetMs: number;
  rawBaseStartMs: number;
  effectiveBaseStartMs: number;
  baseDurationMs: number;
  rawKana: ProviderKanaTime[];
  effectiveKana: ProviderKanaTime[];
  spanEndDeltaMs?: number;
  internalGaps: Array<{ afterKanaIndex: number; gapMs: number }>;
};

export type ProviderKanaUnit = {
  ordinal: number;
  groupId: string;
  groupSize: number;
  groupRole: "sole" | "groupHead" | "groupMember";
  source: {
    rowOrdinal: number;
    tokenOrdinal: number;
    utf16Start: number;
    utf16End: number;
    codePointCount: number;
    exactSourceSlice: string;
  };
  groupSource?: {
    rowOrdinal: number;
    tokenOrdinal: number;
    utf16Start: number;
    utf16End: number;
    readingUnitCount: number;
    codePointCount: number;
    exactSourceSlice: string;
  };
  coverage: "covered" | "explicitEmpty";
  reading?: string;
  timing: ProviderKanaTiming;
  findings: ProviderReadingFinding[];
};

export type ProviderKanaLayer = {
  transport: {
    providerId: "qq" | "kugou";
    container: "qrc" | "krc";
    documentRole: "primary";
    responseField: "lyric";
    rawLine: string;
    rawLineSha256: string;
    rawLineByteLength: number;
  };
  authorship: { declaredAuthor?: string; authorshipProvenance: "unknown" };
  derivation: {
    redundantCopies: Array<{
      documentRole: "translation";
      identicalWithoutTimings: boolean;
    }>;
    layersDerivedFromThis: Array<{
      documentRole: "romanization";
      relationship: "inferredDerivation";
    }>;
  };
  validation: {
    walkState: "ordinalUnitProven" | "walkNotClosed" | "layerRejected";
    declaredUnitCount: number;
    resolvedUnitCount: number;
    findings: ProviderReadingFinding[];
  };
  units: ProviderKanaUnit[];
};

export type ProviderLineReadingRow = {
  exactValue: string;
  rowOrdinal?: number;
  sourceRowOrdinal?: number;
  rawStartMs?: number;
  effectiveStartMs?: number;
  alignment: "rowOrdinalProven" | "exactTimestamp" | "unmatched" | "ambiguous";
  validationStatus: "usable" | "explicitEmpty";
};

export type ProviderLineReadingLane = {
  evidenceId: string;
  providerId: ProviderId;
  evidenceKind: "romanization" | "transliteration";
  granularity: "line";
  documentRole: "romanization";
  container: "qrc" | "krc" | "lrc" | "yrc";
  responseField: "roma" | "contentroma" | "language.content[type=0]" | "yromalrc" | "romalrc";
  rawProviderKind?: number;
  rawLanguage?: number | null;
  authorshipProvenance: "unknown" | "providerDeclaredHuman" | "providerDeclaredGenerated";
  derivation: "independent" | "inferredKanaProjection" | "unknown";
  rows: ProviderLineReadingRow[];
};

export type ProviderLayerProvenance = {
  role: "primary" | "translation" | "romanization";
  revision?: string;
  contributors: Array<{ kind: "userId" | "uin" | "name"; exactValue: string }>;
  sourceFlags: Array<{ name: string; exactValue: string | number | boolean }>;
};

export type ProviderPhoneticLane = {
  evidenceId: string;
  providerId: ProviderId;
  rawNumericKind: number;
  rawLanguage: number | null;
  evidenceKind: "phonetic";
  targetScript: "Han" | "Latin" | "mixed" | "empty" | "unknown";
  authorshipProvenance: "providerDeclaredGenerated" | "unknown";
  declaredProvenanceText?: string;
  validationStatus: "shapeProven" | "layerRejected";
  validationFindings: Array<"invalidLanguage" | "invalidRows" | "invalidCells">;
  rows: Array<{ rowOrdinal: number; cells: string[] }>;
};

export type ProviderReadingEvidence = {
  schemaVersion: 1;
  providerId: ProviderId;
  layerProvenance?: ProviderLayerProvenance[];
  lineReadings?: ProviderLineReadingLane[];
  kanaLayers?: ProviderKanaLayer[];
  phoneticLanes?: ProviderPhoneticLane[];
};

export type TimedWord = {
  text: string;
  startMs: number;
  durationMs: number;
  /** Provider timing before a document-level offset is applied. */
  rawStartMs?: number;
};
export type TimedLine = {
  startMs: number;
  durationMs: number;
  words: TimedWord[];
  /** Parser-only raw timed-row identity before empty rows are removed. */
  sourceRowOrdinal?: number;
  translation?: string;
  romanization?: string;
  providerInfoKind?: ProviderInfoKind;
};

export type NativeLyrics = Record<string, unknown> & {
  Type: "Static" | "Line" | "Syllable";
  source: ProviderId;
  sourceDisplayName: string;
  fetchProvider: ProviderId;
  SourceMatch?: ProviderMatchMetadata;
  ProviderCredits?: ProviderCredit[];
  ProviderReadingEvidence?: ProviderReadingEvidence;
};

export type ProviderMatchMetadata = {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  score: number;
  confidence: number;
  coherent?: boolean;
  evidence?: {
    title: number;
    artists: number | null;
    album: number | null;
    albumArtists: number | null;
    duration: number | null;
    versionConflict: boolean;
  };
  discoveryEvidence?: {
    bestRequestedArtist: number | null;
    canonicalTitleVersionConflict: boolean;
  };
  method: string;
};

export type ProviderRequestContext = {
  signal?: AbortSignal;
};

export type LyricsProvider = (
  track: TrackMetadata,
  context?: ProviderRequestContext,
) => Promise<NativeLyrics | undefined>;
