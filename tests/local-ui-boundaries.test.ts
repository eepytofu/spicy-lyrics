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
const nowBarSource = readFileSync(
  new URL("../src/components/Utils/NowBar.ts", import.meta.url),
  "utf8"
);
const fullscreenSource = readFileSync(
  new URL("../src/components/Utils/Fullscreen.ts", import.meta.url),
  "utf8"
);
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

test("the local lyrics upload UI discloses accepted formats and local parsing", () => {
  assert.match(uploadSource, /description: "Lyrics files \(\.ttml, \.lrc\)"/u);
  assert.match(uploadSource, /accept: \{ "text\/plain": \["\.ttml", "\.lrc"\] \}/u);
  assert.match(uploadSource, /showOpenFilePicker/u);
  assert.match(uploadSource, /fileInputRef\.current\?\.click\(\)/u);
  assert.doesNotMatch(uploadSource, /accept="\.ttml,\.lrc"/u);
  assert.match(uploadSource, /\(\?:ttml\|lrc\)\$/u);
  assert.match(uploadSource, /TTML and LRC are parsed on your device/u);
  assert.match(uploadSource, /without\s+sending their contents anywhere/u);
  assert.doesNotMatch(uploadSource, /ParseTTML/u);
});

test("local lyrics actions use the unified override pipeline", () => {
  const managerSource = readFileSync(
    new URL("../src/components/ReactComponents/LyricsManager/index.tsx", import.meta.url),
    "utf8"
  );
  const rowSource = readFileSync(
    new URL(
      "../src/components/ReactComponents/LyricsManager/components/TrackRow.tsx",
      import.meta.url
    ),
    "utf8"
  );
  const databaseSource = readFileSync(
    new URL(
      "../src/components/ReactComponents/LyricsManager/hooks/useLyricsDB.ts",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    uploadSource,
    /openedTrack = useRef\([\s\S]*SpotifyPlayer\.GetUri\(\)[\s\S]*SpotifyPlayer\.GetName\(\)/u
  );
  assert.match(uploadSource, /useLocalLyricsOverride\(uri, rawSource, mode/u);
  assert.match(uploadSource, /toast\.dismiss\(progressToast\)/u);
  assert.match(uploadSource, /<h2 className="sl-ldb-upload-title">Upload Lyrics<\/h2>/u);
  assert.match(uploadSource, /mode === "persistent"/u);
  assert.match(uploadSource, /mode === "temporary"/u);
  assert.doesNotMatch(uploadSource, /ProcessLyrics|setTimeout/u);

  assert.match(managerSource, /label="Upload Lyrics"/u);
  assert.match(managerSource, /label="Return to Automatic"/u);
  assert.match(managerSource, /raw\.format === "ttml"/u);
  assert.match(managerSource, /new Blob\(\[raw\.content\]/u);
  assert.match(rowSource, /title="Download lyrics"/u);
  assert.doesNotMatch(managerSource, /Could not retrieve TTML|\.ttml`/u);
  assert.match(
    databaseSource,
    /preference\?\.kind === "local" && SpotifyPlayer\.GetUri\(\) === uri/u
  );
  assert.match(databaseSource, /setLyricsOverridePreference\(automaticLyricsOverride\(uri\)\)/u);
});

test("prefetch and foreground loading both use format-aware local raw sources", () => {
  const fetchSource = readFileSync(
    new URL("../src/utils/Lyrics/fetchLyrics.ts", import.meta.url),
    "utf8"
  );
  assert.equal(fetchSource.match(/LocalLyricsManager\.getRaw\(uri\)/gu)?.length, 2);
  assert.match(
    fetchSource,
    /export async function PrefetchLyrics[\s\S]*LocalLyricsManager\.getRaw\(uri\)/u
  );
});
