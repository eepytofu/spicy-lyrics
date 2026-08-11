import { isProviderInfoEntry } from "../ProviderInfo.ts";

export type TranslationLineRef = {
  obj: any;
  sourceText: string;
  field: "TranslatedText";
};

export function joinSyllableText(syllables: any[] | undefined): string {
  if (!Array.isArray(syllables) || syllables.length === 0) return "";
  let lineText = "";
  let previousWasWordEnd = false;
  for (const syllable of syllables) {
    const text = syllable?.Text || "";
    if (!text) continue;
    if (previousWasWordEnd && lineText && !lineText.endsWith(" ")) lineText += " ";
    lineText += text;
    previousWasWordEnd = syllable?.IsPartOfWord === false;
  }
  return lineText.trim();
}

function isVocalGroup(group: any): boolean {
  return group?.Type === undefined || group?.Type === "Vocal";
}

export function collectTranslationLineRefs(lyrics: any): TranslationLineRef[] {
  const refs: TranslationLineRef[] = [];

  if (lyrics?.Type === "Static") {
    for (const line of lyrics.Lines || []) {
      if (isProviderInfoEntry(line)) continue;
      refs.push({ obj: line, sourceText: line?.Text || "", field: "TranslatedText" });
    }
  } else if (lyrics?.Type === "Line") {
    for (const group of lyrics.Content || []) {
      if (isProviderInfoEntry(group)) continue;
      if (group?.Text) {
        refs.push({ obj: group, sourceText: group.Text, field: "TranslatedText" });
      }
    }
  } else if (lyrics?.Type === "Syllable") {
    for (const group of lyrics.Content || []) {
      if (!isVocalGroup(group) || !group?.Lead) continue;
      if (isProviderInfoEntry(group.Lead)) continue;
      refs.push({
        obj: group.Lead,
        sourceText: joinSyllableText(group.Lead.Syllables),
        field: "TranslatedText",
      });
      for (const background of group.Background || []) {
        refs.push({
          obj: background,
          sourceText: joinSyllableText(background?.Syllables),
          field: "TranslatedText",
        });
      }
    }
  }

  return refs;
}
