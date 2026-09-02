import type { ChineseCharacterForm } from "./ChineseCharacterConversion.ts";

export type ProcessingContext = {
  chineseTranslitMode: "pinyin" | "jyutping";
  chineseTones: boolean;
  joinMandarinWords: boolean;
  pinyinPlacement: "below" | "above";
  chineseCharacterForm: ChineseCharacterForm;
  koreanDisplayMode: "wordTranslit" | "rrStandard" | "rrPronunciation" | "vnPronunciation";
  cyrillicRomanizationMode: "Russian" | "Ukrainian";
  cyrillicKeepSigns: boolean;
};

export function buildProcessingContextKey(context: ProcessingContext): string {
  return JSON.stringify({
    chineseTranslitMode: context.chineseTranslitMode,
    chineseTones: context.chineseTones,
    joinMandarinWords: context.joinMandarinWords,
    pinyinPlacement: context.pinyinPlacement,
    chineseCharacterForm: context.chineseCharacterForm,
    koreanDisplayMode: context.koreanDisplayMode,
    cyrillicRomanizationMode: context.cyrillicRomanizationMode,
    cyrillicKeepSigns: context.cyrillicKeepSigns,
  });
}
