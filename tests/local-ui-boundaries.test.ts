import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const modalSource = readFileSync(new URL("../src/components/Modal.ts", import.meta.url), "utf8");
const uploadSource = readFileSync(
  new URL(
    "../src/components/ReactComponents/LyricsManager/components/UploadTTMLModal.tsx",
    import.meta.url
  ),
  "utf8"
);
const appSource = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
const containerSource = readFileSync(
  new URL("../src/utils/Lyrics/Applyer/CreateLyricsContainer.ts", import.meta.url),
  "utf8"
);
const npvSource = readFileSync(
  new URL("../src/components/Utils/NPVLyrics.ts", import.meta.url),
  "utf8"
);
const npvCss = readFileSync(new URL("../src/css/NPVLyrics.css", import.meta.url), "utf8");
const nowBarSource = readFileSync(new URL("../src/components/Utils/NowBar.ts", import.meta.url), "utf8");
const fullscreenSource = readFileSync(new URL("../src/components/Utils/Fullscreen.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/utils/settings.ts", import.meta.url), "utf8");

test("NPV animation work is excluded from sidebar background observation", () => {
  assert.match(appSource, /attributeFilter: \["src", "class", "inert"\]/u);
  assert.doesNotMatch(appSource, /attributeFilter: \[[^\]]*"style"/u);
});

test("lyrics container resize work is coalesced and cancelled on removal", () => {
  assert.match(containerSource, /if \(resizeFrame !== null\) return/u);
  assert.match(containerSource, /cancelAnimationFrame\(resizeFrame\)/u);
});

test("expanded NPV reconciliation waits for stable card geometry", () => {
  assert.match(npvSource, /holdEvaluateUntilSettled\(morph\)/u);
  assert.match(npvSource, /if \(stateAnimation !== null\) return/u);
  assert.match(npvCss, /#SpicyLyricsNPVCard \.CardBody \{[^}]*flex-shrink: 0;/su);
});

test("final interface controls keep drag visibility and external volume sync", () => {
  assert.match(nowBarSource, /SetControlsDragLock\(true\)/u);
  assert.match(nowBarSource, /Global\.Event\.listen\("playback:volume"/u);
  assert.match(nowBarSource, /Spicetify\.Player\.toggleMute\(\)/u);
  assert.match(nowBarSource, /event\.deltaY < 0 \? 0\.05 : -0\.05/u);
  assert.match(fullscreenSource, /if \(controlsDragLock\) return/u);
});

test("experiments navigate inside the current modal frame", () => {
  assert.match(settingsSource, /PopupModal\.transition\(\{/u);
  assert.match(settingsSource, /title: "Experiments"/u);
  assert.match(settingsSource, /onClose: \(\) => root\.unmount\(\)/u);
});

test("the generic modal accepts DOM nodes instead of executable markup strings", () => {
  assert.match(modalSource, /content: Node;/u);
  assert.match(modalSource, /main\.replaceChildren\(content\)/u);
  assert.doesNotMatch(modalSource, /main\.innerHTML = content/u);
});

test("the TTML upload UI discloses the remote parsing boundary", () => {
  assert.match(uploadSource, /TTML is parsed by the Spicy Lyrics service/u);
  assert.match(uploadSource, /their contents are sent for parsing when loaded/u);
});
