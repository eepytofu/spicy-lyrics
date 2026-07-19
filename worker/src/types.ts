export type ProviderId = "qq" | "kugou" | "netease" | "soda";

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
  method: string;
};

export type LyricsProvider = (track: TrackMetadata) => Promise<NativeLyrics | undefined>;
