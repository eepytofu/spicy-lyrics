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
const mixedCss = readFileSync(
  new URL("../src/css/Lyrics/Mixed.css", import.meta.url),
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

test("full-line base text remains one flex wrapping item", () => {
  const baseFlow = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .lyric-base-flow",
  );
  assert.match(baseFlow, /display:\s*block/u);
  assert.match(baseFlow, /flex:\s*0\s+0\s+100%/u);
  assert.match(baseFlow, /min-width:\s*0/u);
  assert.match(baseFlow, /width:\s*100%/u);
});

test("plain syllable text reserves the same base row as real ruby", () => {
  const cluster = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .furigana-cluster",
  );

  assert.match(cluster, /display:\s*inline-grid/u);
  assert.match(
    cluster,
    /grid-template-rows:\s*calc\(var\(--furigana-rt-size\)\s*\+\s*var\(--furigana-rt-gap\)\)\s+1em/u,
  );
  assert.match(cluster, /vertical-align:\s*bottom/u);
  assert.match(
    mainCss,
    /\.furigana-plain-cluster\s*\{\s*justify-items:\s*start/u,
  );
  assert.doesNotMatch(
    mainCss,
    /\.word\.furigana-row-reserved\s*\{[^}]*padding-top/u,
  );

  const wrapGroup = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .lyric-wrap-group",
  );
  assert.match(wrapGroup, /display:\s*inline-grid/u);
  assert.match(wrapGroup, /grid-auto-flow:\s*column/u);
  assert.match(wrapGroup, /grid-auto-columns:\s*max-content/u);
});

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
    /--furigana-bright-alpha:\s*var\(--gradient-alpha,\s*0\.85\)/u,
  );
  assert.match(furigana, /--furigana-fill-bright:\s*rgba\(/u);
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

test("every derived row follows the line's unfocused blur once", () => {
  assert.match(
    mainCss,
    /--ExtraLineBlurAmount:\s*clamp\(\s*0px,\s*calc\(var\(--BlurAmount,\s*0px\)\s*\*\s*0\.46\),\s*3\.25px\s*\)/u,
  );
  assert.match(
    mixedCss,
    /\.line\.NotSung[\s\S]*?text-shadow:\s*0 0 var\(--BlurAmount,\s*0\)/u,
  );
  assert.match(
    mixedCss,
    /\.line\.Sung[\s\S]*?text-shadow:\s*0 0 var\(--BlurAmount,\s*0\)/u,
  );
  assert.match(
    mixedCss,
    /\.line\.Active\s*\{[\s\S]*?--BlurAmount:\s*0px\s*!important/u,
  );

  for (const selector of [
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .furigana-reading",
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .romanized-below",
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .translated-below",
  ]) {
    assert.match(
      ruleBody(selector),
      /filter:\s*blur\(var\(--ExtraLineBlurAmount,\s*0px\)\)/u,
    );
  }

  assert.doesNotMatch(
    ruleBody(
      "#SpicyLyricsPage .LyricsContainer .LyricsContent .romanized-below .romanized-syllable",
    ),
    /filter:\s*blur/u,
  );
});

test("synced furigana and romaji glow only with their active lyric owner", () => {
  assert.match(
    mainCss,
    /\.line\.Active[\s\S]*?:is\(\.furigana-reading,\s*\.romanized-below,\s*\.romanized-syllable\)\s*\{[\s\S]*?--derived-text-shadow-blur-radius:\s*clamp\([\s\S]*?var\(--text-shadow-blur-radius,\s*4px\)\s*\*\s*0\.5[\s\S]*?--derived-text-shadow-opacity:\s*clamp\([\s\S]*?var\(--text-shadow-opacity,\s*0%\)\s*\*\s*0\.55[\s\S]*?28%/u,
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

test("static and Simple Line sidecars use completed paint without a stale sweep", () => {
  assert.match(
    mainCss,
    /\.SpicyLyricsScrollContainer\[data-lyrics-type="Static"\]\s+\.romanized-below:not\(\.romanization-placeholder\)\s*\{[\s\S]*?color:\s*rgba\(255,\s*255,\s*255,\s*0\.85\);[\s\S]*?-webkit-text-fill-color:\s*rgba\(255,\s*255,\s*255,\s*0\.85\);/u,
  );
  assert.match(
    mainCss,
    /\.SpicyLyricsScrollContainer\[data-lyrics-type="Static"\]\s+\.translated-below:not\(\.translation-placeholder\)\s*\{[\s\S]*?color:\s*rgba\(255,\s*255,\s*255,\s*0\.78\);[\s\S]*?-webkit-text-fill-color:\s*rgba\(255,\s*255,\s*255,\s*0\.78\);/u,
  );

  assert.match(
    mainCss,
    /#SpicyLyricsPage\.SimpleLyricsMode\s+\.SpicyLyricsScrollContainer\[data-lyrics-type="Line"\]\s+\.romanized-below:not\(\.romanization-placeholder\)\s*\{[\s\S]*?background-image:\s*none;/u,
  );
  assert.match(
    mainCss,
    /#SpicyLyricsPage\.SimpleLyricsMode\s+\.SpicyLyricsScrollContainer\[data-lyrics-type="Line"\]\s+\.translated-below:not\(\.translation-placeholder\)\s*\{[\s\S]*?background-image:\s*none;/u,
  );
  assert.match(
    mainCss,
    /rgba\(255,\s*207,\s*128,\s*0\.9\)/u,
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

test("syllable furigana follows its timing owner without a masked rectangular glow", () => {
  assert.match(
    mainCss,
    /\.SpicyLyricsScrollContainer\[data-lyrics-type="Syllable"\]\s+\.furigana-reading\s*\{[\s\S]*?--furigana-local-gradient-position:\s*var\(\s*--timed-furigana-gradient-position/u,
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
    mainCss,
    /\.SpicyLyricsScrollContainer\[data-lyrics-type="Syllable"\]\s+\.furigana-reading::after\s*\{[\s\S]*?text-shadow:\s*none/u,
  );
  assert.match(
    mainCss,
    /--furigana-overlay-alpha:\s*calc\([\s\S]*?var\(--furigana-bright-alpha\)[\s\S]*?var\(--furigana-dim-alpha\)[\s\S]*?1 - var\(--furigana-dim-alpha\)/u,
  );
  assert.match(
    mainCss,
    /\.SpicyLyricsScrollContainer\[data-lyrics-type="Syllable"\]\s+\.furigana-reading::after\s*\{[\s\S]*?var\(--furigana-fill-overlay\)/u,
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

test("line furigana keeps direct fill separate from breathing glow", () => {
  assert.match(
    mainCss,
    /--furigana-fill-current:\s*rgba\([\s\S]*?--line-furigana-fill-progress,\s*0/u,
  );
  assert.match(
    mainCss,
    /\.SpicyLyricsScrollContainer\[data-lyrics-type="Line"\]\s+\.furigana-reading\s*\{[\s\S]*?var\(--furigana-fill-current\)/u,
  );
  assert.doesNotMatch(
    mainCss,
    /\.line:is\(\.Active,\s*\.Sung\)\s+\.furigana-reading/u,
  );
  assert.doesNotMatch(
    mainCss,
    /\.SpicyLyricsScrollContainer\[data-lyrics-type="Line"\]\s+\.furigana-reading::after/u,
  );
  assert.match(
    animatorSource,
    /setStyleIfChanged\(line\.HTMLElement,\s*"--text-shadow-opacity",\s*`\$\{currentGlow \* 50\}%`/u,
  );
  assert.match(
    animatorSource,
    /"--line-furigana-fill-progress"[\s\S]*?lineFuriganaFillProgress/u,
  );
  assert.doesNotMatch(mainCss, /--line-furigana-brightness/u);
  assert.doesNotMatch(animatorSource, /--line-furigana-brightness/u);
  assert.match(
    animatorSource,
    /animationTimelineJumped\([\s\S]*?SetGoal\(targetGlow,\s*timelineJumped\)/u,
  );
});
