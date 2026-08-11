import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const settingsSource = readFileSync(
  new URL("../src/components/ReactComponents/SettingsPanel/LanguagesSection.tsx", import.meta.url),
  "utf8"
);

test("Pinyin placement offers Below and Above without clearing word grouping", () => {
  assert.match(settingsSource, /label="Pinyin Placement"/u);
  assert.match(settingsSource, /options=\{\["below", "above"\]\}/u);
  assert.match(settingsSource, /labels=\{\["Below lyrics", "Above characters"\]\}/u);
  assert.match(
    settingsSource,
    /disabled=\{chineseMode !== "pinyin" \|\| pinyinPlacement === "above"\}/u
  );
  assert.doesNotMatch(
    settingsSource,
    /pinyinPlacement === "above"[\s\S]{0,120}\$joinMandarinWords\.set\(false\)/u
  );
});

test("Jyutping disables the Pinyin-only placement control", () => {
  assert.match(
    settingsSource,
    /label="Pinyin Placement"[\s\S]*?disabled=\{chineseMode !== "pinyin"\}/u
  );
});
