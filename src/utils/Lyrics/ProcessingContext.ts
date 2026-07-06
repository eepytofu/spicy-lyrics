export type ProcessingContext = {
  translationEnabled: boolean;
  translationTargetLang: string;
  chineseTranslitMode: "pinyin" | "jyutping";
  chineseTones: boolean;
  koreanRomanizationMode: "spelling" | "pronunciation";
  cyrillicRomanizationMode: "Russian" | "Ukrainian";
  cyrillicKeepSigns: boolean;
  japaneseReadingMode: "romaji" | "furigana" | "both";
};

export function buildProcessingContextKey(context: ProcessingContext): string {
  return JSON.stringify({
    translation: context.translationEnabled ? context.translationTargetLang || "" : false,
    chineseTranslitMode: context.chineseTranslitMode,
    chineseTones: context.chineseTones,
    koreanRomanizationMode: context.koreanRomanizationMode,
    cyrillicRomanizationMode: context.cyrillicRomanizationMode,
    cyrillicKeepSigns: context.cyrillicKeepSigns,
    japaneseReadingMode: context.japaneseReadingMode,
  });
}
