import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureLyricRevision, isLyricRevision } from "../src/utils/Lyrics/LyricRevision.ts";
import { isLyricsRevisionCacheCompatible } from "../src/utils/Lyrics/LyricsRevisionCache.ts";

function lineLyrics(text = " exact text ", startTime = 1) {
  return {
    Type: "Line",
    source: "qq",
    fetchProvider: "qq",
    Content: [
      {
        Type: "Vocal",
        Text: text,
        StartTime: startTime,
        EndTime: 2,
        ProviderTranslatedText: " exact translation ",
      },
    ],
  };
}

test("lyric revisions are deterministic for exact source evidence", async () => {
  const left = lineLyrics();
  const right = structuredClone(left);
  const leftRevision = await ensureLyricRevision("spotify:track:one", left, "qq:candidate");
  const rightRevision = await ensureLyricRevision("spotify:track:one", right, "qq:candidate");

  assert.equal(leftRevision.id, rightRevision.id);
  assert.equal(leftRevision.contentHash, rightRevision.contentHash);
  assert.equal(isLyricRevision(leftRevision), true);
});

test("revision identity changes with provider text, timing, candidate, or track", async () => {
  const base = await ensureLyricRevision("spotify:track:one", lineLyrics(), "qq:a");
  const whitespace = await ensureLyricRevision(
    "spotify:track:one",
    lineLyrics("exact text"),
    "qq:a"
  );
  const timing = await ensureLyricRevision(
    "spotify:track:one",
    lineLyrics(" exact text ", 1.25),
    "qq:a"
  );
  const candidate = await ensureLyricRevision("spotify:track:one", lineLyrics(), "qq:b");
  const track = await ensureLyricRevision("spotify:track:two", lineLyrics(), "qq:a");

  assert.notEqual(base.id, whitespace.id);
  assert.notEqual(base.id, timing.id);
  assert.notEqual(base.id, candidate.id);
  assert.notEqual(base.id, track.id);
});

test("derived mutations do not rewrite an established source revision", async () => {
  const lyrics = lineLyrics();
  const revision = await ensureLyricRevision("spotify:track:one", lyrics, "qq:a");
  lyrics.Content[0].Text = "display projection";
  (lyrics.Content[0] as any).TranslatedText = "google translation";

  assert.equal((await ensureLyricRevision("spotify:track:one", lyrics, "qq:a")).id, revision.id);
  assert.equal(isLyricsRevisionCacheCompatible(lyrics, revision.id), true);
  assert.equal(isLyricsRevisionCacheCompatible(lyrics, "another revision"), false);
});
