import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  missingRequiredObjectStores,
  nextCompatibleDatabaseVersion,
  SPICY_LYRICS_MINIMUM_DATABASE_VERSION,
} from "../src/utils/DatabaseSchema.ts";

function objectStoreNames(names: string[]) {
  const available = new Set(names);
  return { contains: (name: string) => available.has(name) };
}

test("newer databases keep unknown stores when all local stores exist", () => {
  const missing = missingRequiredObjectStores(
    objectStoreNames([
      "lyricsStore",
      "japaneseAssets",
      "lyricsOverrides",
      "aiRefinements",
      "communityReferences",
    ]),
    ["lyricsStore", "japaneseAssets", "lyricsOverrides"],
  );

  assert.deepEqual(missing, []);
  assert.equal(nextCompatibleDatabaseVersion(5), 6);
});

test("missing local stores upgrade from the existing version without downgrading", () => {
  const missing = missingRequiredObjectStores(
    objectStoreNames(["lyricsStore", "aiRefinements"]),
    ["lyricsStore", "japaneseAssets", "lyricsOverrides"],
  );

  assert.deepEqual(missing, ["japaneseAssets", "lyricsOverrides"]);
  assert.equal(nextCompatibleDatabaseVersion(1), SPICY_LYRICS_MINIMUM_DATABASE_VERSION);
  assert.equal(nextCompatibleDatabaseVersion(5), 6);
});

test("database wiring discovers the existing version before requesting an upgrade", () => {
  const source = readFileSync(
    new URL("../src/utils/db.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const existing = await openDB\(DATABASE_NAME\)/u);
  assert.match(source, /if \(missing\.length === 0\) return existing/u);
  assert.match(source, /existing\.close\(\)/u);
  assert.match(source, /openDB\(DATABASE_NAME, nextVersion/u);
  assert.doesNotMatch(source, /openDB\("spicylyrics", 3/u);
});
