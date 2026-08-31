import assert from "node:assert/strict";
import { test } from "node:test";
import { SPICY_API_CACHE_VERSION } from "../src/utils/API/SpicyRequestContract.ts";
import { isLyricsSourceCacheCompatible } from "../src/utils/Lyrics/LyricsSourceCache.ts";

test("provider-owned ldb cache entries still honor the source signature", () => {
  const lyrics = {
    source: "ldb",
    fetchProvider: "spicy",
    SpicyApiCacheVersion: SPICY_API_CACHE_VERSION,
    LyricsSourceCacheSignature: "old-order",
    TranslationSidecarSchemaVersion: 3,
  };

  assert.equal(isLyricsSourceCacheCompatible(lyrics, "new-order", 3), false);
  assert.equal(isLyricsSourceCacheCompatible(lyrics, "old-order", 3), true);
});

test("current local ldb entries use the translation schema", () => {
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

test("payloads without current cache ownership are refreshed", () => {
  assert.equal(isLyricsSourceCacheCompatible({ source: "spl" }, "current", 3), false);
  assert.equal(isLyricsSourceCacheCompatible({ source: "aml" }, "current", 3), false);
  assert.equal(isLyricsSourceCacheCompatible({ source: "unknown" }, "current", 3), false);
});

test("only Spicy API-owned entries require the current API cache contract", () => {
  const base = { LyricsSourceCacheSignature: "current" };
  assert.equal(isLyricsSourceCacheCompatible({
    ...base,
    source: "qq",
    fetchProvider: "spicy",
  }, "current", 3), false);
  assert.equal(isLyricsSourceCacheCompatible({
    ...base,
    source: "qq",
    fetchProvider: "spicy",
    SpicyApiCacheVersion: SPICY_API_CACHE_VERSION,
  }, "current", 3), true);
  assert.equal(isLyricsSourceCacheCompatible({
    ...base,
    source: "qq",
    fetchProvider: "qq",
  }, "current", 3), true);
});
