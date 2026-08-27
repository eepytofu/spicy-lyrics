import assert from "node:assert/strict";
import { test } from "node:test";

test("lyrics controls default to Bottom without replacing a saved choice", async () => {
  let settingsBlob: string | null = null;
  Object.defineProperty(globalThis, "Spicetify", {
    configurable: true,
    value: {
      LocalStorage: {
        get: () => settingsBlob,
        set: (_key: string, value: string) => {
          settingsBlob = value;
        },
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });

  const freshStores = await import("../src/utils/stores.ts?fresh-settings");
  assert.equal(freshStores.$viewControlsPosition.get(), "Bottom");
  assert.equal(freshStores.$staticBackgroundBlur.get(), 0);
  assert.equal(freshStores.$hideNpvLyricsWhenUnavailable.get(), true);
  assert.equal(freshStores.$disableNpvLyrics.get(), false);
  assert.equal(freshStores.$lineHoverBackground.get(), true);
  assert.equal(freshStores.$showVolumeSlider.get(), true);
  assert.equal(freshStores.$highlightProviderReadings.get(), false);
  freshStores.$highlightProviderReadings.set(true);
  assert.equal(JSON.parse(settingsBlob ?? "{}").highlightProviderReadings, true);

  settingsBlob = JSON.stringify({ viewControlsPosition: "Top" });
  const existingStores = await import("../src/utils/stores.ts?existing-settings");
  assert.equal(existingStores.$viewControlsPosition.get(), "Top");
});

test("renamed Musixmatch timing preference preserves the saved choice", async () => {
  let settingsBlob: string | null = JSON.stringify({ ignoreMusixmatchWordSync: false });
  Object.defineProperty(globalThis, "Spicetify", {
    configurable: true,
    value: {
      LocalStorage: {
        get: () => settingsBlob,
        set: (_key: string, value: string) => {
          settingsBlob = value;
        },
      },
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

  const legacyStores = await import("../src/utils/stores.ts?legacy-musixmatch-setting");
  assert.equal(legacyStores.$ignoreMusixmatchSyllableSync.get(), false);
  assert.deepEqual(JSON.parse(settingsBlob ?? "{}"), {
    ignoreMusixmatchSyllableSync: false,
  });

  settingsBlob = JSON.stringify({
    ignoreMusixmatchWordSync: false,
    ignoreMusixmatchSyllableSync: true,
  });
  const currentStores = await import("../src/utils/stores.ts?current-musixmatch-setting");
  assert.equal(currentStores.$ignoreMusixmatchSyllableSync.get(), true);
  assert.equal(JSON.parse(settingsBlob ?? "{}").ignoreMusixmatchWordSync, undefined);

  settingsBlob = null;
  const defaultStores = await import("../src/utils/stores.ts?default-musixmatch-setting");
  assert.equal(defaultStores.$ignoreMusixmatchSyllableSync.get(), true);

  settingsBlob = JSON.stringify({ ignoreMusixmatchSyllableSync: false });
  const migratedStores = await import("../src/utils/stores.ts?migrated-musixmatch-setting");
  assert.equal(migratedStores.$ignoreMusixmatchSyllableSync.get(), false);
});

test("experiments are persisted and the final slider style defaults on", async () => {
  let settingsBlob: string | null = null;
  Object.defineProperty(globalThis, "Spicetify", {
    configurable: true,
    value: {
      LocalStorage: {
        get: () => settingsBlob,
        set: (_key: string, value: string) => {
          settingsBlob = value;
        },
      },
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

  const experiments = await import("../src/utils/experiments.ts?fresh-experiments");
  assert.equal(experiments.isExperimentEnabled("newProgressBarStyling"), true);
  experiments.$experiment("newProgressBarStyling").set(false);
  assert.equal(JSON.parse(settingsBlob ?? "{}")["experiment:newProgressBarStyling"], false);
});
