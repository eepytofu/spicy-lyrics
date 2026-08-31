import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSpicyForcedUpdateControl,
  normalizeSpicyApiDocument,
} from "../src/utils/Lyrics/SpicyLyricsResponse.ts";

const staticLyrics = (source?: string) => ({
  Type: "Static",
  Lines: [{ Text: "ordinary lyric" }],
  ...(source === undefined ? {} : { source }),
});

test("Spicy and Apple source identities retain their established provider lanes", () => {
  const spicy = normalizeSpicyApiDocument(staticLyrics("spl"))!;
  const apple = normalizeSpicyApiDocument(staticLyrics("aml"))!;
  const missing = normalizeSpicyApiDocument(staticLyrics())!;

  assert.equal(spicy.fetchProvider, "spicy");
  assert.equal(spicy.lyrics.source, "spl");
  assert.equal(spicy.sourceDisplayName, "Spicy Lyrics");
  assert.equal(apple.fetchProvider, "apple");
  assert.equal(apple.lyrics.source, "aml");
  assert.equal(apple.sourceDisplayName, "Apple Music");
  assert.equal(missing.fetchProvider, "spicy");
  assert.equal(missing.lyrics.source, "spl");
});

test("unknown backend source identity stays exact and distinct from direct Worker providers", () => {
  const normalized = normalizeSpicyApiDocument(staticLyrics("qq"))!;

  assert.equal(normalized.fetchProvider, "spicy");
  assert.equal(normalized.lyrics.source, "qq");
  assert.equal(normalized.sourceDisplayName, "Spicy Lyrics (qq)");
});

test("backend source display normalization cannot mutate exact source provenance", () => {
  const source = "  chinese\u0000source  ";
  const normalized = normalizeSpicyApiDocument(staticLyrics(source))!;

  assert.equal(normalized.lyrics.source, source);
  assert.equal(normalized.sourceDisplayName, "Spicy Lyrics (chinese source)");
});

test("forced-update control response is rejected without rejecting ordinary Static lyrics", () => {
  const control = {
    Type: "Static",
    Lines: [
      { Text: "Please update Spicy Lyrics" },
      { Text: "You can do so immediately by restarting Spotify" },
    ],
    source: "spl",
  };

  assert.equal(isSpicyForcedUpdateControl(control), true);
  assert.equal(normalizeSpicyApiDocument(control), null);
  assert.equal(isSpicyForcedUpdateControl({
    ...control,
    Lines: [{ Text: "Please update Spicy Lyrics" }],
  }), false);
  assert.ok(normalizeSpicyApiDocument(staticLyrics("unknown")));
});
