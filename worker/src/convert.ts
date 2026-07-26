import type { NativeLyrics, ProviderId, TimedLine, TimedWord } from "./types";

const labels: Record<ProviderId, string> = {
  qq: "QQ Music",
  kugou: "KuGou",
  netease: "NetEase Cloud Music",
  soda: "Soda Music",
};
const NETEASE_INSTRUMENTAL_SENTINEL = "纯音乐请欣赏";
const PROVIDER_CREDIT_LABELS = new Set([
  "词", "詞", "曲", "作词", "作詞", "作曲", "词曲", "詞曲",
  "编曲", "編曲", "制作", "製作", "制作人", "製作人", "监制", "監製",
  "和声", "和音", "混音", "录音", "錄音", "母带", "母帶",
  "二胡", "笛", "笛子", "吉他", "贝斯", "貝斯", "钢琴", "鋼琴",
  "弦乐", "弦樂", "鼓", "古筝", "古箏", "琵琶", "制作团队", "製作團隊",
  "出品", "发行", "發行", "策划", "策劃", "统筹", "統籌",
  "lyrics", "lyric", "lyricist", "composer", "arranger", "producer",
  "vocal", "vocals", "chorus", "mix", "mixing", "mastering", "recording",
  "guitar", "bass", "drums", "piano", "violin", "strings", "percussion",
]);

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

function providerCreditLabel(text: string): string | undefined {
  const match = /^(.{1,32}?)\s*[:：]\s*(.+)$/u.exec(text.trim());
  if (!match) return undefined;
  const label = match[1].replace(/\s+/gu, "").toLowerCase();
  return PROVIDER_CREDIT_LABELS.has(label) ? label : undefined;
}

function isSpeakerCue(text: string): boolean {
  // A bare `name:`/`合:` line introduces the next vocal part. It is not a
  // production credit even when the name itself contains Han characters.
  return /^.{1,32}[:：]\s*$/u.test(text.trim());
}

function looksLikeTitleArtistLine(text: string): boolean {
  return /\s[-–—]\s/u.test(text);
}

function providerInfoIndexes(lines: TimedLine[]): Set<number> {
  const indexes = new Set<number>();
  const texts = lines.map((line) => line.words.map((word) => word.text).join("").trim());

  for (let index = 0; index < texts.length; index += 1) {
    if (!isSpeakerCue(texts[index]) && providerCreditLabel(texts[index])) indexes.add(index);
  }

  // A combined title/artist header has no role label. Recognize it only when
  // it is the first line, starts at the beginning, and is immediately followed
  // by a real credit so an ordinary lyric containing a dash is left alone.
  if (
    texts.length > 1 &&
    lines[0].startMs <= 1000 &&
    looksLikeTitleArtistLine(texts[0]) &&
    indexes.has(1)
  ) {
    indexes.add(0);
  }
  return indexes;
}

function hasSyntheticInfoTiming(line: TimedLine): boolean {
  const durations = line.words
    .filter((word) => word.text.trim() && word.durationMs > 0)
    .map((word) => word.durationMs);
  if (!durations.length) return false;
  const averageDuration = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
  return averageDuration >= 1500;
}

export function toSyllableLyrics(lines: TimedLine[], provider: ProviderId): NativeLyrics | undefined {
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
  const infoIndexes = providerInfoIndexes(usableLines);

  const Content = usableLines.map((line, lineIndex) => {
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
      ...(infoIndexes.has(lineIndex) ? { IsProviderInfo: true } : {}),
      ...(infoIndexes.has(lineIndex) && hasSyntheticInfoTiming(line) ? { IsMetadata: true } : {}),
    };
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
  return {
    Type: "Syllable", StartTime: (Content[0].Lead as any).StartTime,
    EndTime: (Content.at(-1)!.Lead as any).EndTime, Content,
    IncludesTranslation: includesTranslation,
    HasProviderTranslations: includesTranslation,
    IncludesRomanization: includesRomanization,
    HasTransliterations: includesRomanization,
    source: provider, fetchProvider: provider, sourceDisplayName: labels[provider],
  };
}

export function parseLrc(text: string): Array<{ startMs: number; text: string }> {
  const output: Array<{ startMs: number; text: string }> = [];
  const offset = Number(/^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/im.exec(text)?.[1] ?? 0);
  for (const row of text.split(/\r?\n/)) {
    const timestamps: Array<{ minutes: number; seconds: number }> = [];
    let cursor = 0;
    while (cursor < row.length) {
      const timestamp = /^\s*\[(\d+):(\d+(?:\.\d+)?)\]/u.exec(row.slice(cursor));
      if (!timestamp) break;
      timestamps.push({ minutes: Number(timestamp[1]), seconds: Number(timestamp[2]) });
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

export function toStaticLyrics(text: string, provider: ProviderId): NativeLyrics | undefined {
  const Lines = text.split(/\r?\n/).flatMap((row) => {
    if (/^\s*\[(?:ar|al|ti|by|offset|language)\s*:/iu.test(row)) return [];
    const value = row.replace(/^(?:\[\d+:\d+(?:\.\d+)?\])+/u, "").trim();
    return value ? [{ Text: value }] : [];
  });
  if (!Lines.length || isInstrumentalSentinelDocument(Lines.map((line) => line.Text), provider)) return undefined;
  return {
    Type: "Static",
    Lines,
    source: provider,
    fetchProvider: provider,
    sourceDisplayName: labels[provider],
  };
}

export function toLineLyrics(
  lrc: string,
  durationMs: number,
  provider: ProviderId,
  translation?: string,
  romanization?: string,
): NativeLyrics | undefined {
  const rows = parseLrc(lrc).filter((row) => !isProviderPlaceholder(row.text, provider));
  if (!rows.length || isInstrumentalSentinelDocument(rows.map((row) => row.text), provider)) return undefined;
  const translations = translation ? parseLrc(translation) : [];
  const romanizations = romanization ? parseLrc(romanization) : [];
  const closest = (items: Array<{ startMs: number; text: string }>, start: number) => {
    let best: { startMs: number; text: string } | undefined; let distance = 1500;
    for (const item of items) { const next = Math.abs(item.startMs - start); if (next < distance) { best = item; distance = next; } }
    return best?.text;
  };
  const Content = rows.map((row, index) => {
    const translated = cleanSidecarText(closest(translations, row.startMs), provider);
    const romanized = cleanSidecarText(closest(romanizations, row.startMs), provider);
    return {
      Type: "Vocal", Text: row.text, StartTime: row.startMs / 1000,
      EndTime: Math.max(row.startMs, rows[index + 1]?.startMs ?? durationMs) / 1000, OppositeAligned: false,
      ...(translated ? { ProviderTranslatedText: translated } : {}),
      ...(romanized ? { ProviderRomanizedText: romanized, RomanizedText: romanized, TransliteratedText: romanized } : {}),
    };
  });
  const includesTranslation = Content.some((line) => "ProviderTranslatedText" in line);
  const includesRomanization = Content.some((line) => "ProviderRomanizedText" in line);
  return {
    Type: "Line", StartTime: Content[0].StartTime, EndTime: Content.at(-1)!.EndTime, Content,
    IncludesTranslation: includesTranslation,
    HasProviderTranslations: includesTranslation,
    IncludesRomanization: includesRomanization,
    HasTransliterations: includesRomanization,
    source: provider, fetchProvider: provider, sourceDisplayName: labels[provider],
  };
}

export function attachSidecars(lines: TimedLine[], translation?: string, romanization?: string): TimedLine[] {
  const translations = translation ? parseLrc(translation) : [];
  const romanizations = romanization ? parseLrc(romanization) : [];
  const closest = (items: Array<{ startMs: number; text: string }>, start: number) => {
    let best: { startMs: number; text: string } | undefined; let distance = 1500;
    for (const item of items) { const next = Math.abs(item.startMs - start); if (next < distance) { best = item; distance = next; } }
    return best?.text;
  };
  return lines.map((line) => ({ ...line, translation: closest(translations, line.startMs), romanization: closest(romanizations, line.startMs) }));
}

export function attachTimedSidecars(
  lines: TimedLine[],
  translations: TimedLine[] = [],
  romanizations: TimedLine[] = [],
): TimedLine[] {
  const closest = (items: TimedLine[], start: number) => {
    let best: TimedLine | undefined;
    let distance = 1500;
    for (const item of items) {
      const next = Math.abs(item.startMs - start);
      if (next < distance) {
        best = item;
        distance = next;
      }
    }
    return best?.words.map((word) => word.text).join("").trim() || undefined;
  };
  return lines.map((line) => ({
    ...line,
    translation: closest(translations, line.startMs),
    romanization: closest(romanizations, line.startMs),
  }));
}
