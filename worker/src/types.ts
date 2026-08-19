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

export type TimedWord = { text: string; startMs: number; durationMs: number };
export type TimedLine = {
  startMs: number;
  durationMs: number;
  words: TimedWord[];
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
