export type TimedLine = {
  text: string;
  startTimeMs: number;
  endTimeMs?: number;
};

export type TimedWord = {
  text: string;
  startTimeMs: number;
  endTimeMs: number;
  isPartOfWord: boolean;
};

export type TimedWordLine = {
  startTimeMs: number;
  endTimeMs: number;
  words: TimedWord[];
};

export type LyricsDocumentIdentity = {
  source: string;
  label: string;
};

export type BuildLineLyricsOptions = {
  useDurationForFinalLine?: boolean;
};

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[♪♫♬♩]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildStaticLyrics(
  lines: string[],
  identity: LyricsDocumentIdentity,
): any | null {
  const Lines = lines.map(clean).filter(Boolean).map((Text) => ({ Text }));
  return Lines.length
    ? { Type: "Static", Lines, source: identity.source, sourceDisplayName: identity.label }
    : null;
}

export function buildLineLyrics(
  lines: TimedLine[],
  durationMs: number,
  identity: LyricsDocumentIdentity,
  options: BuildLineLyricsOptions = {},
): any | null {
  const sorted = lines
    .map((line) => ({ ...line, text: clean(line.text) }))
    .filter((line) => line.text && Number.isFinite(line.startTimeMs))
    .sort((left, right) => left.startTimeMs - right.startTimeMs);
  if (!sorted.length) return null;
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0;
  const Content = sorted.map((line, index) => {
    const start = Math.max(0, line.startTimeMs / 1000);
    const nextStart = sorted[index + 1]?.startTimeMs;
    const finalDuration = options.useDurationForFinalLine && duration >= start
      ? duration
      : Math.max(duration, start + 4);
    const fallbackEnd = nextStart ? nextStart / 1000 : finalDuration;
    return {
      Type: "Vocal",
      Text: line.text,
      StartTime: start,
      EndTime: Math.max(
        start,
        line.endTimeMs === undefined ? fallbackEnd : line.endTimeMs / 1000,
      ),
      OppositeAligned: false,
    };
  });
  return {
    Type: "Line",
    StartTime: Content[0].StartTime,
    EndTime: Content.at(-1)?.EndTime,
    Content,
    source: identity.source,
    sourceDisplayName: identity.label,
  };
}

export function buildSyllableLyrics(
  lines: TimedWordLine[],
  identity: LyricsDocumentIdentity,
): any | null {
  const Content = lines.filter((line) => line.words.length).map((line) => ({
    Type: "Vocal",
    OppositeAligned: false,
    Lead: {
      StartTime: line.startTimeMs / 1000,
      EndTime: line.endTimeMs / 1000,
      Syllables: line.words.map((word) => ({
        Text: word.text,
        StartTime: word.startTimeMs / 1000,
        EndTime: word.endTimeMs / 1000,
        IsPartOfWord: word.isPartOfWord,
      })),
    },
  }));
  return Content.length
    ? {
        Type: "Syllable",
        StartTime: Content[0].Lead.StartTime,
        EndTime: Content.at(-1)?.Lead.EndTime,
        Content,
        source: identity.source,
        sourceDisplayName: identity.label,
      }
    : null;
}
