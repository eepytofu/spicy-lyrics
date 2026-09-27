import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  isAffectedSpicetifyVersion,
  isAffectedSpotifyVersion,
} from "../src/utils/scrollFixVersions.ts";

test("scroll-fix guard covers only the broken Spicetify and Spotify combination", () => {
  assert.equal(isAffectedSpotifyVersion("1.3.1.234"), true);
  assert.equal(isAffectedSpotifyVersion("1.4.0.100"), true);
  assert.equal(isAffectedSpotifyVersion("1.2.56.100"), false);
  assert.equal(isAffectedSpotifyVersion("1.2.57.100"), false);
  assert.equal(isAffectedSpotifyVersion(undefined), false);

  assert.equal(isAffectedSpicetifyVersion("2.45.1"), true);
  assert.equal(isAffectedSpicetifyVersion("2.45.2"), false);
  assert.equal(isAffectedSpicetifyVersion("2.46.0"), false);
  assert.equal(isAffectedSpicetifyVersion("development"), false);
});

test("hot-path selectors and class writes stay scoped", async () => {
  const [dynamicCss, defaultCss, defaultScss, npvCss, app, npv, simplebar] =
    await Promise.all([
      readFile("src/css/DynamicBG/spicy-dynamic-bg.css", "utf8"),
      readFile("src/css/default.css", "utf8"),
      readFile("src/css/default.scss", "utf8"),
      readFile("src/css/NPVLyrics.css", "utf8"),
      readFile("src/app.tsx", "utf8"),
      readFile("src/components/Utils/NPVLyrics.ts", "utf8"),
      readFile("src/utils/Scrolling/Simplebar/ScrollSimplebar.ts", "utf8"),
    ]);

  assert.doesNotMatch(dynamicCss, /aside:has\(\.spicy-dynamic-bg\) > div/);
  assert.doesNotMatch(defaultScss, /body:has\(aside\.spicy-dynamic-bg-in-this\)/);
  assert.doesNotMatch(defaultScss, /> :has\(\.playback-progressbar\)/);
  assert.doesNotMatch(
    defaultCss,
    /\.Root__right-sidebar:has\(\.spicy-dynamic-bg\):has\([^\n]+\)\s+\.main-nowPlayingView-section > div/,
  );
  assert.doesNotMatch(
    npvCss,
    /\.Root__right-sidebar:has\(#SpicyLyricsNPVCard\.Expanded\)\s+:is\([^\n]+\)\s+> :not/,
  );
  assert.match(app, /SpicyLyrics_NPVDynamicBackground/);
  assert.match(npv, /SpicyLyrics_NPVCardExpanded/);
  assert.match(simplebar, /classList\.contains\("hide-scrollbar"\) !== hide/);
});
