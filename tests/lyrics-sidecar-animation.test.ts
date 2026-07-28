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

test("timed romaji and line sidecars follow paint-only extra gradient state", () => {
  assert.match(
    animatorSource,
    /RomajiElement(?:\?\.|\.)style\.setProperty\(\s*"--extra-gradient-position"/u,
  );
  assert.match(animatorSource, /"--extra-gradient-position"/u);
  assert.match(mainCss, /var\(--extra-gradient-position, -40%\)/u);
});

test("the extra sweep is wider without changing base lyric or ruby constants", () => {
  assert.equal(ExtraGradientUnsungPosition, -40);
  assert.equal(ExtraGradientSungPosition, 100);
  assert.equal(extraGradientPositionAt(-1), -40);
  assert.equal(extraGradientPositionAt(0), -40);
  assert.equal(extraGradientPositionAt(0.5), 30);
  assert.equal(extraGradientPositionAt(1), 100);
  assert.equal(extraGradientPositionAt(2), 100);
  assert.match(
    mainCss,
    /--ruby-on: clamp\(0%, calc\(\(var\(--gradient-position, -20%\)/u,
  );
});
