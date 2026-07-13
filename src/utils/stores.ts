import { atom } from "nanostores";
import { ProjectVersion } from "../../project/config.ts";
import type { LyricsSelectionDiagnostics, LyricsSelectionMode } from "./Lyrics/LyricsCandidateSelector.ts";

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

function migrateSettingsKeys(blob: Record<string, any>): Record<string, any> {
  const renames: Record<string, string> = {
    "skip-spicy-font": "skipSpicyFont",
    show_npv_dynamic_bg: "showNpvDynamicBg",
  };
  let changed = false;
  for (const [oldKey, newKey] of Object.entries(renames)) {
    if (oldKey in blob) {
      blob[newKey] = blob[oldKey];
      delete blob[oldKey];
      changed = true;
    }
  }
  const selectionModes = new Set(["smart", "syncType", "strict"]);
  if ("strictLyricsSourcePriority" in blob) {
    if (!selectionModes.has(blob.lyricsSelectionMode)) {
      blob.lyricsSelectionMode = blob.strictLyricsSourcePriority === true ? "strict" : "syncType";
    }
    delete blob.strictLyricsSourcePriority;
    changed = true;
  } else if ("lyricsSelectionMode" in blob && !selectionModes.has(blob.lyricsSelectionMode)) {
    blob.lyricsSelectionMode = "smart";
    changed = true;
  }
  try {
    const order = JSON.parse(blob.lyricsSourceOrder);
    if (Array.isArray(order) && !order.includes("amlldb")) {
      const qqIndex = order.indexOf("qq");
      order.splice(qqIndex < 0 ? order.length : qqIndex, 0, "amlldb");
      blob.lyricsSourceOrder = JSON.stringify(order);
      const disabled = JSON.parse(blob.disabledLyricsSources ?? "[]");
      blob.disabledLyricsSources = JSON.stringify(Array.isArray(disabled) ? [...new Set([...disabled, "amlldb"])] : ["amlldb"]);
      changed = true;
    }
  } catch { /* malformed source preferences are normalized by the source manager */ }
  if (changed) saveSettingsBlob(blob);
  return blob;
}

const _settings: Record<string, any> = migrateSettingsKeys(readSettingsBlob());

function persistAtom<T>(key: string, defaultValue: T) {
  const store = atom<T>(_settings[key] !== undefined ? _settings[key] : defaultValue);
  store.listen((v) => {
    _settings[key] = v;
    saveSettingsBlob(_settings);
  });
  return store;
}

// Setting atoms (persisted)
export const $staticBackgroundMode = persistAtom<string>("staticBackgroundMode", "off");
export const $simpleLyricsMode = persistAtom<boolean>("simpleLyricsMode", false);
export const $simpleLyricsModeRenderingType = persistAtom<string>(
  "simpleLyricsModeRenderingType",
  "calculate"
);
export const $minimalLyricsMode = persistAtom<boolean>("minimalLyricsMode", false);
export const $skipSpicyFont = persistAtom<boolean>("skipSpicyFont", false);
export const $systemFontStack = persistAtom<string>("systemFontStack", "");
export const $fixHanGlyphVariants = persistAtom<boolean>("fixHanGlyphVariants", false);
export const $showNpvDynamicBg = persistAtom<boolean>("showNpvDynamicBg", true);
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
export const $viewControlsPosition = persistAtom<string>("viewControlsPosition", "Top");
export const $ttmlMakerMode = persistAtom<boolean>("ttmlMakerMode", true);
export const $developerMode = persistAtom<boolean>("developerMode", false);
export const $timelineOutsideMediaContent = persistAtom<boolean>(
  "timelineOutsideMediaContent",
  true
);
// Playback timing offset in milliseconds (bipolar: negative = earlier, positive = later)
export const $playbackOffset = persistAtom<number>("playbackOffset", 0);
export const $lyricsSourceOrder = persistAtom<string>(
  "lyricsSourceOrder",
  JSON.stringify(["spicy", "amlldb", "musixmatch", "apple", "spotify", "lrclib", "qq", "kugou", "netease"])
);
export const $disabledLyricsSources = persistAtom<string>(
  "disabledLyricsSources",
  JSON.stringify(["lrclib", "amlldb", "qq", "kugou", "netease"])
);
export const $ignoreMusixmatchWordSync = persistAtom<boolean>("ignoreMusixmatchWordSync", true);
export const $prioritizeAppleMusicQuality = persistAtom<boolean>("prioritizeAppleMusicQuality", false);
export const $lyricsSelectionMode = persistAtom<LyricsSelectionMode>(
  "lyricsSelectionMode",
  "smart"
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
