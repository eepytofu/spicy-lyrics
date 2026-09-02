import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map<string, string>();
(globalThis as any).Spicetify = {
  LocalStorage: {
    get: (key: string) => storage.get(key) ?? null,
    set: (key: string, value: string) => storage.set(key, value),
  },
};
(globalThis as any).document = {
  querySelector: () => null,
  documentElement: {},
};
(globalThis as any).MutationObserver = class {
  observe(): void {}
  disconnect(): void {}
};

const {
  UI_STATE_KEY,
  $providerTranslationsEnabled,
  $hideEmbeddedProviderInfo,
  $showSongSections,
  $showVocalistLabels,
  $chineseTones,
  $joinMandarinWords,
  $pinyinPlacement,
  $npvLyricsExpanded,
  $npvLyricsOpen,
  $prefetchNextLyrics,
} = await import("../src/utils/uiState.ts");

test("Chinese tones and provider translations retain their defaults", () => {
  assert.equal($providerTranslationsEnabled.get(), true);
  assert.equal($hideEmbeddedProviderInfo.get(), false);
  assert.equal($showVocalistLabels.get(), true);
  assert.equal($showSongSections.get(), true);
  assert.equal($chineseTones.get(), true);
  assert.equal($joinMandarinWords.get(), false);
  assert.equal($pinyinPlacement.get(), "below");
  assert.equal($npvLyricsOpen.get(), true);
  assert.equal($npvLyricsExpanded.get(), false);
  assert.equal($prefetchNextLyrics.get(), false);
});

test("retired built-in translation settings are scrubbed while tone preference persists", () => {
  $chineseTones.set(false);

  const persisted = JSON.parse(storage.get(UI_STATE_KEY) ?? "{}");
  assert.equal(persisted.chineseTones, false);
  assert.equal(persisted.showBuiltInTranslationButton, undefined);
  assert.equal(persisted.translationEnabled, undefined);
  assert.equal(persisted.translationTargetLang, undefined);
});

test("vocalist and song-section visibility persist independently", () => {
  $showVocalistLabels.set(false);

  const persisted = JSON.parse(storage.get(UI_STATE_KEY) ?? "{}");
  assert.equal(persisted.showVocalistLabels, false);
  assert.equal(persisted.showSongSections, undefined);
  assert.equal($showSongSections.get(), true);
});
