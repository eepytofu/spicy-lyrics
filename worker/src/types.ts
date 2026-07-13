export type ProviderId = "qq" | "kugou" | "netease";

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
};

export type ProviderMatchMetadata = {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  score: number;
  confidence: number;
  method: string;
};

export type LyricsProvider = (track: TrackMetadata) => Promise<NativeLyrics | undefined>;
