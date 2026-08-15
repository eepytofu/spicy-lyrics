import { atom } from "nanostores";
import { ProjectVersion } from "../../project/config.ts";
import type { LyricsSelectionDiagnostics, LyricsSelectionMode } from "./Lyrics/LyricsCandidateSelector.ts";
import type { LyricsOverrideLifetime } from "./Lyrics/LyricsOverridePreference.ts";

export const SETTINGS_KEY = "SL:settings";

function readSettingsBlob(): Record<string, any> {
  const raw = Spicetify.LocalStorage.get(SETTINGS_KEY);
  if (raw === null || raw === undefined) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveSettingsBlob(obj: Record<string, any>) {
  Spicetify.LocalStorage.set(SETTINGS_KEY, JSON.stringify(obj));
}

const _settings: Record<string, any> = readSettingsBlob();

function migrateRenamedSetting(from: string, to: string): void {
  if (_settings[to] === undefined && _settings[from] !== undefined) {
    _settings[to] = _settings[from];
  }
  if (from in _settings) {
    delete _settings[from];
    saveSettingsBlob(_settings);
  }
}

migrateRenamedSetting("ignoreMusixmatchWordSync", "ignoreMusixmatchSyllableSync");

export function persistAtom<T>(key: string, defaultValue: T) {
  const store = atom<T>(_settings[key] !== undefined ? _settings[key] : defaultValue);
  store.listen((v) => {
    _settings[key] = v;
    saveSettingsBlob(_settings);
  });
  return store;
}

// Setting atoms (persisted)
export const $staticBackgroundMode = persistAtom<string>("staticBackgroundMode", "off");
export const $staticBackgroundBlur = persistAtom<number>("staticBackgroundBlur", 0);
export const $simpleLyricsMode = persistAtom<boolean>("simpleLyricsMode", false);
export const $simpleLyricsModeRenderingType = persistAtom<string>(
  "simpleLyricsModeRenderingType",
  "calculate"
);
export const $minimalLyricsMode = persistAtom<boolean>("minimalLyricsMode", false);
export const $lineHoverBackground = persistAtom<boolean>("lineHoverBackground", true);
export const $skipSpicyFont = persistAtom<boolean>("skipSpicyFont", false);
export const $systemFontStack = persistAtom<string>("systemFontStack", "");
export const $fixHanGlyphVariants = persistAtom<boolean>("fixHanGlyphVariants", false);
export const $showNpvDynamicBg = persistAtom<boolean>("showNpvDynamicBg", true);
export const $disableNpvLyrics = persistAtom<boolean>("disableNpvLyrics", false);
export const $hideNpvLyricsWhenUnavailable = persistAtom<boolean>(
  "hideNpvLyricsWhenUnavailable",
  true,
);
export const $lockedMediaBox = persistAtom<boolean>("lockedMediaBox", false);
// $popupLyricsAllowed: stored as actual boolean "popupLyricsAllowed" in the settings blob.
export const $popupLyricsAllowed = (() => {
  const initial: boolean =
    _settings["popupLyricsAllowed"] !== undefined ? _settings["popupLyricsAllowed"] : true;
  const store = atom<boolean>(initial);
  store.listen((v) => {
    _settings["popupLyricsAllowed"] = v;
    saveSettingsBlob(_settings);
  });
  return store;
})();
export const $viewControlsPosition = persistAtom<string>("viewControlsPosition", "Bottom");
export const $ttmlMakerMode = persistAtom<boolean>("ttmlMakerMode", true);
export const $developerMode = persistAtom<boolean>("developerMode", false);
export const $timelineOutsideMediaContent = persistAtom<boolean>(
  "timelineOutsideMediaContent",
  true
);
export const $showVolumeSlider = persistAtom<boolean>("showVolumeSlider", true);
// Playback timing offset in milliseconds (bipolar: negative = earlier, positive = later)
export const $playbackOffset = persistAtom<number>("playbackOffset", 0);
export const $lyricsSourceOrder = persistAtom<string>(
  "lyricsSourceOrder",
  JSON.stringify(["spicy", "amlldb", "musixmatch", "apple", "qq", "kugou", "netease", "soda", "spotify", "lrclib"])
);
export const $disabledLyricsSources = persistAtom<string>(
  "disabledLyricsSources",
  JSON.stringify(["lrclib", "amlldb", "qq", "kugou", "netease", "soda"])
);
export const $ignoreMusixmatchSyllableSync = persistAtom<boolean>("ignoreMusixmatchSyllableSync", true);
export const $prioritizeAppleMusicQuality = persistAtom<boolean>("prioritizeAppleMusicQuality", false);
export const $lyricsSelectionMode = persistAtom<LyricsSelectionMode>(
  "lyricsSelectionMode",
  "smart"
);
export const $manualLyricsSelectionLifetime = persistAtom<LyricsOverrideLifetime>(
  "manualLyricsSelectionLifetime",
  "persistent"
);
export const $musixmatchToken = persistAtom<string>("musixmatchToken", "");
export const $externalLyricsWorkerUrl = persistAtom<string>("externalLyricsWorkerUrl", "");
export const $customLyricsServers = persistAtom<string>("customLyricsServers", "[]");

// Version atom — NOT persisted, set once at startup
export const $spicyLyricsVersion = atom<string>(
  (window as any)._spicy_lyrics_metadata?.LoadedVersion ?? ProjectVersion
);

// Runtime (ephemeral) atoms
export const $currentLyricsType = atom<string>("None");
export const $lyricsContainerExists = atom<boolean>(false);
export const $currentlyFetching = atom<boolean>(false);
export const $currentLyricsData = atom<string>("");
export const $lyricsSelectionDiagnostics = atom<LyricsSelectionDiagnostics | null>(null);
