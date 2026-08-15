export type ParsedLrcLine = {
  text: string;
  startTimeMs: number;
};

export type ParsedEnhancedLrcWord = {
  text: string;
  startTimeMs: number;
  endTimeMs: number;
  isPartOfWord: boolean;
};

export type ParsedEnhancedLrcLine = {
  startTimeMs: number;
  endTimeMs: number;
  words: ParsedEnhancedLrcWord[];
};

export type ParsedLrc = {
  synced: ParsedLrcLine[];
  plain: string[];
  enhanced?: ParsedEnhancedLrcLine[];
};

const METADATA_TAG = /^\s*\[(?:ar|al|ti|by|offset|manualoffset|language|re|ve|length|id|hash|sign|qq|total)\s*:/iu;

type EnhancedMarker = {
  text: string;
  timeMs: number;
};

type RawEnhancedLine = {
  startTimeMs: number;
  markers: EnhancedMarker[];
};

function timestampMs(minutes: string, seconds: string, fraction?: string): number {
  return Math.round((Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0)) * 1000);
}

function parseEnhancedMarkers(body: string, offset: number): EnhancedMarker[] | null {
  const matches = [...body.matchAll(/<(\d+):(\d+)(?:([.:])(\d+))?>/gu)];
  if (!matches.length || body.slice(0, matches[0].index).trim()) return null;
  const markers = matches.map((match, index) => {
    const textStart = (match.index ?? 0) + match[0].length;
    const textEnd = matches[index + 1]?.index ?? body.length;
    return {
      text: body.slice(textStart, textEnd),
      timeMs: Math.max(0, timestampMs(match[1], match[2], match[4]) + offset),
    };
  });
  if (!markers.some((marker) => marker.text)) return null;
  return markers.every((marker, index) => index === 0 || marker.timeMs >= markers[index - 1].timeMs)
    ? markers
    : null;
}

function hasAuthoredBoundaryAfter(markers: readonly EnhancedMarker[], index: number): boolean {
  const text = markers[index]?.text ?? "";
  if (!text.trim()) return false;
  if (/\s$/u.test(text)) return true;
  for (let nextIndex = index + 1; nextIndex < markers.length; nextIndex += 1) {
    const nextText = markers[nextIndex]?.text ?? "";
    if (!nextText) continue;
    if (/^\s/u.test(nextText)) return true;
    if (nextText.trim()) return false;
  }
  return false;
}

function finalizeEnhancedLines(
  lines: RawEnhancedLine[],
  durationMs: number,
): ParsedEnhancedLrcLine[] {
  return lines
    .sort((left, right) => left.startTimeMs - right.startTimeMs)
    .flatMap((line, lineIndex) => {
      const lastVisibleStart = [...line.markers].reverse().find((marker) => marker.text)?.timeMs
        ?? line.startTimeMs;
      const storedDuration = Number.isFinite(durationMs) && durationMs >= lastVisibleStart
        ? durationMs
        : 0;
      const fallbackEnd = lines[lineIndex + 1]?.startTimeMs
        ?? (storedDuration || Math.max(line.startTimeMs + 4_000, lastVisibleStart + 4_000));
      const words = line.markers.flatMap((marker, markerIndex) => {
        if (!marker.text) return [];
        const nextTime = line.markers[markerIndex + 1]?.timeMs ?? fallbackEnd;
        return [{
          text: marker.text,
          startTimeMs: marker.timeMs,
          endTimeMs: Math.max(marker.timeMs, nextTime),
          isPartOfWord: !hasAuthoredBoundaryAfter(line.markers, markerIndex),
        }];
      });
      if (!words.length) return [];
      return [{
        startTimeMs: words[0].startTimeMs,
        endTimeMs: words.at(-1)!.endTimeMs,
        words,
      }];
    });
}

export function parseLrcDocument(text: string, durationMs = 0): ParsedLrc {
  const synced: ParsedLrcLine[] = [];
  const plain: string[] = [];
  const rawEnhanced: RawEnhancedLine[] = [];
  const offset = Number(/^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/imu.exec(text)?.[1] ?? 0);

  for (const row of text.split(/\r?\n/u)) {
    const timestamps: Array<{ minutes: number; seconds: number }> = [];
    let cursor = 0;

    while (cursor < row.length) {
      const timestamp = /^\s*\[(\d+):(\d+)(?:([.:])(\d+))?\]/u.exec(row.slice(cursor));
      if (!timestamp) break;
      timestamps.push({
        minutes: Number(timestamp[1]),
        seconds: Number(timestamp[2]) + (timestamp[4] ? Number(`0.${timestamp[4]}`) : 0),
      });
      cursor += timestamp[0].length;
    }

    const body = row.slice(cursor);
    const enhancedMarkers = timestamps.length ? parseEnhancedMarkers(body, offset) : null;
    const content = (enhancedMarkers
      ? enhancedMarkers.map((marker) => marker.text).join("")
      : body).trim();
    if (!timestamps.length) {
      if (content && !METADATA_TAG.test(row)) plain.push(content);
      continue;
    }

    if (enhancedMarkers) {
      rawEnhanced.push({
        startTimeMs: Math.max(0, Math.round((timestamps[0].minutes * 60 + timestamps[0].seconds) * 1000) + offset),
        markers: enhancedMarkers,
      });
    }

    for (const timestamp of timestamps) {
      if (!content) continue;
      synced.push({
        text: content,
        startTimeMs: Math.max(
          0,
          Math.round((timestamp.minutes * 60 + timestamp.seconds) * 1000) + offset,
        ),
      });
    }
  }

  synced.sort((a, b) => a.startTimeMs - b.startTimeMs);
  const enhanced = finalizeEnhancedLines(rawEnhanced, durationMs);
  return enhanced.length ? { synced, plain, enhanced } : { synced, plain };
}
