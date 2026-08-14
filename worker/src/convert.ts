import { isProviderInfoKind, type NativeLyrics, type ProviderId, type ProviderInfoKind, type TimedLine, type TimedWord } from "./types";
import { markEmbeddedProviderInfo, type ProviderInfoContext } from "./provider-info";

const labels: Record<ProviderId, string> = {
  qq: "QQ Music",
  kugou: "KuGou",
  netease: "NetEase Cloud Music",
  soda: "Soda Music",
};
const NETEASE_INSTRUMENTAL_SENTINEL = "纯音乐请欣赏";

function normalizeMarkerText(text: string): string {
  return text.normalize("NFKC").trim();
}

function isProviderPlaceholder(text: string, provider: ProviderId): boolean {
  return provider === "qq" && normalizeMarkerText(text) === "//";
}

function isInstrumentalSentinelDocument(texts: string[], provider: ProviderId): boolean {
  if (provider !== "netease" || !texts.length) return false;
  return texts.every((text) => normalizeMarkerText(text).replace(/[\s,，。.!！?？、:：;；]+/gu, "") === NETEASE_INSTRUMENTAL_SENTINEL);
}

function cleanSidecarText(text: string | undefined, provider: ProviderId): string | undefined {
  const cleaned = text?.trim();
  return cleaned && !isProviderPlaceholder(cleaned, provider) ? cleaned : undefined;
}

function finalizeProviderInfo(
  result: NativeLyrics,
  provider: ProviderId,
  providerInfo?: ProviderInfoContext,
): NativeLyrics | undefined {
  const marked = providerInfo ? markEmbeddedProviderInfo(result, provider, providerInfo) : result;
  const entries = marked.Type === "Static"
    ? ((marked.Lines as Array<{ ProviderInfoKind?: unknown }> | undefined) ?? [])
    : ((marked.Content as Array<Record<string, any>> | undefined) ?? []).map((line) =>
      marked.Type === "Syllable" ? line.Lead : line);
  return entries.some((entry) => !isProviderInfoKind(entry?.ProviderInfoKind)) ? marked : undefined;
}

function endMs(word: TimedWord, next?: TimedWord): number {
  const raw = word.startMs + Math.max(0, word.durationMs);
  return next && next.startMs > word.startMs ? Math.min(raw, next.startMs) : raw;
}

function hasAuthoredBoundaryAfter(words: TimedWord[], index: number): boolean {
  const text = words[index]?.text ?? "";
  if (!text.trim()) return false;
  if (/\s$/u.test(text)) return true;

  // Some providers put a boundary at the start of the next fragment or in a
  // standalone timed whitespace fragment. Attribute that one boundary to the
  // preceding visible syllable so Spicy Lyrics can render and wrap it.
  for (let nextIndex = index + 1; nextIndex < words.length; nextIndex += 1) {
    const nextText = words[nextIndex]?.text ?? "";
    if (!nextText) continue;
    if (/^\s/u.test(nextText)) return true;
    if (nextText.trim()) return false;
  }
  return false;
}

export function toSyllableLyrics(
  lines: TimedLine[],
  provider: ProviderId,
  providerInfo?: ProviderInfoContext,
): NativeLyrics | undefined {
  const usableLines = lines.flatMap((line) => {
    // QRC, KRC, and YRC already encode their authored text as ordered
    // fragments. Keep that order and every nonempty zero-duration fragment;
    // ESLyric and Lyricify also concatenate these fragments literally.
    const words = line.words.filter((word) => word.text && word.durationMs >= 0);
    if (!words.length) return [];
    if (isProviderPlaceholder(words.map((word) => word.text).join(""), provider)) return [];
    return [{ ...line, words }];
  });
  if (isInstrumentalSentinelDocument(usableLines.map((line) => line.words.map((word) => word.text).join("")), provider)) return undefined;

  const Content = usableLines.map((line) => {
    const words = line.words;
    const Syllables = words.map((word, index) => ({
      Text: word.text,
      StartTime: word.startMs / 1000,
      EndTime: endMs(word, words[index + 1]) / 1000,
      // QRC/KRC/YRC already carry their boundaries as literal whitespace.
      // Spicy renders each syllable as an inline block, where edge whitespace
      // is not a reliable visible gap, so translate only that authored signal
      // into its native trailing-boundary flag. Never infer from alphabet or
      // punctuation shape.
      IsPartOfWord: !hasAuthoredBoundaryAfter(words, index),
    }));
    const Lead: Record<string, unknown> = {
      StartTime: Syllables[0].StartTime,
      EndTime: Syllables.at(-1)!.EndTime,
      Syllables,
    };
    if (line.providerInfoKind) Lead.ProviderInfoKind = line.providerInfoKind;
    const translation = cleanSidecarText(line.translation, provider);
    if (translation) {
      Lead.ProviderTranslatedText = translation;
    }
    const romanization = cleanSidecarText(line.romanization, provider);
    if (romanization) {
      Lead.ProviderRomanizedText = romanization;
      Lead.RomanizedText = romanization;
      Lead.TransliteratedText = romanization;
    }
    return { Type: "Vocal", OppositeAligned: false, Lead };
  });
  if (!Content.length) return undefined;
  const includesTranslation = Content.some((line) => "ProviderTranslatedText" in line.Lead);
  const includesRomanization = Content.some((line) => "ProviderRomanizedText" in line.Lead);
  const result: NativeLyrics = {
    Type: "Syllable", StartTime: (Content[0].Lead as any).StartTime,
    EndTime: (Content.at(-1)!.Lead as any).EndTime, Content,
    IncludesTranslation: includesTranslation,
    HasProviderTranslations: includesTranslation,
    IncludesRomanization: includesRomanization,
    HasTransliterations: includesRomanization,
    source: provider, fetchProvider: provider, sourceDisplayName: labels[provider],
  };
  return finalizeProviderInfo(result, provider, providerInfo);
}

export function parseLrc(text: string): Array<{ startMs: number; text: string }> {
  const output: Array<{ startMs: number; text: string }> = [];
  const offset = Number(/^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/im.exec(text)?.[1] ?? 0);
  for (const row of text.split(/\r?\n/)) {
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
    // Only leading numeric tags are timestamps. Bracketed lyric text such as
    // `[Chorus]`, punctuation, and later inline tags belong to the lyric.
    const content = row.slice(cursor).trim();
    for (const timestamp of timestamps) {
      if (content) output.push({
        startMs: Math.max(0, Math.round((timestamp.minutes * 60 + timestamp.seconds) * 1000) + offset),
        text: content,
      });
    }
  }
  return output.sort((a, b) => a.startMs - b.startMs);
}

export function toStaticLyrics(
  text: string,
  provider: ProviderId,
  providerInfo?: ProviderInfoContext,
): NativeLyrics | undefined {
  const rows = text.split(/\r?\n/).flatMap((row) => {
    if (/^\s*\[(?:ar|al|ti|by|offset|manualoffset|language|id|hash|sign|qq|total)\s*:/iu.test(row)) return [];
    const value = row.replace(/^(?:\[\d+:\d+(?:[.:]\d+)?\])+/u, "").trim();
    return value ? [{ text: value }] : [];
  });
  return toStaticLyricsFromRows(rows, provider, providerInfo);
}

export type StaticLyricsRow = {
  text: string;
  providerInfoKind?: ProviderInfoKind;
};

export function toStaticLyricsFromRows(
  rows: StaticLyricsRow[],
  provider: ProviderId,
  providerInfo?: ProviderInfoContext,
): NativeLyrics | undefined {
  const Lines = rows.map((row) => ({
    Text: row.text,
    ...(row.providerInfoKind ? { ProviderInfoKind: row.providerInfoKind } : {}),
  }));
  if (!Lines.length || isInstrumentalSentinelDocument(Lines.map((line) => line.Text), provider)) return undefined;
  const result: NativeLyrics = {
    Type: "Static",
    Lines,
    source: provider,
    fetchProvider: provider,
    sourceDisplayName: labels[provider],
  };
  return finalizeProviderInfo(result, provider, providerInfo);
}

function alignSidecars<T>(
  targets: readonly { startMs: number }[],
  sidecars: readonly T[],
  startMs: (sidecar: T) => number,
  text: (sidecar: T) => string | undefined,
): Array<string | undefined> {
  const rows = targets.length + 1;
  const columns = sidecars.length + 1;
  const matches = Array.from({ length: rows }, () => Array(columns).fill(0));
  const costs = Array.from({ length: rows }, () => Array(columns).fill(0));
  const actions = Array.from({ length: rows }, () => Array<"target" | "sidecar" | "match" | undefined>(columns));
  for (let targetIndex = 1; targetIndex < rows; targetIndex += 1) actions[targetIndex][0] = "target";
  for (let sidecarIndex = 1; sidecarIndex < columns; sidecarIndex += 1) actions[0][sidecarIndex] = "sidecar";

  const better = (
    candidateMatches: number,
    candidateCost: number,
    currentMatches: number,
    currentCost: number,
  ) => candidateMatches > currentMatches
    || (candidateMatches === currentMatches && candidateCost < currentCost);

  for (let targetIndex = 1; targetIndex < rows; targetIndex += 1) {
    for (let sidecarIndex = 1; sidecarIndex < columns; sidecarIndex += 1) {
      matches[targetIndex][sidecarIndex] = matches[targetIndex - 1][sidecarIndex];
      costs[targetIndex][sidecarIndex] = costs[targetIndex - 1][sidecarIndex];
      actions[targetIndex][sidecarIndex] = "target";

      if (better(
        matches[targetIndex][sidecarIndex - 1],
        costs[targetIndex][sidecarIndex - 1],
        matches[targetIndex][sidecarIndex],
        costs[targetIndex][sidecarIndex],
      )) {
        matches[targetIndex][sidecarIndex] = matches[targetIndex][sidecarIndex - 1];
        costs[targetIndex][sidecarIndex] = costs[targetIndex][sidecarIndex - 1];
        actions[targetIndex][sidecarIndex] = "sidecar";
      }

      const distance = Math.abs(targets[targetIndex - 1].startMs - startMs(sidecars[sidecarIndex - 1]));
      if (distance < 1500) {
        const candidateMatches = matches[targetIndex - 1][sidecarIndex - 1] + 1;
        const candidateCost = costs[targetIndex - 1][sidecarIndex - 1] + distance;
        if (better(
          candidateMatches,
          candidateCost,
          matches[targetIndex][sidecarIndex],
          costs[targetIndex][sidecarIndex],
        )) {
          matches[targetIndex][sidecarIndex] = candidateMatches;
          costs[targetIndex][sidecarIndex] = candidateCost;
          actions[targetIndex][sidecarIndex] = "match";
        }
      }
    }
  }

  const output = Array<string | undefined>(targets.length).fill(undefined);
  let targetIndex = targets.length;
  let sidecarIndex = sidecars.length;
  while (targetIndex > 0 || sidecarIndex > 0) {
    const action = actions[targetIndex][sidecarIndex];
    if (action === "match") {
      output[targetIndex - 1] = text(sidecars[sidecarIndex - 1]);
      targetIndex -= 1;
      sidecarIndex -= 1;
    } else if (action === "sidecar") {
      sidecarIndex -= 1;
    } else {
      targetIndex -= 1;
    }
  }
  return output;
}

export type LineLyricsRow = {
  startMs: number;
  text: string;
  providerInfoKind?: ProviderInfoKind;
};

export function toLineLyricsFromRows(
  inputRows: LineLyricsRow[],
  durationMs: number,
  provider: ProviderId,
  translation?: string,
  romanization?: string,
  providerInfo?: ProviderInfoContext,
): NativeLyrics | undefined {
  const rows = inputRows.filter((row) => !isProviderPlaceholder(row.text, provider));
  if (!rows.length || isInstrumentalSentinelDocument(rows.map((row) => row.text), provider)) return undefined;
  const translations = translation ? parseLrc(translation) : [];
  const romanizations = romanization ? parseLrc(romanization) : [];
  const translatedRows = alignSidecars(rows, translations, (row) => row.startMs, (row) => row.text);
  const romanizedRows = alignSidecars(rows, romanizations, (row) => row.startMs, (row) => row.text);
  const Content = rows.map((row, index) => {
    const translated = cleanSidecarText(translatedRows[index], provider);
    const romanized = cleanSidecarText(romanizedRows[index], provider);
    return {
      Type: "Vocal", Text: row.text, StartTime: row.startMs / 1000,
      EndTime: Math.max(row.startMs, rows[index + 1]?.startMs ?? durationMs) / 1000, OppositeAligned: false,
      ...(row.providerInfoKind ? { ProviderInfoKind: row.providerInfoKind } : {}),
      ...(translated ? { ProviderTranslatedText: translated } : {}),
      ...(romanized ? { ProviderRomanizedText: romanized, RomanizedText: romanized, TransliteratedText: romanized } : {}),
    };
  });
  const includesTranslation = Content.some((line) => "ProviderTranslatedText" in line);
  const includesRomanization = Content.some((line) => "ProviderRomanizedText" in line);
  const result: NativeLyrics = {
    Type: "Line", StartTime: Content[0].StartTime, EndTime: Content.at(-1)!.EndTime, Content,
    IncludesTranslation: includesTranslation,
    HasProviderTranslations: includesTranslation,
    IncludesRomanization: includesRomanization,
    HasTransliterations: includesRomanization,
    source: provider, fetchProvider: provider, sourceDisplayName: labels[provider],
  };
  return finalizeProviderInfo(result, provider, providerInfo);
}

export function toLineLyrics(
  lrc: string,
  durationMs: number,
  provider: ProviderId,
  translation?: string,
  romanization?: string,
  providerInfo?: ProviderInfoContext,
): NativeLyrics | undefined {
  return toLineLyricsFromRows(
    parseLrc(lrc),
    durationMs,
    provider,
    translation,
    romanization,
    providerInfo,
  );
}

export function attachSidecars(lines: TimedLine[], translation?: string, romanization?: string): TimedLine[] {
  const translations = translation ? parseLrc(translation) : [];
  const romanizations = romanization ? parseLrc(romanization) : [];
  const translatedRows = alignSidecars(lines, translations, (row) => row.startMs, (row) => row.text);
  const romanizedRows = alignSidecars(lines, romanizations, (row) => row.startMs, (row) => row.text);
  return lines.map((line, index) => ({
    ...line,
    translation: translatedRows[index],
    romanization: romanizedRows[index],
  }));
}

export function attachTimedSidecars(
  lines: TimedLine[],
  translations: TimedLine[] = [],
  romanizations: TimedLine[] = [],
): TimedLine[] {
  const timedText = (line: TimedLine) => line.words.map((word) => word.text).join("").trim() || undefined;
  const translatedRows = alignSidecars(lines, translations, (line) => line.startMs, timedText);
  const romanizedRows = alignSidecars(lines, romanizations, (line) => line.startMs, timedText);
  return lines.map((line, index) => ({
    ...line,
    translation: translatedRows[index],
    romanization: romanizedRows[index],
  }));
}
