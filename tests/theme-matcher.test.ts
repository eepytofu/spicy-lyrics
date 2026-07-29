import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesTextDarkTheme } from "../src/utils/themeMatcher.ts";

test("theme matcher recognizes every supported marketplace fingerprint", () => {
  assert.equal(
    matchesTextDarkTheme(
      `*:not([style*="lyric" i] *, [class*="lyric" i], .main-entityHeader-title)`,
    ),
    true,
  );
  assert.equal(
    matchesTextDarkTheme(`---------------
PLAYBACK BAR
---------------
*/
/* playback progress bar moves smoothly */
.x-progressBar-fillColor`),
    true,
  );
  assert.equal(
    matchesTextDarkTheme(
      "/* check out a cool project: https://github.com/Rigellute/spotify-tui",
    ),
    true,
  );
  assert.equal(matchesTextDarkTheme(".unrelated-theme { color: red; }"), false);
  assert.equal(matchesTextDarkTheme(null), false);
});
