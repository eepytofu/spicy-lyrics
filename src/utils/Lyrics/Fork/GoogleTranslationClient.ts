/** Shared marker batching retained temporarily by the legacy Google romanizer. */

export const TRANSLATION_BATCH_MAX_LINES = 100;
export const TRANSLATION_BATCH_MAX_CHARS = 4500;
export const BATCH_MARKER_PATTERN = /\[\[\s*SPX\s*_\s*(\d\s*\d\s*\d)\s*\]\]/gi;

function batchMarker(index: number): string {
  return `[[SPX_${String(index).padStart(3, "0")}]]`;
}

export function buildBatchQuery(lines: string[]): string {
  return lines.map((line, index) => `${batchMarker(index)} ${line}`).join("\n");
}

export function buildBatchChunks(lines: string[]): Array<{ start: number; lines: string[]; query: string }> {
  const chunks: Array<{ start: number; lines: string[]; query: string }> = [];
  let current: string[] = [];
  let currentStart = 0;
  let currentChars = 0;

  for (let index = 0; index < lines.length; index++) {
    const lineChars = lines[index].length + 14;
    if (
      current.length > 0
      && (current.length >= TRANSLATION_BATCH_MAX_LINES
        || currentChars + lineChars > TRANSLATION_BATCH_MAX_CHARS)
    ) {
      chunks.push({ start: currentStart, lines: current, query: buildBatchQuery(current) });
      current = [];
      currentStart = index;
      currentChars = 0;
    }
    current.push(lines[index]);
    currentChars += lineChars;
  }

  if (current.length > 0) {
    chunks.push({ start: currentStart, lines: current, query: buildBatchQuery(current) });
  }
  return chunks;
}

export function parseBatchTranslation(translated: string): Map<number, string> {
  const result = new Map<number, string>();
  if (!translated.trim()) return result;

  const pattern = new RegExp(BATCH_MARKER_PATTERN.source, BATCH_MARKER_PATTERN.flags);
  let current = -1;
  let textStart = -1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(translated)) !== null) {
    if (current >= 0 && textStart >= 0) {
      const value = translated.slice(textStart, match.index).trim();
      if (value) result.set(current, value);
    }
    current = Number.parseInt(match[1].replace(/\s+/g, ""), 10);
    textStart = pattern.lastIndex;
  }

  if (current >= 0 && textStart >= 0) {
    const value = translated.slice(textStart).trim();
    if (value) result.set(current, value);
  }
  return result;
}

export function stripMarkerEcho(text: string, index: number): string {
  const digits = String(index).padStart(3, "0").split("").join("\\s*");
  const markerPattern = new RegExp(`\\[\\[\\s*SPX\\s*_\\s*${digits}\\s*\\]\\]`, "gi");
  return text.replace(markerPattern, "").trim();
}
