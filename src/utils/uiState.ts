import { atom } from "nanostores";
import type { ChineseCharacterForm } from "./Lyrics/ChineseCharacterConversion.ts";

export const UI_STATE_KEY = "SL:uiState";

function readUiStateBlob(): Record<string, any> {
  const raw = Spicetify.LocalStorage.get(UI_STATE_KEY);
  if (raw === null || raw === undefined) return {};
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return {};
  }
}

function saveUiStateBlob(obj: Record<string, any>) {
  Spicetify.LocalStorage.set(UI_STATE_KEY, JSON.stringify(obj));
}

const _uiState: Record<string, any> = readUiStateBlob();

for (const retiredKey of ["translationEnabled", "translationTargetLang", "showBuiltInTranslationButton"]) {
  delete _uiState[retiredKey];
}
saveUiStateBlob(_uiState);
try {
  localStorage.removeItem("spicy-lyrics:translationCache");
} catch {
  // Browser storage may be unavailable during isolated tests.
}

function persistAtom<T>(key: string, defaultValue: T) {
  const store = atom<T>(_uiState[key] !== undefined ? _uiState[key] : defaultValue);
  store.listen((v) => {
    _uiState[key] = v;
    saveUiStateBlob(_uiState);
  });
  return store;
}

// UI state atoms (persisted, not settings-panel entries)
export const $isNowBarOpen = persistAtom<boolean>("isNowBarOpen", false);
export const $nowBarSide = persistAtom<"left" | "right">("nowBarSide", "left");
export const $forceCompactMode = persistAtom<boolean>("forceCompactMode", false);
export const $romanization = persistAtom<boolean>("romanization", false);
export const $chineseTranslitMode = persistAtom<"pinyin" | "jyutping">("chineseTranslitMode", "pinyin");
export const $chineseTones = persistAtom<boolean>("chineseTones", true);
export const $joinMandarinWords = persistAtom<boolean>("joinMandarinWords", false);
export type PinyinPlacement = "below" | "above";
export const $pinyinPlacement = persistAtom<PinyinPlacement>("pinyinPlacement", "below");
export const $chineseCharacterForm = persistAtom<ChineseCharacterForm>("chineseCharacterForm", "original");
export const $japaneseReadingMode = persistAtom<"romaji" | "furigana" | "both">("japaneseReadingMode", "romaji");
export type KoreanDisplayMode = "wordTranslit" | "rrStandard" | "rrPronunciation" | "vnPronunciation";
export const $koreanDisplayMode = persistAtom<KoreanDisplayMode>("koreanDisplayMode", "rrStandard");
export const $cyrillicRomanizationMode = persistAtom<"Russian" | "Ukrainian">("cyrillicRomanizationMode", "Russian");
export const $cyrillicKeepSigns = persistAtom<boolean>("cyrillicKeepSigns", false);
export const $providerTranslationsEnabled = persistAtom<boolean>("providerTranslationsEnabled", true);
export const $hideEmbeddedProviderInfo = persistAtom<boolean>("hideEmbeddedProviderInfo", false);
export const $showVocalistLabels = persistAtom<boolean>("showVocalistLabels", true);
export const $showSongSections = persistAtom<boolean>("showSongSections", true);
export const $lyricsCopyFormat = persistAtom<"plain" | "timestamps" | "translation" | "metadata">("lyricsCopyFormat", "plain");
export const $flatViewControls = persistAtom<boolean>("flatViewControls", true);
export const $forceDarkBackground = persistAtom<boolean>("forceDarkBackground", false);
export const $prefetchNextLyrics = persistAtom<boolean>("prefetchNextLyrics", false);
export const $showChineseTranslitButton = persistAtom<boolean>("showChineseTranslitButton", true);
export const $fromVersion = persistAtom<string>("fromVersion", "");
export const $lastFetchedUri = persistAtom<string | null>("lastFetchedUri", null);
export const $previousVersion = persistAtom<string>("previousVersion", "");
export const $npvLyricsOpen = persistAtom<boolean>("npvLyricsOpen", true);
export const $npvLyricsExpanded = persistAtom<boolean>("npvLyricsExpanded", false);

// Runtime (ephemeral) atoms
export const $isGlobalNav = atom<boolean>(true);

(function watchGlobalNav() {
  function observe(root: Element) {
    $isGlobalNav.set(root.classList.contains("global-nav"));
    new MutationObserver(() => {
      $isGlobalNav.set(root.classList.contains("global-nav"));
    }).observe(root, { attributes: true, attributeFilter: ["class"] });
  }

  const existing = document.querySelector(".Root");
  if (existing) {
    observe(existing);
    return;
  }

  const mo = new MutationObserver((_, observer) => {
    const el = document.querySelector(".Root");
    if (el) {
      observer.disconnect();
      observe(el);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
