import type { ChineseCharacterForm } from "./ChineseCharacterConversion.ts";

export type ProcessingContext = {
  translationEnabled: boolean;
  translationTargetLang: string;
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
    translation: context.translationEnabled ? context.translationTargetLang || "" : false,
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
