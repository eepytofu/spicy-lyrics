import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import { $currentLyricsData } from "../stores.ts";
import {
  $hideEmbeddedProviderInfo,
  $lyricsCopyFormat,
  $showVocalistLabels,
} from "../uiState.ts";
import { shouldHideProviderInfoEntry } from "./ProviderInfo.ts";
import { isMeaningfullyDifferent } from "./TextCompare.ts";
import { preferredCopyTranslation } from "./TranslationSidecar.ts";
import { isVocalCueEntry } from "./VocalSemantics.ts";

export type LyricsCopyFormat = "plain" | "timestamps" | "translation" | "metadata";

type CopyLine = {
  text: string;
  startTime?: number;
  translatedText?: string;
};

const cleanText = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const cleanSyllableText = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ") : "";

const joinSyllables = (syllables: any[] | undefined): string => {
  if (!Array.isArray(syllables)) return "";
  let out = "";
  let previousWasWordEnd = false;

  for (const syllable of syllables) {
    const text = cleanSyllableText(syllable?.Text);
    if (!text) continue;

    if (
      (previousWasWordEnd || syllable?.RomajiSpaceBefore) &&
      out &&
      !/\s$/u.test(out) &&
      !/^\s/u.test(text)
    ) {
      out += " ";
    }

    out += text;
    previousWasWordEnd = syllable?.IsPartOfWord === false;
  }

  return out.replace(/\s+/g, " ").trim();
};

const formatTime = (seconds: unknown): string => {
  const value = typeof seconds === "number" && Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(value / 60);
  const secs = value - minutes * 60;
  return `${minutes.toString().padStart(2, "0")}:${secs.toFixed(2).padStart(5, "0")}`;
};

function linesFromLyrics(
  lyrics: any,
  hideProviderInfo: boolean,
  showVocalistLabels: boolean,
): CopyLine[] {
  if (!lyrics || typeof lyrics !== "object") return [];

  if (lyrics.Type === "Static") {
    return (lyrics.Lines ?? [])
      .filter((line: any) =>
        !shouldHideProviderInfoEntry(line, hideProviderInfo)
        && (showVocalistLabels || !isVocalCueEntry(line)))
      .map((line: any) => ({
        text: cleanText(line?.Text),
        translatedText: cleanText(preferredCopyTranslation(line)),
      }))
      .filter((line: CopyLine) => line.text);
  }

  if (lyrics.Type === "Line") {
    const out: CopyLine[] = [];
    for (const line of lyrics.Content ?? []) {
      if (
        shouldHideProviderInfoEntry(line, hideProviderInfo)
        || (!showVocalistLabels && isVocalCueEntry(line))
      ) continue;
      const text = cleanText(line?.Text);
      if (text) {
        out.push({
          text,
          startTime: line?.StartTime,
          translatedText: cleanText(preferredCopyTranslation(line)),
        });
      }
      for (const background of line?.Background ?? []) {
        const backgroundText = cleanText(background?.Text);
        if (backgroundText) {
          out.push({
            text: backgroundText,
            startTime: background?.StartTime,
            translatedText: cleanText(preferredCopyTranslation(background)),
          });
        }
      }
    }
    return out;
  }

  if (lyrics.Type === "Syllable") {
    const out: CopyLine[] = [];
    for (const group of lyrics.Content ?? []) {
      if (
        shouldHideProviderInfoEntry(group?.Lead, hideProviderInfo)
        || (!showVocalistLabels && isVocalCueEntry(group?.Lead))
      ) continue;
      const leadText = joinSyllables(group?.Lead?.Syllables);
      if (leadText) {
        out.push({
          text: leadText,
          startTime: group?.Lead?.StartTime,
          translatedText: cleanText(preferredCopyTranslation(group?.Lead)),
        });
      }
      for (const bg of group?.Background ?? []) {
        const bgText = joinSyllables(bg?.Syllables);
        if (bgText) {
          out.push({
            text: bgText,
            startTime: bg?.StartTime,
            translatedText: cleanText(preferredCopyTranslation(bg)),
          });
        }
      }
    }
    return out;
  }

  return [];
}

function currentMetadata(): string {
  const title = cleanText(SpotifyPlayer.GetName());
  const artists = (SpotifyPlayer.GetArtists() ?? [])
    .map((artist) => cleanText(artist?.name))
    .filter(Boolean)
    .join(", ");

  if (title && artists) return `${artists} - ${title}`;
  return title || artists;
}

export function formatLyricsForCopy(
  lyrics: any,
  format: LyricsCopyFormat,
  hideProviderInfo = $hideEmbeddedProviderInfo.get(),
  showVocalistLabels = $showVocalistLabels.get(),
): string {
  const lines = linesFromLyrics(lyrics, hideProviderInfo, showVocalistLabels);
  const body = lines
    .map((line) => {
      const prefix = format === "timestamps" && typeof line.startTime === "number"
        ? `[${formatTime(line.startTime)}] `
        : "";
      const base = `${prefix}${line.text}`;
      if (format !== "translation") return base;
      if (!isMeaningfullyDifferent(line.translatedText, line.text)) return base;
      return `${base}\n${line.translatedText}`;
    })
    .join("\n");

  if (format !== "metadata") return body;
  const metadata = currentMetadata();
  return metadata ? `${metadata}\n\n${body}` : body;
}

export async function copyCurrentLyricsToClipboard(): Promise<boolean> {
  const raw = $currentLyricsData.get();
  if (!raw || raw.startsWith("NO_LYRICS:")) return false;

  let lyrics: any;
  try {
    lyrics = JSON.parse(raw);
  } catch {
    return false;
  }

  const text = formatLyricsForCopy(lyrics, $lyricsCopyFormat.get());
  if (!text.trim()) return false;

  await navigator.clipboard.writeText(text);
  return true;
}
