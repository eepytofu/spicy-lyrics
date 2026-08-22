import type { TimedWord } from "../types";

type TextTransform = (value: string) => string;

function timingMatches(value: string, pattern: RegExp): RegExpMatchArray[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...value.matchAll(new RegExp(pattern.source, flags))];
}

function timedWord(
  text: string,
  match: RegExpMatchArray,
  startOffsetMs: number,
  rawStartOffsetMs: number,
  transform: TextTransform
): TimedWord | undefined {
  const value = transform(text);
  const startMs = Number(match[1]);
  const durationMs = Number(match[2]);
  if (!value || !Number.isFinite(startMs) || !Number.isFinite(durationMs) || durationMs < 0)
    return undefined;
  const word: TimedWord = {
    text: value,
    startMs: Math.max(0, startOffsetMs + startMs),
    durationMs,
  };
  // Parser-only provenance must not widen the serialized TimedWord contract.
  Object.defineProperty(word, "rawStartMs", {
    value: rawStartOffsetMs + startMs,
    enumerable: false,
  });
  return word;
}

/** Parse formats such as KRC/YRC where a timing token precedes its text. */
export function parseLeadingTimedWords(
  value: string,
  pattern: RegExp,
  startOffsetMs = 0,
  transform: TextTransform = (text) => text,
  rawStartOffsetMs = startOffsetMs
): TimedWord[] {
  const matches = timingMatches(value, pattern);
  return matches.flatMap((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? value.length;
    const word = timedWord(
      value.slice(start, end),
      match,
      startOffsetMs,
      rawStartOffsetMs,
      transform
    );
    return word ? [word] : [];
  });
}

/** Parse formats such as QRC where a timing token follows its text. */
export function parseTrailingTimedWords(
  value: string,
  pattern: RegExp,
  startOffsetMs = 0,
  transform: TextTransform = (text) => text,
  rawStartOffsetMs = startOffsetMs
): TimedWord[] {
  const matches = timingMatches(value, pattern);
  let cursor = 0;
  return matches.flatMap((match) => {
    const index = match.index ?? cursor;
    const word = timedWord(
      value.slice(cursor, index),
      match,
      startOffsetMs,
      rawStartOffsetMs,
      transform
    );
    cursor = index + match[0].length;
    return word ? [word] : [];
  });
}

export function lyricOffset(value: string): number {
  const raw = /^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/im.exec(value)?.[1];
  const offset = Number(raw);
  return Number.isFinite(offset) ? offset : 0;
}
