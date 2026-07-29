import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ExtraGradientSungPosition,
  ExtraGradientUnsungPosition,
  extraGradientPositionAt,
} from "../src/utils/Lyrics/Animator/ExtraGradient.ts";

const mainCss = readFileSync(
  new URL("../src/css/Lyrics/main.css", import.meta.url),
  "utf8",
);
const animatorSource = readFileSync(
  new URL("../src/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts", import.meta.url),
  "utf8",
);

function ruleBody(selector: string): string {
  const selectorStart = mainCss.indexOf(selector);
  assert.notEqual(selectorStart, -1, `missing CSS selector: ${selector}`);
  const bodyStart = mainCss.indexOf("{", selectorStart);
  const bodyEnd = mainCss.indexOf("}", bodyStart);
  assert.notEqual(bodyStart, -1, `missing CSS body: ${selector}`);
  assert.notEqual(bodyEnd, -1, `unterminated CSS body: ${selector}`);
  return mainCss.slice(bodyStart + 1, bodyEnd);
}

test("lyric sidecars remain stable geometry rather than animated blocks", () => {
  for (const selector of [
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .romanized-below",
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .translated-below",
  ]) {
    const body = ruleBody(selector);
    assert.doesNotMatch(body, /(?:^|[;\s])scale\s*:/u);
    assert.doesNotMatch(body, /(?:^|[;\s])transform\s*:/u);
  }

  assert.doesNotMatch(
    animatorSource,
    /RomajiElement(?:\?\.|\.)style\.(?:scale|transform)/u,
  );
  assert.doesNotMatch(animatorSource, /TranslationElement/u);
});

test("derived lyric roles keep explicit weight and readable resting paint", () => {
  assert.doesNotMatch(
    mainCss,
    /LyricsContent:not\(:has\(\.LyricsNotice\)\)\s*\*\s*\{/u,
  );

  const furigana = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .furigana-reading",
  );
  assert.match(furigana, /font-weight:\s*700/u);
  assert.match(
    furigana,
    /rgba\(255,\s*255,\s*255,\s*var\(--gradient-alpha,\s*0\.85\)\)/u,
  );
  assert.match(furigana, /text-shadow:\s*none/u);

  for (const selector of [
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .romanized-below",
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .translated-below",
  ]) {
    const body = ruleBody(selector);
    assert.match(body, /font-weight:\s*700/u);
    assert.match(body, /text-shadow:\s*none/u);
  }

  const translation = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .translated-below",
  );
  assert.match(translation, /font-style:\s*normal/u);
});

test("synced furigana and romaji glow only with their active lyric owner", () => {
  assert.match(
    mainCss,
    /\.line\.Active[\s\S]*?:is\(\.furigana-reading,\s*\.romanized-below,\s*\.romanized-syllable\)\s*\{[\s\S]*?var\(--text-shadow-blur-radius,\s*4px\)[\s\S]*?var\(--text-shadow-opacity,\s*0%\)/u,
  );
  assert.match(
    animatorSource,
    /function applyWordGlowState[\s\S]*?word\.HTMLElement[\s\S]*?word\.RomajiElement[\s\S]*?"--text-shadow-blur-radius"[\s\S]*?"--text-shadow-opacity"/u,
  );
  assert.match(
    animatorSource,
    /applyWordGlowState\(word,\s*currentGlow\)/u,
  );
});

test("timed romaji and line sidecars follow paint-only extra gradient state", () => {
  assert.match(
    animatorSource,
    /RomajiElement(?:\?\.|\.)style\.setProperty\(\s*"--extra-gradient-position"/u,
  );
  assert.match(animatorSource, /"--extra-gradient-position"/u);
  assert.match(mainCss, /var\(--extra-gradient-position, -40%\)/u);
});

test("the extra sweep is wider without changing the base lyric range", () => {
  assert.equal(ExtraGradientUnsungPosition, -40);
  assert.equal(ExtraGradientSungPosition, 100);
  assert.equal(extraGradientPositionAt(-1), -40);
  assert.equal(extraGradientPositionAt(0), -40);
  assert.equal(extraGradientPositionAt(0.5), 30);
  assert.equal(extraGradientPositionAt(1), 100);
  assert.equal(extraGradientPositionAt(2), 100);
});

test("synced furigana follows its owning lyric through a non-background text mask", () => {
  assert.match(
    mainCss,
    /--furigana-local-gradient-position:\s*var\(\s*--timed-furigana-gradient-position/u,
  );
  assert.match(
    mainCss,
    /-webkit-mask-image:\s*linear-gradient/u,
  );
  assert.match(
    mainCss,
    /content:\s*attr\(data-furigana\)/u,
  );
  assert.match(
    animatorSource,
    /"--timed-furigana-gradient-position"/u,
  );
  const furigana = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .furigana-reading",
  );
  assert.match(furigana, /background:\s*none\s*!important/u);
  assert.doesNotMatch(
    mainCss,
    /\.furigana-reading\s*\{[^}]*background-clip:\s*text/u,
  );
  assert.match(
    ruleBody(
      "#SpicyLyricsPage .LyricsContainer .LyricsContent .timed-furigana-reading",
    ),
    /display:\s*inline-grid/u,
  );
});
