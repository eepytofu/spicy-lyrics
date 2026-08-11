import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const settingsSource = readFileSync(
  new URL("../src/components/ReactComponents/SettingsPanel/LanguagesSection.tsx", import.meta.url),
  "utf8"
);
const lyricsCss = readFileSync(
  new URL("../src/css/Lyrics/main.css", import.meta.url),
  "utf8",
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

test("Above readings share furigana geometry with a bounded optical lift", () => {
  assert.match(
    lyricsCss,
    /\.furigana-cluster,[\s\S]*?\.furigana-plain-cluster[\s\S]*?grid-template-rows: calc\(var\(--furigana-rt-size\) \+ var\(--furigana-rt-gap\)\) 1em;/u,
  );
  assert.match(
    lyricsCss,
    /\.above-reading-text \{[\s\S]*?margin-block-end: 0\.06em;[\s\S]*?padding-inline: 0\.1em;/u,
  );
});
