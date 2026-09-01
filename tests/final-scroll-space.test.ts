import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const lyricsCss = readFileSync(new URL("../src/css/Lyrics/main.css", import.meta.url), "utf8");
const virtualizerSource = readFileSync(
  new URL("../src/utils/Lyrics/LyricsVirtualizer.ts", import.meta.url),
  "utf8",
);

test("the virtualizer owns centering space and CSS keeps only a residual tail", () => {
  assert.match(virtualizerSource, /spacer\.style\.height = `\$\{scrollEl\.clientHeight \/ 2\}px`/u);
  assert.match(lyricsCss, /\.SpicyLyricsScrollContainer\s*\{[^}]*margin-bottom:\s*6cqh;/u);
  assert.doesNotMatch(lyricsCss, /margin-bottom:\s*45cqh/u);
});
