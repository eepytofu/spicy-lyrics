export type ParsedLrcLine = {
  text: string;
  startTimeMs: number;
};

export type ParsedLrc = {
  synced: ParsedLrcLine[];
  plain: string[];
};

const METADATA_TAG = /^\s*\[(?:ar|al|ti|by|offset|language|re|ve|length)\s*:/iu;

export function parseLrcDocument(text: string): ParsedLrc {
  const synced: ParsedLrcLine[] = [];
  const plain: string[] = [];
  const offset = Number(/^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/imu.exec(text)?.[1] ?? 0);

  for (const row of text.split(/\r?\n/u)) {
    const timestamps: Array<{ minutes: number; seconds: number }> = [];
    let cursor = 0;

    while (cursor < row.length) {
      const timestamp = /^\s*\[(\d+):(\d+(?:\.\d+)?)\]/u.exec(row.slice(cursor));
      if (!timestamp) break;
      timestamps.push({
        minutes: Number(timestamp[1]),
        seconds: Number(timestamp[2]),
      });
      cursor += timestamp[0].length;
    }

    const content = row.slice(cursor).trim();
    if (!timestamps.length) {
      if (content && !METADATA_TAG.test(row)) plain.push(content);
      continue;
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
  return { synced, plain };
}
