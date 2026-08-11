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
).replace(/\r\n/gu, "\n");
const mixedCss = readFileSync(
  new URL("../src/css/Lyrics/Mixed.css", import.meta.url),
  "utf8",
);
const animatorSource = readFileSync(
  new URL("../src/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts", import.meta.url),
  "utf8",
);
const lineApplyerSource = readFileSync(
  new URL("../src/utils/Lyrics/Applyer/Synced/Line.ts", import.meta.url),
  "utf8",
);
const syllableApplyerSource = readFileSync(
  new URL("../src/utils/Lyrics/Applyer/Synced/Syllable.ts", import.meta.url),
  "utf8",
);

test("pending Above Pinyin reserves ruby geometry without a visible skeleton", () => {
  assert.doesNotMatch(
    mainCss,
    /\.above-reading-pending \.above-reading-plain-cluster::before/u,
  );
});

test("Above-reading emphasis keeps ruby runs on the shared two-row grid", () => {
  assert.match(
    mixedCss,
    /\.letter\.furigana-cluster,[\s\S]*?\.letter\.furigana-plain-cluster\s*\{[\s\S]*?display:\s*inline-grid/u,
  );
});

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

test("timed romanization preserves end-glyph ink without changing layout advance", () => {
  const syllable = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .romanized-below .romanized-syllable",
  );
  assert.match(syllable, /padding-inline-end:\s*0\.125em/u);
  assert.match(syllable, /margin-inline-end:\s*-0\.125em/u);
});

test("clipped furigana-row words and whole-line sidecars protect block-end ink without changing flow", () => {
  const furiganaWord = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .word.has-furigana",
  );
  assert.match(furiganaWord, /--lyric-clip-block-end-guard:\s*0\.125em/u);
  assert.match(
    furiganaWord,
    /padding-block-end:\s*var\(--lyric-clip-block-end-guard\)/u,
  );
  assert.match(
    furiganaWord,
    /margin-block-end:\s*calc\(var\(--lyric-clip-block-end-guard\)\s*\*\s*-1\)/u,
  );

  assert.match(
    mainCss,
    /\.translated-below:not\(\.translation-placeholder\)\s*\{[\s\S]*?--lyric-clip-block-end-guard:\s*0\.125em;[\s\S]*?padding-block-end:\s*var\(--lyric-clip-block-end-guard\);[\s\S]*?margin-block-end:\s*calc\(var\(--lyric-clip-block-end-guard\)\s*\*\s*-1\);/u,
  );
});

test("every derived row follows the line's unfocused blur once", () => {
  const line = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .line",
  );
  const lineWithSidecars = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .line.HasExtras",
  );
  assert.match(
    line,
    /--DerivedTextBlurAmount:\s*clamp\(\s*0px,\s*calc\(var\(--BlurAmount,\s*0px\)\s*\*\s*0\.46\),\s*3\.25px\s*\)/u,
  );
  assert.doesNotMatch(lineWithSidecars, /--DerivedTextBlurAmount/u);
  assert.match(lineWithSidecars, /display:\s*block/u);
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

  assert.match(
    ruleBody("#SpicyLyricsPage .LyricsContainer .LyricsContent .furigana-reading"),
    /--FuriganaBlurAmount:\s*var\(--DerivedTextBlurAmount,\s*0px\);[\s\S]*?filter:\s*blur\(var\(--FuriganaBlurAmount\)\)/u,
  );
  assert.match(
    ruleBody("#SpicyLyricsPage .LyricsContainer .LyricsContent .romanized-below"),
    /--RomanizedSidecarBlurAmount:\s*var\(--DerivedTextBlurAmount,\s*0px\);[\s\S]*?filter:\s*blur\(var\(--RomanizedSidecarBlurAmount\)\)/u,
  );
  assert.match(
    ruleBody("#SpicyLyricsPage .LyricsContainer .LyricsContent .translated-below"),
    /--TranslatedSidecarBlurAmount:\s*var\(--DerivedTextBlurAmount,\s*0px\);[\s\S]*?filter:\s*blur\(var\(--TranslatedSidecarBlurAmount\)\)/u,
  );

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
    /\.line\.Active\s+\.furigana-reading\s*\{[\s\S]*?--FuriganaTextShadowBlurRadius:\s*clamp\([\s\S]*?var\(--text-shadow-blur-radius,\s*4px\)\s*\*\s*0\.5[\s\S]*?--FuriganaTextShadowOpacity:\s*clamp\([\s\S]*?var\(--text-shadow-opacity,\s*0%\)\s*\*\s*0\.55[\s\S]*?28%/u,
  );
  assert.match(
    mainCss,
    /\.line\.Active\s+:is\(\.romanized-below,\s*\.romanized-syllable\)\s*\{[\s\S]*?--RomanizedTextShadowBlurRadius:\s*clamp\([\s\S]*?var\(--text-shadow-blur-radius,\s*4px\)\s*\*\s*0\.5[\s\S]*?--RomanizedTextShadowOpacity:\s*clamp\([\s\S]*?var\(--text-shadow-opacity,\s*0%\)\s*\*\s*0\.55[\s\S]*?28%/u,
  );
  assert.doesNotMatch(mainCss, /:is\(\.furigana-reading,\s*\.romanized-below/u);
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
    /setStyleIfChanged\(\s*word\.RomajiElement,\s*"--extra-gradient-position"/u,
  );
  assert.match(
    animatorSource,
    /line\.HasExtraSidecars[\s\S]*?"--extra-gradient-position"/u,
  );
  assert.doesNotMatch(
    animatorSource,
    /(?:RomajiElement|line\.HTMLElement)\.style\.setProperty\(\s*"--extra-gradient-position"/u,
  );
  assert.match(lineApplyerSource, /HasExtraSidecars:\s*hasExtraSidecars/u);
  assert.match(
    syllableApplyerSource,
    /\.HasExtraSidecars\s*=\s*appendSyllableRomanizedBelow/u,
  );
  assert.match(mainCss, /var\(--extra-gradient-position, -40%\)/u);
  assert.match(
    mainCss,
    /\.romanized-syllable\s*\{[\s\S]*?--RomanizedGradientDegrees:\s*90deg;[\s\S]*?--RomanizedGradientAlpha:[\s\S]*?--RomanizedGradientAlphaEnd:/u,
  );
  assert.match(
    mainCss,
    /\.romanized-syllable\.reading-origin-provider-explicit\s*\{[\s\S]*?--RomanizedGradientColor:\s*255,\s*207,\s*128;[\s\S]*?--RomanizedGradientAlphaEnd:\s*0\.4/u,
  );
});

test("Latin reading sidecars stay LTR inside RTL source lines", () => {
  const romanized = ruleBody(
    "#SpicyLyricsPage .LyricsContainer .LyricsContent .romanized-below",
  );
  assert.match(romanized, /direction:\s*ltr/u);
  assert.match(romanized, /unicode-bidi:\s*isolate/u);
  assert.match(
    mainCss,
    /\.romanized-syllable\s*\{[\s\S]*?--RomanizedGradientDegrees:\s*90deg/u,
  );
  assert.match(
    mainCss,
    /\.line\.rtl\s*>\s*\.romanized-below\s*\{[\s\S]*?text-align:\s*right;[\s\S]*?margin-top:\s*calc\(0\.15em\s*\+\s*var\(--bottom,\s*0px\)\s*\*\s*2\)/u,
  );
  assert.match(
    mainCss,
    /\.line\.rtl[\s\S]*?>\s*\.romanized-below\.reading-plan-row\s*\{[\s\S]*?justify-content:\s*flex-end/u,
  );
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

test("line furigana follows Active line paint without delaying glow", () => {
  assert.match(
    mainCss,
    /\.SpicyLyricsScrollContainer\[data-lyrics-type="Line"\]\s+\.furigana-reading\s*\{[\s\S]*?--FuriganaBlurAmount:\s*var\(--DerivedTextBlurAmount,\s*0px\);/u,
  );
  const lineFurigana = ruleBody(
    '.SpicyLyricsScrollContainer[data-lyrics-type="Line"]\n  .furigana-reading',
  );
  assert.doesNotMatch(lineFurigana, /transition:\s*all/u);
  assert.doesNotMatch(lineFurigana, /transition\s*:/u);
  assert.doesNotMatch(lineFurigana, /transition:[^}]*(?:color|text-shadow)/u);
  assert.doesNotMatch(lineFurigana, /font-size|line-height|transform|scale/u);
  const notSungLineFurigana = ruleBody(
    '.line.NotSung\n  .furigana-reading',
  );
  assert.match(notSungLineFurigana, /color:\s*var\(--furigana-fill-dim\)/u);
  assert.match(
    notSungLineFurigana,
    /-webkit-text-fill-color:\s*var\(--furigana-fill-dim\)/u,
  );
  assert.match(
    mainCss,
    /#SpicyLyricsPage:not\(\.SimpleLyricsMode\)\s+\.SpicyLyricsScrollContainer\[data-lyrics-type="Line"\]\s+\.line\.NotSung\s+\.furigana-reading/u,
  );
  assert.match(
    mainCss,
    /\.SpicyLyricsScrollContainer\[data-lyrics-type="Line"\]\s+\.line\.Active\s+\.furigana-reading\s*\{[\s\S]*?--FuriganaTextShadowBlurRadius:\s*var\(--text-shadow-blur-radius,\s*4px\);[\s\S]*?--FuriganaTextShadowOpacity:\s*var\(--text-shadow-opacity,\s*0%\)/u,
  );
  assert.doesNotMatch(
    mainCss,
    /\.SpicyLyricsScrollContainer\[data-lyrics-type="Line"\][^{}]*\.line\.Sung[^{}]*\.furigana-reading\s*\{/u,
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
  assert.doesNotMatch(mainCss, /--line-furigana-fill-progress/u);
  assert.doesNotMatch(
    animatorSource,
    /lineFuriganaFillProgress|--line-furigana-fill-progress/u,
  );
  assert.doesNotMatch(mainCss, /--line-furigana-brightness/u);
  assert.doesNotMatch(animatorSource, /--line-furigana-brightness/u);
  assert.match(
    animatorSource,
    /animationTimelineJumped\([\s\S]*?SetGoal\(targetGlow,\s*timelineJumped\)/u,
  );
});
