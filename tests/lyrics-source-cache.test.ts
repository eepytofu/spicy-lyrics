import assert from "node:assert/strict";
import { test } from "node:test";
import { isLyricsSourceCacheCompatible } from "../src/utils/Lyrics/LyricsSourceCache.ts";

test("provider-owned ldb cache entries still honor the source signature", () => {
  const lyrics = {
    source: "ldb",
    fetchProvider: "spicy",
    LyricsSourceCacheSignature: "old-order",
    TranslationSidecarSchemaVersion: 3,
  };

  assert.equal(isLyricsSourceCacheCompatible(lyrics, "new-order", 3), false);
  assert.equal(isLyricsSourceCacheCompatible(lyrics, "old-order", 3), true);
});

test("legacy local ldb entries use the translation schema fallback", () => {
  assert.equal(
    isLyricsSourceCacheCompatible(
      { source: "ldb", TranslationSidecarSchemaVersion: 3 },
      "current",
      3
    ),
    true
  );
  assert.equal(
    isLyricsSourceCacheCompatible(
      { source: "ldb", TranslationSidecarSchemaVersion: 2 },
      "current",
      3
    ),
    false
  );
});

test("unsigned legacy provider payloads are refreshed", () => {
  assert.equal(isLyricsSourceCacheCompatible({ source: "spl" }, "current", 3), false);
  assert.equal(isLyricsSourceCacheCompatible({ source: "aml" }, "current", 3), false);
});
