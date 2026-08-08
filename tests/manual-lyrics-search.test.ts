import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeLyricsSearchOverrides,
  manualLyricsSearchProviders,
  normalizeLyricsSearchOverrides,
} from "../src/utils/Lyrics/ManualLyricsSearch.ts";

test("manual lyric search excludes track-id-only sources and preserves enabled order", () => {
  assert.deepEqual(
    manualLyricsSearchProviders([
      "spicy",
      "amlldb",
      "apple",
      "musixmatch",
      "qq",
      "custom:test",
      "spotify",
      "lrclib",
      "kugou",
      "netease",
      "soda",
    ]),
    ["amlldb", "musixmatch", "qq", "custom:test", "lrclib", "kugou", "netease", "soda"],
  );
});

test("manual lyric search trims metadata without rewriting its contents", () => {
  assert.deepEqual(
    normalizeLyricsSearchOverrides({
      title: "  我道行真  ",
      artist: "  三无MarBlue  ",
    }),
    { title: "我道行真", artist: "三无MarBlue" },
  );
  assert.deepEqual(normalizeLyricsSearchOverrides({ title: "   ", artist: "" }), {});
  assert.deepEqual(
    completeLyricsSearchOverrides({ title: "  忘却の翼　", artist: " 霜月はるか " }),
    { title: "忘却の翼", artist: "霜月はるか" },
  );
  assert.equal(completeLyricsSearchOverrides({ title: "忘却の翼" }), null);
});
