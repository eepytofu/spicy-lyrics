import type { TokenFuriganaReading } from "../../Reading/JapaneseReadingModel.ts";
import { normalizeJapaneseKana } from "./JapaneseKana.ts";

const KANJI_LIKE = /^[々〆ヶ一-鿿豈-﫿]$/u;
const KANA_ONLY = /^[ぁ-ゖー]$/u;

/**
 * Decode dictionary geometry only when it exactly reconstructs the supplied
 * surface and reading. The same validation safely projects lemma geometry onto
 * suffix-inflected forms because changed or displaced Kanji cannot reconstruct.
 */
export function parseJapaneseDictionaryGeometry(
  surface: string,
  reading: string,
  encoded: string,
): readonly TokenFuriganaReading[] | undefined {
  const characters = Array.from(surface);
  const offsets = [0];
  for (const character of characters) {
    offsets.push(offsets.at(-1)! + character.length);
  }

  const byStart = new Map<number, { end: number; reading: string }>();
  for (const rawSegment of encoded.split(";")) {
    const separator = rawSegment.indexOf(":");
    if (separator < 1) return undefined;
    const [rawStart, rawEnd = rawStart] = rawSegment.slice(0, separator).split("-");
    const start = Number.parseInt(rawStart, 10);
    const end = Number.parseInt(rawEnd, 10) + 1;
    const segmentReading = normalizeJapaneseKana(rawSegment.slice(separator + 1));
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end <= start
      || end > characters.length
      || !segmentReading
      || byStart.has(start)
      || characters.slice(start, end).some((character) => !KANJI_LIKE.test(character))
    ) {
      return undefined;
    }
    byStart.set(start, { end, reading: segmentReading });
  }

  const geometry: TokenFuriganaReading[] = [];
  let reconstructed = "";
  for (let index = 0; index < characters.length;) {
    const segment = byStart.get(index);
    if (segment) {
      reconstructed += segment.reading;
      geometry.push({
        text: segment.reading,
        targetStart: offsets[index],
        targetEnd: offsets[segment.end],
      });
      index = segment.end;
      continue;
    }
    const character = normalizeJapaneseKana(characters[index]);
    if (!KANA_ONLY.test(character)) return undefined;
    reconstructed += character;
    index += 1;
  }

  return geometry.length > 0 && reconstructed === normalizeJapaneseKana(reading)
    ? geometry
    : undefined;
}

export function japaneseDictionaryGeometryReconstructs(
  surface: string,
  reading: string,
  geometry: readonly TokenFuriganaReading[],
): boolean {
  return reconstructJapaneseDictionaryReading(surface, geometry)
    === normalizeJapaneseKana(reading);
}

export function reconstructJapaneseDictionaryReading(
  surface: string,
  geometry: readonly TokenFuriganaReading[],
): string | undefined {
  const characters = Array.from(surface);
  const offsets = [0];
  for (const character of characters) offsets.push(offsets.at(-1)! + character.length);
  const offsetIndexes = new Map(offsets.map((offset, index) => [offset, index]));
  const byStart = new Map<number, TokenFuriganaReading>();

  for (const segment of geometry) {
    const start = offsetIndexes.get(segment.targetStart);
    const end = offsetIndexes.get(segment.targetEnd);
    if (
      start === undefined
      || end === undefined
      || end <= start
      || !segment.text
      || byStart.has(start)
      || characters.slice(start, end).some((character) => !KANJI_LIKE.test(character))
    ) return undefined;
    byStart.set(start, segment);
  }

  let reconstructed = "";
  for (let index = 0; index < characters.length;) {
    const segment = byStart.get(index);
    if (segment) {
      reconstructed += normalizeJapaneseKana(segment.text);
      index = offsetIndexes.get(segment.targetEnd)!;
      continue;
    }
    const character = normalizeJapaneseKana(characters[index]);
    if (!KANA_ONLY.test(character)) return undefined;
    reconstructed += character;
    index += 1;
  }
  return byStart.size === geometry.length ? reconstructed : undefined;
}
