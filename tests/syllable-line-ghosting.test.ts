import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mixedCss = readFileSync(new URL("../src/css/Lyrics/Mixed.css", import.meta.url), "utf8");
const mainCss = readFileSync(new URL("../src/css/Lyrics/main.css", import.meta.url), "utf8");

const syllableActiveLineRule =
  /\.SpicyLyricsScrollContainer\[data-lyrics-type="Syllable"\]\s*\.line\.Active\s*\{\s*background-image:\s*none;\s*\}/u;

test("active Syllable lines do not repaint their words through the line gradient", () => {
  assert.match(mixedCss, syllableActiveLineRule);
});

test("the Syllable override follows the shared active gradient so it wins the cascade", () => {
  const sharedGradient = mixedCss.indexOf(
    "#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line.Active,"
  );
  const syllableOverride = mixedCss.search(syllableActiveLineRule);
  assert.ok(sharedGradient >= 0);
  assert.ok(syllableOverride > sharedGradient);
});

test("Line and Static lyrics keep the line-owned gradient", () => {
  assert.match(
    mixedCss,
    /\.line\.Active\s*\.letter,\s*#SpicyLyricsPage\.SpicyRenderer \.LyricsContainer \.LyricsContent \.line\.static\s*\{\s*background-image:\s*linear-gradient\(/u
  );
  assert.doesNotMatch(mixedCss, /\[data-lyrics-type="(?:Line|Static)"\]\s*\.line\.Active\s*\{\s*background-image:\s*none/u);
});

test("Syllable text outside animated words owns its paint", () => {
  // Readings, Pinyin Above, and timed ruby all carry furigana-reading.
  assert.match(
    mainCss,
    /\.furigana-reading\s*\{[^}]*background-image:\s*none\s*!important;[^}]*-webkit-text-fill-color:\s*var\(--furigana-fill-bright\);/u
  );
  for (const owner of ["VocalAgentLabel", "TtmlSongPartLabel"]) {
    assert.match(
      mainCss,
      new RegExp(`\\.line \\.${owner} \\{[^}]*-webkit-text-fill-color: currentColor;`, "u")
    );
  }
  assert.match(mainCss, /\.romanized-below \{[^}]*-webkit-text-fill-color: rgba\(/u);
  assert.match(mainCss, /\.translated-below \{[^}]*-webkit-text-fill-color: rgba\(/u);
});
