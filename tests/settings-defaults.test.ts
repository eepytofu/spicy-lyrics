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

  settingsBlob = JSON.stringify({ viewControlsPosition: "Top" });
  const existingStores = await import("../src/utils/stores.ts?existing-settings");
  assert.equal(existingStores.$viewControlsPosition.get(), "Top");
});
