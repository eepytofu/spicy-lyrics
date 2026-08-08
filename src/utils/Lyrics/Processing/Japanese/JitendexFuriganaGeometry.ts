import { createRetryableLazyInitializer } from "../../Analyzer/LazyInitializer.ts";
import { normalizeJapaneseKana } from "./JapaneseKana.ts";

export type ProvenFuriganaGeometrySegment = {
  readonly start: number;
  readonly end: number;
  readonly reading: string;
};

let geometryBuckets: readonly string[] | undefined;
const lazyGeometry = createRetryableLazyInitializer(async () => {
  const module = await import("./GeneratedJitendexFuriganaGeometry.ts");
  geometryBuckets = module.JAPANESE_FURIGANA_GEOMETRY_BUCKETS;
});

export const loadJitendexFuriganaGeometry = (): Promise<void> =>
  lazyGeometry.ensure();

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Looks up precompiled Jitendex geometry for an exact surface/final-reading
 * pair. The generated asset contains only non-special, multi-segment
 * compounds reachable as one production Kuromoji token. Missing and
 * explicitly special readings intentionally fall back to broad-token ruby.
 */
export function lookupJitendexFuriganaGeometry(
  surface: string,
  reading: string
): readonly ProvenFuriganaGeometrySegment[] | undefined {
  const normalizedSurface = surface.normalize("NFKC");
  if (normalizedSurface !== surface) return undefined;
  const normalizedReading = normalizeJapaneseKana(reading);
  if (!normalizedSurface || !normalizedReading || !geometryBuckets) return undefined;

  const bucket =
    geometryBuckets[
      fnv1a(normalizedSurface) & (geometryBuckets.length - 1)
    ];
  const marker = `\n${normalizedSurface}\t`;
  const recordStart = bucket.indexOf(marker);
  if (recordStart < 0) return undefined;
  const geometryStart = recordStart + marker.length;
  const recordEnd = bucket.indexOf("\n", geometryStart);
  if (recordEnd < geometryStart) return undefined;

  const characters = Array.from(normalizedSurface);
  const utf16Offsets = [0];
  for (const character of characters) {
    utf16Offsets.push(utf16Offsets.at(-1)! + character.length);
  }

  const segments: ProvenFuriganaGeometrySegment[] = [];
  let codePointCursor = 0;
  let reconstructedReading = "";
  for (const encoded of bucket.slice(geometryStart, recordEnd).split("|")) {
    const separator = encoded.indexOf(":");
    const length = Number.parseInt(encoded.slice(0, separator), 36);
    const segmentReading = encoded.slice(separator + 1);
    const nextCursor = codePointCursor + length;
    if (
      separator < 1 ||
      !Number.isInteger(length) ||
      length < 1 ||
      !segmentReading ||
      nextCursor > characters.length
    ) {
      return undefined;
    }
    segments.push({
      start: utf16Offsets[codePointCursor],
      end: utf16Offsets[nextCursor],
      reading: segmentReading,
    });
    reconstructedReading += segmentReading;
    codePointCursor = nextCursor;
  }

  if (
    segments.length < 2 ||
    codePointCursor !== characters.length ||
    reconstructedReading !== normalizedReading
  ) {
    return undefined;
  }
  return segments;
}
