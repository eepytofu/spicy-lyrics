import { detectChineseCharacterForm, type ChineseCharacterForm } from "./ChineseCharacterConversion.ts";

export type HanLanguageTag = "ja" | "zh" | "zh-Hans" | "zh-Hant";

const Kana = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const Han = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const JapaneseLanguages = new Set(["ja", "jpn"]);
const ChineseLanguages = new Set(["zh", "zho", "chi", "cmn", "yue"]);

function resolveChineseTag(text: string, characterForm: ChineseCharacterForm): Exclude<HanLanguageTag, "ja"> {
  if (characterForm === "simplified") return "zh-Hans";
  if (characterForm === "traditional") return "zh-Hant";
  const detected = detectChineseCharacterForm(text);
  return detected === "simplified" ? "zh-Hans" : detected === "traditional" ? "zh-Hant" : "zh";
}

export function resolveHanLanguageTag(
  text: string,
  language?: string,
  iso2Language?: string,
  characterForm: ChineseCharacterForm = "original",
): HanLanguageTag | null {
  const primary = String(language ?? "").toLowerCase();
  const iso2 = String(iso2Language ?? "").toLowerCase();
  if (Kana.test(text)) return "ja";
  if (JapaneseLanguages.has(primary) || JapaneseLanguages.has(iso2)) return Han.test(text) ? "ja" : null;
  if (ChineseLanguages.has(primary) || ChineseLanguages.has(iso2)) return Han.test(text) ? resolveChineseTag(text, characterForm) : null;
  return Han.test(text) ? resolveChineseTag(text, characterForm) : null;
}

export function applyHanLanguageTag(element: HTMLElement, text: string, lyrics: any, enabled: boolean): void {
  if (!enabled) return;
  const tag = resolveHanLanguageTag(text, lyrics?.Language, lyrics?.LanguageISO2, lyrics?.ChineseCharacterForm);
  if (tag) element.lang = tag;
}
