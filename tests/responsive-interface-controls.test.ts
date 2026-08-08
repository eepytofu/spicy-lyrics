import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const contentBoxCss = readFileSync(
  new URL("../src/css/ContentBox.css", import.meta.url),
  "utf8"
).replace(/\r\n/gu, "\n");

function ruleBody(selector: string): string {
  const selectorStart = contentBoxCss.indexOf(selector);
  assert.notEqual(selectorStart, -1, `missing CSS selector: ${selector}`);
  const bodyStart = contentBoxCss.indexOf("{", selectorStart);
  const bodyEnd = contentBoxCss.indexOf("}", bodyStart);
  assert.notEqual(bodyStart, -1, `missing CSS body: ${selector}`);
  assert.notEqual(bodyEnd, -1, `unterminated CSS body: ${selector}`);
  return contentBoxCss.slice(bodyStart + 1, bodyEnd);
}

test("glass controls retain material depth and WebKit blur support", () => {
  const timeline = ruleBody("#SpicyLyricsPage.Exp_NewProgressBar .Timeline .SliderBar");
  assert.match(timeline, /-webkit-backdrop-filter:\s*var\(--material-regular-blur\)/u);
  assert.match(timeline, /0 6px 18px -8px rgba\(8, 10, 18, 0\.35\)/u);
  assert.match(timeline, /inset 0 -1px 0 rgba\(255, 255, 255, 0\.18\)/u);

  const volume = ruleBody(
    "#SpicyLyricsPage.Fullscreen.ShowVolumeSlider.Exp_NewProgressBar .VolumeControl"
  );
  assert.match(volume, /-webkit-backdrop-filter:\s*var\(--material-regular-blur\)/u);
  assert.match(volume, /0 10px 24px -8px rgba\(8, 10, 18, 0\.42\)/u);
  assert.match(volume, /inset 0 -1px 0 rgba\(255, 255, 255, 0\.18\)/u);
});

test("header timeline uses the smaller hoisted-control geometry", () => {
  const resting = ruleBody("#SpicyLyricsPage.Exp_NewProgressBar .Header > .Timeline .SliderBar");
  assert.match(resting, /height:\s*1\.7cqh/u);

  const engaged = ruleBody(
    "#SpicyLyricsPage.Exp_NewProgressBar .Header > .Timeline .SliderBar:is(:hover, .Dragging)"
  );
  assert.match(engaged, /height:\s*2\.3cqh/u);
});

test("legacy volume slider keeps a forgiving hit area and direct drag response", () => {
  const hitArea = ruleBody("#SpicyLyricsPage:not(.Exp_NewProgressBar) .VolumeControl::after");
  assert.match(hitArea, /inset:\s*0 -2\.5cqw/u);

  const handle = ruleBody("#SpicyLyricsPage:not(.Exp_NewProgressBar) .VolumeControl .Handle");
  assert.match(handle, /transition:\s*transform 0\.18s cubic-bezier\(0\.23, 1, 0\.32, 1\)/u);

  const draggingHandle = ruleBody(
    "#SpicyLyricsPage:not(.Exp_NewProgressBar) .VolumeControl.Dragging .Handle"
  );
  assert.match(draggingHandle, /transition:\s*none/u);
});

test("compact and PiP volume controls remain usable at small artwork sizes", () => {
  assert.match(
    contentBoxCss,
    /\.spicy-pip-wrapper #SpicyLyricsPage\.Fullscreen\.ShowVolumeSlider \.VolumeControl,[\s\S]*?right:\s*4cqw;/u
  );
  assert.match(
    contentBoxCss,
    /\.spicy-pip-wrapper #SpicyLyricsPage\.Fullscreen\.ShowVolumeSlider\.Exp_NewProgressBar \.VolumeControl,[\s\S]*?--CapsuleWidth:\s*6\.5cqw;/u
  );
  assert.match(
    contentBoxCss,
    /\.spicy-pip-wrapper\s+#SpicyLyricsPage\.Fullscreen\.ShowVolumeSlider:not\(\.Exp_NewProgressBar\)\s+\.VolumeControl,[\s\S]*?--CapsuleWidth:\s*2\.2cqw;/u
  );
  assert.match(
    contentBoxCss,
    /\.spicy-pip-wrapper[\s\S]*?#SpicyLyricsPage\.Fullscreen\.ShowVolumeSlider\.Exp_NewProgressBar[\s\S]*?\.VolumeControl:is\(:hover, \.Dragging\),[\s\S]*?--CapsuleWidth:\s*8cqw;/u
  );
  assert.match(
    contentBoxCss,
    /\.spicy-pip-wrapper #SpicyLyricsPage \.VolumeControl \.VolumeIcon svg,[\s\S]*?height:\s*3\.4cqh;/u
  );
});
