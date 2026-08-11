import { resolveCjkDocumentBranch } from "./CjkLanguageRouting.ts";

function lyricLineTexts(lyrics: any): string[] {
  if (lyrics?.Type === "Static") {
    return (lyrics.Lines || []).map((line: any) => line.Text || "");
  }
  if (lyrics?.Type === "Line") {
    return (lyrics.Content || []).map((line: any) => line.Text || "");
  }
  if (lyrics?.Type === "Syllable") {
    return (lyrics.Content || []).flatMap((group: any) => [
      (group.Lead?.Syllables || []).map((syllable: any) => syllable.Text || "").join(""),
      ...(group.Background || []).map((background: any) =>
        (background.Syllables || []).map((syllable: any) => syllable.Text || "").join("")
      ),
    ]);
  }
  return [];
}

/**
 * Pending lyrics have not received their per-line ReadingPrimaryScript yet.
 * Use the same document-level CJK routing heuristic as processing so a small
 * Kana island does not temporarily move a Chinese track's placeholder below.
 */
export function isChineseDocumentPendingReading(lyrics: any): boolean {
  return resolveCjkDocumentBranch(lyricLineTexts(lyrics).join("\n"), "und") === "Chinese";
}
