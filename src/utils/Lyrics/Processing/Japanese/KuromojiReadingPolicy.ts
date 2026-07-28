import type { JapaneseAnalyzerReadingState, JapaneseAnalyzerToken } from "./JapaneseAnalyzer.ts";

const PLURAL_PRONOUN_BEFORE_KATA = /^(?:あなた|貴方|君|きみ|皆|みんな|僕|ぼく|私|わたし|我々)$/;

function previousActive(entries: JapaneseAnalyzerReadingState[], index: number): number {
  for (let current = index; current >= 0; current -= 1) {
    if (!entries[current].consumed) return current;
  }
  return -1;
}

function setReading(
  entry: JapaneseAnalyzerReadingState,
  romaji: string,
  readingKana: string
): void {
  entry.romaji = romaji;
  entry.readingKana = readingKana;
}

/**
 * Compatibility corrections for the production Kuromoji/IPADIC profile.
 * Other analyzers must not inherit these dictionary-specific overrides.
 */
export function applyKuromojiReadingOverrides(
  entries: JapaneseAnalyzerReadingState[],
  tokens: readonly JapaneseAnalyzerToken[]
): void {
  for (let index = 0; index < tokens.length; index += 1) {
    if (entries[index].consumed) continue;

    const surface = entries[index].surface || tokens[index].surface || "";
    const previousIndex = previousActive(entries, index - 1);
    const previousSurface =
      previousIndex >= 0
        ? entries[previousIndex].surface || tokens[previousIndex]?.surface || ""
        : "";

    if (surface === "私" && tokens[index].partOfSpeech === "pronoun") {
      // Lyrics register: prefer わたし over formal わたくし. POS-guarded so
      // compounds such as 私立 stay dictionary-owned.
      setReading(entries[index], "watashi", "わたし");
      continue;
    }

    if (surface === "君" && tokens[index].partOfSpeech === "pronoun") {
      // Some dictionaries emit the honorific suffix reading くん for bare 君.
      // Independent pronoun use in lyrics should read きみ; suffix use stays kun.
      setReading(entries[index], "kimi", "きみ");
      continue;
    }

    if (surface === "1人" || (surface === "1" && entries[index + 1]?.surface === "人")) {
      setReading(entries[index], "hitori", "ひとり");
      if (surface === "1") {
        entries[index].surface = "1人";
        entries[index].end = entries[index + 1].end;
        entries[index + 1].consumed = true;
      }
      continue;
    }

    if (surface === "2人" || (surface === "2" && entries[index + 1]?.surface === "人")) {
      setReading(entries[index], "futari", "ふたり");
      if (surface === "2") {
        entries[index].surface = "2人";
        entries[index].end = entries[index + 1].end;
        entries[index + 1].consumed = true;
      }
      continue;
    }

    if (surface === "方" && PLURAL_PRONOUN_BEFORE_KATA.test(previousSurface)) {
      const previousToken = previousIndex >= 0 ? tokens[previousIndex] : undefined;
      const currentPartOfSpeech = tokens[index].partOfSpeech;
      if (
        (currentPartOfSpeech === "suffix" || currentPartOfSpeech === "noun") &&
        previousToken?.partOfSpeech === "pronoun"
      ) {
        setReading(entries[index], "gata", "がた");
      }
    }
  }
}
