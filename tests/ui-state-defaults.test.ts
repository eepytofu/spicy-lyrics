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
  $chineseTones,
  $showBuiltInTranslationButton,
  $translationEnabled,
} = await import("../src/utils/uiState.ts");

test("Chinese tones default on while built-in translation stays off", () => {
  assert.equal($providerTranslationsEnabled.get(), true);
  assert.equal($chineseTones.get(), true);
  assert.equal($translationEnabled.get(), false);
  assert.equal($showBuiltInTranslationButton.get(), true);
});

test("built-in translation button visibility and tone preference persist independently", () => {
  $chineseTones.set(false);
  $showBuiltInTranslationButton.set(false);

  const persisted = JSON.parse(storage.get(UI_STATE_KEY) ?? "{}");
  assert.equal(persisted.chineseTones, false);
  assert.equal(persisted.showBuiltInTranslationButton, false);
  assert.equal(persisted.translationEnabled, undefined);
});
