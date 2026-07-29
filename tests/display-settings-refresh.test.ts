import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("romanization visibility queues a cached display refresh without fetching first", () => {
  const source = readSource("../src/components/Pages/PageView.ts");
  assert.match(
    source,
    /romanizationToggle\.addEventListener\("click", \(\) => \{\s*setRomanizedStatus\(!isRomanized\);\s*queueDisplaySettingsRefresh\(\);\s*\}\);/u,
  );
});

test("display refresh accepts only current-track cached lyrics and current revisions", () => {
  const source = readSource("../src/components/Pages/PageView.ts");
  assert.match(source, /cachedLyrics\?\.uri === uri/u);
  assert.match(source, /targetRevision !== displaySettingsRevision/u);
  assert.match(source, /SpotifyPlayer\.GetUri\(\) !== uri/u);
  assert.match(source, /if \(!lyrics\) \{\s*lyrics = await fetchLyrics\(uri\);\s*\}/u);
});

test("a failed display refresh is logged without retrying the same revision forever", () => {
  const source = readSource("../src/components/Pages/PageView.ts");
  assert.match(
    source,
    /try \{\s*await rerenderCurrentLyrics\(targetRevision\);\s*\} catch \(error\) \{\s*pageLogger\.warn\("Failed to refresh lyrics after a display setting changed", error\);\s*\}\s*appliedDisplaySettingsRevision = targetRevision;/u,
  );
});

test("structural display settings share the cached refresh queue", () => {
  const source = readSource("../src/components/Pages/PageView.ts");
  for (const setting of [
    "$simpleLyricsMode",
    "$minimalLyricsMode",
    "$fixHanGlyphVariants",
    "$providerTranslationsEnabled",
    "$japaneseReadingMode",
  ]) {
    const start = source.indexOf(`${setting}.listen`);
    assert.notEqual(start, -1, `${setting} listener should exist`);
    const block = source.slice(start, source.indexOf("});", start) + 3);
    assert.match(block, /queueDisplaySettingsRefresh\(\)/u, `${setting} should queue a display refresh`);
    assert.doesNotMatch(block, /\$currentLyricsData\.set/u, `${setting} should preserve current lyrics`);
    assert.doesNotMatch(block, /fetchLyrics/u, `${setting} should not fetch directly`);
  }
});

test("Simple Mode animation changes rebuild the current presentation", () => {
  const pageSource = readSource("../src/components/Pages/PageView.ts");
  assert.match(
    pageSource,
    /\$simpleLyricsModeRenderingType\.listen\(\(\) => \{\s*if \(!PageContainer \|\| !\$simpleLyricsMode\.get\(\)\) return;\s*queueDisplaySettingsRefresh\(\);/u,
  );
});
