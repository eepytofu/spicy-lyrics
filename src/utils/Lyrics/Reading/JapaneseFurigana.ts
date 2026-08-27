import { normalizeJapaneseKana } from "../Processing/Japanese/JapaneseKana.ts";
import { lookupJitendexFuriganaGeometry } from "../Processing/Japanese/JitendexFuriganaGeometry.ts";
import {
  KanaCharTest,
  KanjiLikeCharTest,
  rangesOverlap,
  type FuriganaSegment,
  type JapaneseTokenContext,
  type TokenFuriganaReading,
} from "./JapaneseReadingModel.ts";

const KanjiLikeSequenceTest = /^[一-鿿々]+$/;
const KanaOnlySequenceTest = /^[ぁ-んァ-ンー・]+$/u;

export function kataToHira(text: string): string {
  return normalizeJapaneseKana(text);
}

export function resolveJapaneseTokenKanaReading(
  surface: string,
  reading: string,
): string {
  const candidate =
    reading && reading !== "*" ? reading : KanaOnlySequenceTest.test(surface) ? surface : "";
  return kataToHira(candidate);
}

export function okuriganaAnchoredKanjiRunReading(
  kana: string,
  kanaCursor: number,
  trailingOkurigana: string,
): string {
  const normalizedKana = kataToHira(kana);
  const normalizedOkurigana = kataToHira(trailingOkurigana);
  if (!normalizedKana || !normalizedOkurigana) return "";

  const safeCursor = Math.max(0, Math.min(kanaCursor, normalizedKana.length));
  const remaining = normalizedKana.slice(safeCursor);
  if (remaining.endsWith(normalizedOkurigana)) {
    return normalizedKana.slice(safeCursor, normalizedKana.length - normalizedOkurigana.length);
  }

  const fallback = normalizedKana.lastIndexOf(
    normalizedOkurigana,
    normalizedKana.length - normalizedOkurigana.length,
  );
  return fallback >= safeCursor
    ? normalizedKana.slice(safeCursor, fallback)
    : normalizedKana.slice(safeCursor);
}

function multiRunKanaReadingSegments(
  chars: readonly string[],
  utf16Offsets: readonly number[],
  kana: string,
): TokenFuriganaReading[] | undefined {
  type SurfacePart =
    | { kind: "kanji"; start: number; end: number }
    | { kind: "kana"; text: string };

  const parts: SurfacePart[] = [];
  for (let index = 0; index < chars.length; ) {
    const start = index;
    const kind = KanjiLikeCharTest.test(chars[index])
      ? "kanji"
      : KanaCharTest.test(chars[index])
        ? "kana"
        : undefined;
    if (!kind) return undefined;

    while (
      index < chars.length &&
      (kind === "kanji"
        ? KanjiLikeCharTest.test(chars[index])
        : KanaCharTest.test(chars[index]))
    ) {
      index += 1;
    }

    parts.push(
      kind === "kanji"
        ? { kind, start, end: index }
        : { kind, text: chars.slice(start, index).join("") },
    );
  }

  const memo = new Map<string, TokenFuriganaReading[] | null>();
  const align = (
    partIndex: number,
    readingCursor: number,
  ): TokenFuriganaReading[] | undefined => {
    const memoKey = `${partIndex}:${readingCursor}`;
    if (memo.has(memoKey)) return memo.get(memoKey) || undefined;

    if (partIndex >= parts.length) {
      const result = readingCursor === kana.length ? [] : undefined;
      memo.set(memoKey, result || null);
      return result;
    }

    const part = parts[partIndex];
    if (part.kind === "kana") {
      const result = kana.startsWith(part.text, readingCursor)
        ? align(partIndex + 1, readingCursor + part.text.length)
        : undefined;
      memo.set(memoKey, result || null);
      return result;
    }

    const next = parts[partIndex + 1];
    if (!next) {
      const text = kana.slice(readingCursor);
      const result = text
        ? [{
            text,
            targetStart: utf16Offsets[part.start],
            targetEnd: utf16Offsets[part.end],
          }]
        : undefined;
      memo.set(memoKey, result || null);
      return result;
    }
    if (next.kind !== "kana") {
      memo.set(memoKey, null);
      return undefined;
    }

    let anchorStart = kana.indexOf(next.text, readingCursor + 1);
    while (anchorStart >= 0) {
      const remaining = align(partIndex + 2, anchorStart + next.text.length);
      if (remaining) {
        const result = [{
          text: kana.slice(readingCursor, anchorStart),
          targetStart: utf16Offsets[part.start],
          targetEnd: utf16Offsets[part.end],
        }, ...remaining];
        memo.set(memoKey, result);
        return result;
      }
      anchorStart = kana.indexOf(next.text, anchorStart + 1);
    }

    memo.set(memoKey, null);
    return undefined;
  };

  return align(0, 0);
}

function kanaReadingSegments(
  surface: string,
  reading: string,
): TokenFuriganaReading[] {
  const kana = resolveJapaneseTokenKanaReading(surface, reading);
  if (!kana || kana === "*") return [];

  const normalizedSurface = kataToHira(surface);
  const chars = Array.from(normalizedSurface);
  const utf16Offsets: number[] = [];
  let offset = 0;
  for (const char of chars) {
    utf16Offsets.push(offset);
    offset += char.length;
  }
  utf16Offsets.push(offset);

  if (normalizedSurface.includes("々") && KanjiLikeSequenceTest.test(normalizedSurface)) {
    return [{ text: kana, targetStart: 0, targetEnd: normalizedSurface.length }];
  }
  if (KanjiLikeSequenceTest.test(normalizedSurface) && chars.length > 1) {
    return [{ text: kana, targetStart: 0, targetEnd: normalizedSurface.length }];
  }

  const kanjiRunCount = chars.reduce(
    (count, char, index) =>
      KanjiLikeCharTest.test(char) && !KanjiLikeCharTest.test(chars[index - 1] || "")
        ? count + 1
        : count,
    0,
  );
  if (kanjiRunCount > 1) {
    return multiRunKanaReadingSegments(chars, utf16Offsets, kana) || [];
  }

  const segments: TokenFuriganaReading[] = [];
  let kanaCursor = 0;
  let charIndex = 0;
  let coveredRunCount = 0;

  while (charIndex < chars.length) {
    const char = chars[charIndex];
    if (KanaCharTest.test(char)) {
      if (kana[kanaCursor] === char) kanaCursor += 1;
      charIndex += 1;
      continue;
    }
    if (!KanjiLikeCharTest.test(char)) {
      charIndex += 1;
      continue;
    }

    const start = charIndex;
    while (charIndex < chars.length && KanjiLikeCharTest.test(chars[charIndex])) {
      charIndex += 1;
    }
    const end = charIndex;
    const followingKana: string[] = [];
    for (let index = charIndex; index < chars.length && KanaCharTest.test(chars[index]); index += 1) {
      followingKana.push(chars[index]);
    }
    const readingStart = kanaCursor;

    if (followingKana.length > 0) {
      const text = okuriganaAnchoredKanjiRunReading(
        kana,
        kanaCursor,
        followingKana.join(""),
      );
      kanaCursor = Math.min(kana.length, kanaCursor + text.length);
    } else {
      kanaCursor = kana.length;
    }

    const text = kana.slice(readingStart, kanaCursor);
    if (!text) continue;
    coveredRunCount += 1;
    segments.push({
      text,
      targetStart: utf16Offsets[start],
      targetEnd: utf16Offsets[end],
    });
  }

  return kanjiRunCount > 1 && coveredRunCount < kanjiRunCount ? [] : segments;
}

export function kanaReadingForToken(
  surface: string,
  reading: string,
): TokenFuriganaReading | undefined {
  let kana = resolveJapaneseTokenKanaReading(surface, reading);
  if (!kana || kana === "*") return undefined;

  let normalizedSurface = kataToHira(surface);
  let targetStart = 0;
  let targetEnd = normalizedSurface.length;

  while (normalizedSurface.length > 0 && kana.length > 0) {
    const last = normalizedSurface[normalizedSurface.length - 1];
    if (!/[ぁ-んー]/.test(last) || !kana.endsWith(last)) break;
    normalizedSurface = normalizedSurface.slice(0, -1);
    kana = kana.slice(0, -1);
    targetEnd -= 1;
  }

  while (normalizedSurface.length > 0 && kana.length > 0) {
    const first = normalizedSurface[0];
    if (!/[ぁ-んー]/.test(first) || !kana.startsWith(first)) break;
    normalizedSurface = normalizedSurface.slice(1);
    kana = kana.slice(1);
    targetStart += 1;
  }

  return KanjiLikeCharTest.test(normalizedSurface) && kana
    ? { text: kana, targetStart, targetEnd }
    : undefined;
}

export function buildFuriganaFromContext(
  lineText: string,
  context: JapaneseTokenContext,
): FuriganaSegment[] {
  const segments: FuriganaSegment[] = [];
  const seen = new Set<string>();

  for (const entry of context.entries) {
    if (entry.consumed) continue;
    const provenGeometry =
      entry.readingProvenance === "providerExplicit"
        ? undefined
        : lookupJitendexFuriganaGeometry(entry.surface, entry.readingKana);
    const tokenSegments = entry.provenFurigana
      ? [...entry.provenFurigana]
      : provenGeometry
      ? provenGeometry.map((segment) => ({
          text: segment.reading,
          targetStart: segment.start,
          targetEnd: segment.end,
        }))
      : kanaReadingSegments(entry.surface, entry.readingKana);
    const fallbackSegments =
      tokenSegments.length > 0 ? tokenSegments : entry.furigana ? [entry.furigana] : [];

    for (const segment of fallbackSegments) {
      const start = Math.max(0, Math.min(lineText.length, entry.start + segment.targetStart));
      const end = Math.max(
        start + 1,
        Math.min(lineText.length, entry.start + segment.targetEnd),
      );
      const key = `${start}:${end}:${segment.text}`;
      if (!segment.text || seen.has(key)) continue;
      seen.add(key);
      segments.push({
        start,
        end,
        reading: segment.text,
        ...(entry.readingProvenance
          ? { provenance: entry.readingProvenance }
          : {}),
      });
    }
  }

  const local = segments.filter(
    (segment) =>
      !context.explicitReadings.some((explicit) =>
        rangesOverlap(segment.start, segment.end, explicit.start, explicit.end)
      ),
  );
  return [...local, ...context.explicitReadings].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}
