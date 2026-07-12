const Kana = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const Han = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const JapaneseLanguages = new Set(["ja", "jpn"]);
const ChineseLanguages = new Set(["zh", "zho", "chi", "cmn", "yue"]);

export function resolveHanLanguageTag(text: string, language?: string, iso2Language?: string): "ja" | "zh-Hans" | null {
  const primary = String(language ?? "").toLocaleLowerCase();
  const iso2 = String(iso2Language ?? "").toLocaleLowerCase();
  if (Kana.test(text)) return "ja";
  if (JapaneseLanguages.has(primary) || JapaneseLanguages.has(iso2)) return Han.test(text) ? "ja" : null;
  if (ChineseLanguages.has(primary) || ChineseLanguages.has(iso2)) return Han.test(text) ? "zh-Hans" : null;
  return Han.test(text) ? "zh-Hans" : null;
}

export function applyHanLanguageTag(element: HTMLElement, text: string, lyrics: any, enabled: boolean): void {
  if (!enabled) return;
  const tag = resolveHanLanguageTag(text, lyrics?.Language, lyrics?.LanguageISO2);
  if (tag) element.lang = tag;
}
