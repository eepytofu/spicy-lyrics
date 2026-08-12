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
const mixedCss = readFileSync(
  new URL("../src/css/Lyrics/Mixed.css", import.meta.url),
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

test("Above lines without a stacked sidecar balance the shared line padding", () => {
  const rule =
    /\.line:has\(\.has-above-reading\):not\(:has\(> \.romanized-below\)\):not\(:has\(> \.translated-below\)\) \{[\s\S]*?\}/u;
  assert.match(lyricsCss, rule);
  const [balanced] = lyricsCss.match(rule)!;
  // Matching the leading padding keeps the line box symmetric, which is what
  // lets the hover plate stay centred without its own offset.
  assert.match(balanced, /padding-bottom: 0\.08em;/u);
  assert.match(lyricsCss, /\.line\.furigana-pending \{[\s\S]*?padding-top: 0\.08em;/u);
});

test("Above lines that stack a sidecar keep the full trailing padding", () => {
  // `.romanized-below` and `.translated-below` live inside the line and carry
  // only a margin-top, so the shared trailing padding is their sole trailing
  // space. Narrowing the reset by hand would silently clip them.
  assert.doesNotMatch(
    lyricsCss,
    /\.line:has\(\.has-above-reading\)\s*\{[\s\S]*?padding-bottom:/u,
  );
});

test("The line hover plate needs no Above-specific offset", () => {
  assert.doesNotMatch(mixedCss, /:has\(\.has-above-reading\)[^{]*::before/u);
});
