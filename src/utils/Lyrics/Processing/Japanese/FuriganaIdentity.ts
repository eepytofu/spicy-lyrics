import { utf16IndexToCodePointOffset } from "../CodePoint.ts";

export function furiganaSegmentKey(startCp: number, endCp: number, reading: string): string {
  return `${startCp}:${endCp}\u0000${reading}`;
}

export function utf16FuriganaSegmentKey(
  sourceText: string,
  startUtf16: number,
  endUtf16: number,
  reading: string,
): string {
  return furiganaSegmentKey(
    utf16IndexToCodePointOffset(sourceText, startUtf16),
    utf16IndexToCodePointOffset(sourceText, endUtf16),
    reading,
  );
}
