import type {
  JapaneseTokenEntry,
  TokenFuriganaReading,
} from "../../Reading/JapaneseReadingModel.ts";
import type { JapaneseAnalyzerToken } from "./JapaneseAnalyzer.ts";
import { loadJapaneseDeinflectionData } from "./JapaneseDeinflection.ts";
import { parseJapaneseDictionaryGeometry } from "./JapaneseDictionaryGeometry.ts";
import { normalizeJapaneseKana } from "./JapaneseKana.ts";

type CoverageData = Awaited<ReturnType<typeof loadJapaneseDeinflectionData>> & {
  JAPANESE_READING_FALLBACK_BUCKETS: readonly string[];
  JAPANESE_OKURIGANA_GEOMETRY_BUCKETS: readonly string[];
};

type ReadingFallback = {
  reading: string;
  geometry: readonly TokenFuriganaReading[];
};

type ReadingSpan = ReadingFallback & {
  startToken: number;
  endToken: number;
  start: number;
  end: number;
  surface: string;
};

const MAX_SPAN_TOKENS = 4;
const MAX_SPAN_UTF16 = 16;
const JAPANESE_TERM = /^[々〆ヶぁ-ゖァ-ヺー一-鿿豈-﫿]+$/u;
const HAS_KANJI = /[々〆ヶ一-鿿豈-﫿]/u;
const HAS_NON_ITERATION_KANJI = /[〆ヶ一-鿿豈-﫿]/u;
const KANA_ONLY = /^[ぁ-ゖー]+$/u;

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function lookupFallback(
  data: CoverageData,
  surface: string,
): ReadingFallback | undefined {
  const buckets = data.JAPANESE_READING_FALLBACK_BUCKETS;
  const bucket = buckets[fnv1a(surface) & (buckets.length - 1)];
  const marker = `\n${surface}\t`;
  const start = bucket.indexOf(marker);
  if (start < 0) return undefined;
  const valueStart = start + marker.length;
  const end = bucket.indexOf("\n", valueStart);
  const [reading, encodedGeometry] = bucket.slice(valueStart, end).split("\t");
  const geometry = parseJapaneseDictionaryGeometry(surface, reading, encodedGeometry);
  return reading && geometry ? { reading, geometry } : undefined;
}

function lookupOkuriganaGeometry(
  data: CoverageData,
  surface: string,
  reading: string,
): readonly TokenFuriganaReading[] | undefined {
  const normalizedReading = normalizeJapaneseKana(reading);
  const buckets = data.JAPANESE_OKURIGANA_GEOMETRY_BUCKETS;
  const bucket = buckets[fnv1a(surface) & (buckets.length - 1)];
  const marker = `\n${surface}\t${normalizedReading}\t`;
  const start = bucket.indexOf(marker);
  if (start < 0) return undefined;
  const valueStart = start + marker.length;
  const end = bucket.indexOf("\n", valueStart);
  return parseJapaneseDictionaryGeometry(
    surface,
    normalizedReading,
    bucket.slice(valueStart, end),
  );
}

function hasUsableReading(entry: JapaneseTokenEntry): boolean {
  return KANA_ONLY.test(normalizeJapaneseKana(entry.readingKana));
}

function isLiteralKanaAnchor(entry: JapaneseTokenEntry): boolean {
  const surface = normalizeJapaneseKana(entry.surface);
  return KANA_ONLY.test(surface) && surface === normalizeJapaneseKana(entry.readingKana);
}

function spansOverlap(left: ReadingSpan, right: ReadingSpan): boolean {
  return left.start < right.end && right.start < left.end;
}

function isUnresolvedHanEntry(entry: JapaneseTokenEntry): boolean {
  return !entry.consumed
    && HAS_KANJI.test(entry.surface)
    && !hasUsableReading(entry);
}

function coversContiguousGapIsland(
  tokens: readonly JapaneseAnalyzerToken[],
  entries: readonly JapaneseTokenEntry[],
  startToken: number,
  endToken: number,
  surface: string,
): boolean {
  if (!HAS_NON_ITERATION_KANJI.test(surface)) return false;
  const before = startToken - 1;
  if (
    before >= 0
    && tokens[before].end === tokens[startToken].start
    && isUnresolvedHanEntry(entries[before])
    && !entries[before].surface.endsWith("々")
  ) {
    return false;
  }
  const after = endToken + 1;
  return !(
    after < tokens.length
    && tokens[endToken].end === tokens[after].start
    && isUnresolvedHanEntry(entries[after])
    && !surface.endsWith("々")
  );
}

function applyReadingSpan(
  text: string,
  entries: JapaneseTokenEntry[],
  span: ReadingSpan,
): void {
  const first = entries[span.startToken];
  first.surface = text.slice(span.start, span.end);
  first.end = span.end;
  first.readingKana = span.reading;
  first.furigana = undefined;
  first.provenFurigana = span.geometry;
  const readingGroupId = `jmdict-fallback:${span.start}:${span.end}`;
  for (let index = span.startToken; index <= span.endToken; index += 1) {
    entries[index].readingGroupId = readingGroupId;
    if (index > span.startToken) entries[index].consumed = true;
  }
}

/**
 * Fill only analyzer abstentions with a unique exact JMdict reading, then add
 * exact JmdictFurigana geometry for mixed Kanji/okurigana tokens. Existing
 * analyzer and provider readings are never replaced.
 */
export async function resolveJapaneseDictionaryCoverage(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[],
  entries: JapaneseTokenEntry[],
): Promise<void> {
  const hasGap = entries.some((entry) =>
    !entry.consumed && HAS_KANJI.test(entry.surface) && !hasUsableReading(entry));
  const needsOkuriganaGeometry = entries.some((entry) => {
    const characters = Array.from(entry.surface);
    return !entry.consumed
      && characters.filter((character) => HAS_KANJI.test(character)).length >= 2
      && characters.some((character) => KANA_ONLY.test(normalizeJapaneseKana(character)));
  });
  if (!hasGap && !needsOkuriganaGeometry) return;

  let data: CoverageData;
  try {
    data = await loadJapaneseDeinflectionData() as CoverageData;
  } catch (error) {
    console.error("[Spicy Lyrics][Japanese dictionary coverage] data load failed", error);
    return;
  }
  if (hasGap) {
    const candidates: ReadingSpan[] = [];
    for (let startToken = 0; startToken < tokens.length; startToken += 1) {
      if (entries[startToken].consumed) continue;
      for (
        let endToken = startToken;
        endToken < tokens.length && endToken < startToken + MAX_SPAN_TOKENS;
        endToken += 1
      ) {
        if (entries[endToken].consumed) break;
        if (endToken > startToken && tokens[endToken - 1].end !== tokens[endToken].start) break;
        const ownedEntries = entries.slice(startToken, endToken + 1);
        if (!ownedEntries.some((entry) => !hasUsableReading(entry))) continue;
        if (ownedEntries.some((entry) => hasUsableReading(entry) && !isLiteralKanaAnchor(entry))) {
          break;
        }
        const start = tokens[startToken].start;
        const end = tokens[endToken].end;
        const surface = text.slice(start, end);
        if (surface.length > MAX_SPAN_UTF16) break;
        if (!JAPANESE_TERM.test(surface)) break;
        if (!coversContiguousGapIsland(tokens, entries, startToken, endToken, surface)) {
          continue;
        }
        const fallback = lookupFallback(data, surface);
        if (fallback) {
          candidates.push({ startToken, endToken, start, end, surface, ...fallback });
        }
      }
    }

    const selected: ReadingSpan[] = [];
    for (const candidate of candidates.sort((left, right) =>
      (right.endToken - right.startToken) - (left.endToken - left.startToken)
      || left.start - right.start)) {
      if (!selected.some((existing) => spansOverlap(existing, candidate))) {
        selected.push(candidate);
      }
    }
    for (const span of selected.sort((left, right) => left.start - right.start)) {
      applyReadingSpan(text, entries, span);
    }
  }

  for (const entry of entries) {
    if (
      entry.consumed
      || entry.readingProvenance === "providerExplicit"
      || entry.provenFurigana
      || !entry.readingKana
    ) {
      continue;
    }
    const geometry = lookupOkuriganaGeometry(data, entry.surface, entry.readingKana);
    if (geometry) entry.provenFurigana = geometry;
  }
}
