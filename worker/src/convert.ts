import type { NativeLyrics, ProviderId, TimedLine, TimedWord } from "./types";

const labels: Record<ProviderId, string> = { qq: "QQ Music", kugou: "KuGou", netease: "NetEase Cloud Music" };
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

function endMs(word: TimedWord, next?: TimedWord): number {
  const raw = word.startMs + Math.max(0, word.durationMs);
  return next && next.startMs > word.startMs ? Math.min(raw, next.startMs) : raw;
}

function isPartOfWord(text: string, nextText: string | undefined): boolean {
  if (!nextText) return false;
  if (/\s$/.test(text) || /^\s/.test(nextText)) return false;
  if (/^[’'\-.,!?;:%)\]}，。！？；：、]/u.test(nextText)) return true;
  return !/[\p{Script=Latin}\p{Number}]$/u.test(text) || !/^[\p{Script=Latin}\p{Number}]/u.test(nextText);
}

export function toSyllableLyrics(lines: TimedLine[], provider: ProviderId): NativeLyrics | undefined {
  const usableLines = lines.flatMap((line) => {
    const words = line.words.filter((word) => word.text && word.durationMs > 0).sort((a, b) => a.startMs - b.startMs);
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
      EndTime: Math.max(word.startMs + 1, endMs(word, words[index + 1])) / 1000,
      IsPartOfWord: isPartOfWord(word.text, words[index + 1]?.text),
    }));
    const Lead: Record<string, unknown> = {
      StartTime: Syllables[0].StartTime,
      EndTime: Syllables.at(-1)!.EndTime,
      Syllables,
    };
    const translation = cleanSidecarText(line.translation, provider);
    if (translation) {
      Lead.ProviderTranslatedText = translation;
      Lead.TranslatedText = translation;
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
    IncludesRomanization: includesRomanization,
    HasTransliterations: includesRomanization,
    source: provider, fetchProvider: provider, sourceDisplayName: labels[provider],
  };
}

export function parseLrc(text: string): Array<{ startMs: number; text: string }> {
  const output: Array<{ startMs: number; text: string }> = [];
  for (const row of text.split(/\r?\n/)) {
    const timestamps = [...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const content = row.replace(/\[[^\]]+\]/g, "").trim();
    for (const timestamp of timestamps) {
      if (content) output.push({ startMs: Math.round((Number(timestamp[1]) * 60 + Number(timestamp[2])) * 1000), text: content });
    }
  }
  return output.sort((a, b) => a.startMs - b.startMs);
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
      ...(translated ? { ProviderTranslatedText: translated, TranslatedText: translated } : {}),
      ...(romanized ? { ProviderRomanizedText: romanized, RomanizedText: romanized, TransliteratedText: romanized } : {}),
    };
  });
  const includesTranslation = Content.some((line) => "ProviderTranslatedText" in line);
  const includesRomanization = Content.some((line) => "ProviderRomanizedText" in line);
  return {
    Type: "Line", StartTime: Content[0].StartTime, EndTime: Content.at(-1)!.EndTime, Content,
    IncludesTranslation: includesTranslation,
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
