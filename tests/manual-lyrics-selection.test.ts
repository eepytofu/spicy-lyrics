import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  clearManualLyricsSelection,
  getManualLyricsSelection,
  ManualLyricsSelectionStore,
  rememberManualLyricsSelection,
} from "../src/utils/Lyrics/ManualLyricsSelection.ts";

function installCacheMock() {
  const entries = new Map<string, Response>();
  const originalCaches = globalThis.caches;
  globalThis.caches = {
    open: async () => ({
      match: async (url: string) => entries.get(url)?.clone(),
      put: async (url: string, response: Response) => {
        entries.set(url, response.clone());
      },
      delete: async (url: string) => entries.delete(url),
    }),
    delete: async () => {
      entries.clear();
      return true;
    },
    has: async () => entries.size > 0,
    keys: async () => [],
    match: async () => undefined,
  } as CacheStorage;
  return () => {
    globalThis.caches = originalCaches;
  };
}

test("manual lyric selection persists by Spotify track and clears explicitly", async () => {
  const restoreCaches = installCacheMock();
  const selection = {
    trackUri: "spotify:track:sticky",
    revisionId: "revision:selected",
    automaticRevisionId: "revision:auto",
  };
  try {
    await rememberManualLyricsSelection(selection);
    assert.deepEqual(await getManualLyricsSelection(selection.trackUri), selection);
    assert.equal(await getManualLyricsSelection("spotify:track:other"), null);
    await clearManualLyricsSelection(selection.trackUri);
    assert.equal(await getManualLyricsSelection(selection.trackUri), null);
  } finally {
    restoreCaches();
  }
});

test("manual lyric selection preserves normalized search provenance", async () => {
  const restoreCaches = installCacheMock();
  try {
    await rememberManualLyricsSelection({
      trackUri: "spotify:track:override",
      revisionId: "revision:selected",
      automaticRevisionId: "revision:auto",
      searchOverrides: {
        title: "  忘却の翼　",
        artist: " 霜月はるか ",
      },
    });
    assert.deepEqual(await getManualLyricsSelection("spotify:track:override"), {
      trackUri: "spotify:track:override",
      revisionId: "revision:selected",
      automaticRevisionId: "revision:auto",
      searchOverrides: {
        title: "忘却の翼",
        artist: "霜月はるか",
      },
    });
  } finally {
    restoreCaches();
  }
});

test("manual lyric selection ignores unsupported and mismatched track identities", async () => {
  const restoreCaches = installCacheMock();
  try {
    await rememberManualLyricsSelection({
      trackUri: "spotify:local:artist:title",
      revisionId: "revision:local",
      automaticRevisionId: null,
    });
    assert.equal(await getManualLyricsSelection("spotify:local:artist:title"), null);
    await ManualLyricsSelectionStore.SetItem("sticky", {
      trackUri: "spotify:track:other",
      revisionId: "revision:other",
      automaticRevisionId: "revision:auto",
    });
    assert.equal(await getManualLyricsSelection("spotify:track:sticky"), null);
    await ManualLyricsSelectionStore.SetItem("fallback", {
      trackUri: "spotify:track:fallback",
      revisionId: "revision:fallback",
      automaticRevisionId: "revision:auto",
      searchOverrides: { title: 42, artist: [] },
    } as never);
    assert.deepEqual(await getManualLyricsSelection("spotify:track:fallback"), {
      trackUri: "spotify:track:fallback",
      revisionId: "revision:fallback",
      automaticRevisionId: "revision:auto",
    });
  } finally {
    restoreCaches();
  }
});

test("fetch pipeline migrates the manual revision before local and automatic acquisition", () => {
  const source = readFileSync(
    new URL("../src/utils/Lyrics/fetchLyrics.ts", import.meta.url),
    "utf8",
  );
  const preferences = readFileSync(
    new URL("../src/utils/Lyrics/LyricsOverridePreference.ts", import.meta.url),
    "utf8",
  );
  const restoreIndex = source.indexOf("const override = await restoreLyricsOverrideForSession(");
  const automaticIndex = source.indexOf('if (uri.startsWith("spotify:local:"))', restoreIndex);
  const manualIndex = preferences.indexOf("getManualLyricsSelection(trackUri)");
  const localIndex = preferences.indexOf("LocalLyricsManager.getRaw(trackUri)", manualIndex);

  assert.ok(restoreIndex >= 0 && automaticIndex > restoreIndex);
  assert.ok(manualIndex >= 0 && localIndex > manualIndex);
  assert.match(preferences, /snapshot: structuredClone\(cached\)/);
  assert.match(preferences, /await clearManualLyricsSelection\(trackUri\)/);
  assert.match(source, /preference\.snapshot = structuredClone\(result\[0\]/);
  assert.match(source, /setLyricsOverridePreference\(automaticLyricsOverride\(uri\)\)/);
});
