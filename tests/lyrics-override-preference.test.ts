import assert from "node:assert/strict";
import { test } from "node:test";
import {
  automaticLyricsOverride,
  candidateLyricsOverride,
  localLyricsOverride,
  lyricsMatchOverridePreference,
  LyricsOverridePreferenceController,
  markLyricsOverridePreference,
  type LyricsOverridePreference,
  type LyricsOverrideStorage,
} from "../src/utils/Lyrics/LyricsOverridePreference.ts";

const uri = "spotify:track:override-fixture";

function memoryStorage() {
  const values = new Map<string, LyricsOverridePreference>();
  const storage: LyricsOverrideStorage = {
    async get(key) {
      return values.get(key);
    },
    async put(key, preference) {
      values.set(key, structuredClone(preference));
    },
    async remove(key) {
      values.delete(key);
    },
    async removeCandidates() {
      const removed: string[] = [];
      for (const [key, preference] of values) {
        if (preference.kind !== "candidate") continue;
        removed.push(key);
        values.delete(key);
      }
      return removed;
    },
  };
  return { storage, values };
}

test("latest persistent override action wins durable storage", async () => {
  const { storage, values } = memoryStorage();
  const controller = new LyricsOverridePreferenceController(storage);
  const local = localLyricsOverride(uri, "persistent", "<tt>raw</tt>");
  const automatic = automaticLyricsOverride(uri);

  await Promise.all([controller.set(local), controller.set(automatic)]);

  assert.equal((await controller.get(uri))?.kind, "automatic");
  assert.equal(values.get(uri)?.kind, "automatic");
});

test("temporary override shadows durable state only for the session", async () => {
  const { storage } = memoryStorage();
  const controller = new LyricsOverridePreferenceController(storage);
  const automatic = automaticLyricsOverride(uri);
  await controller.set(automatic);
  controller.setSession(localLyricsOverride(uri, "temporary", "session raw"));

  assert.equal((await controller.get(uri))?.kind, "local");
  controller.clearSession();
  const restored = await controller.get(uri);
  assert.equal(restored?.kind, "automatic");
  assert.equal(restored?.preferenceId, automatic.preferenceId);
});

test("temporary candidate returns to automatic when a new session has no saved override", async () => {
  const { storage, values } = memoryStorage();
  const currentSession = new LyricsOverridePreferenceController(storage);
  currentSession.setSession(
    candidateLyricsOverride(uri, "temporary", {
      revisionId: "temporary-revision",
      automaticRevisionId: "automatic-revision",
      snapshot: { uri, Type: "Line" },
    })
  );

  assert.equal((await currentSession.get(uri))?.kind, "candidate");
  assert.equal(values.has(uri), false);

  const nextSession = new LyricsOverridePreferenceController(storage);
  assert.equal(await nextSession.get(uri), null);
});

test("resetting candidates removes durable and session choices without touching local or automatic overrides", async () => {
  const localUri = "spotify:track:local-fixture";
  const automaticUri = "spotify:track:automatic-fixture";
  const { storage, values } = memoryStorage();
  const controller = new LyricsOverridePreferenceController(storage);
  await controller.set(
    candidateLyricsOverride(uri, "persistent", {
      revisionId: "saved-candidate",
      automaticRevisionId: "automatic-revision",
      snapshot: { uri, Type: "Line" },
    })
  );
  await controller.set(localLyricsOverride(localUri, "persistent", "local raw"));
  const automatic = automaticLyricsOverride(automaticUri);
  await controller.set(automatic);
  controller.setSession(
    candidateLyricsOverride(automaticUri, "temporary", {
      revisionId: "session-candidate",
      automaticRevisionId: "automatic-revision",
      snapshot: { uri: automaticUri, Type: "Syllable" },
    })
  );

  assert.deepEqual(new Set(await controller.resetCandidates()), new Set([uri, automaticUri]));
  assert.equal(values.has(uri), false);
  assert.equal((await controller.get(uri))?.kind, undefined);
  assert.equal((await controller.get(localUri))?.kind, "local");
  assert.equal((await controller.get(automaticUri))?.preferenceId, automatic.preferenceId);
});

test("persistent local preference keeps its raw source outside the preference row", async () => {
  const { storage, values } = memoryStorage();
  const controller = new LyricsOverridePreferenceController(storage);
  const preference = localLyricsOverride(uri, "persistent", "raw source");
  await controller.set(preference);

  assert.equal(((await controller.get(uri)) as any).rawSource, "raw source");
  assert.equal((values.get(uri) as any).rawSource, undefined);
});

test("candidate preference retains a durable revision snapshot", async () => {
  const { storage } = memoryStorage();
  const controller = new LyricsOverridePreferenceController(storage);
  const preference = candidateLyricsOverride(uri, "persistent", {
    revisionId: "revision",
    automaticRevisionId: "automatic",
    snapshot: { uri, LyricRevision: { id: "revision" }, Type: "Line" },
  });
  await controller.set(preference);
  controller.clearSession();

  const restored = await controller.get(uri);
  assert.equal(restored?.kind, "candidate");
  assert.deepEqual((restored as any).snapshot, preference.snapshot);
});

test("missing durable preferences are read once per session", async () => {
  let reads = 0;
  const { storage } = memoryStorage();
  const controller = new LyricsOverridePreferenceController({
    ...storage,
    async get(key) {
      reads += 1;
      return storage.get(key);
    },
  });

  assert.equal(await controller.get(uri), null);
  assert.equal(await controller.get(uri), null);
  assert.equal(reads, 1);

  controller.clearSession();
  assert.equal(await controller.get(uri), null);
  assert.equal(reads, 2);
});

test("cached lyrics must match the exact active override action", () => {
  const automatic = automaticLyricsOverride(uri);
  const local = localLyricsOverride(uri, "temporary", "raw");
  const lyrics: Record<string, unknown> = { source: "spotify" };

  assert.equal(lyricsMatchOverridePreference(lyrics, null), true);
  markLyricsOverridePreference(lyrics, automatic);
  assert.equal(lyricsMatchOverridePreference(lyrics, automatic), true);
  assert.equal(lyricsMatchOverridePreference(lyrics, local), false);

  markLyricsOverridePreference(lyrics, local);
  assert.equal(lyricsMatchOverridePreference(lyrics, local), true);
  markLyricsOverridePreference(lyrics, null);
  assert.equal(lyricsMatchOverridePreference(lyrics, null), true);
  assert.equal(lyricsMatchOverridePreference({ source: "ldb" }, null), false);
  assert.equal(lyricsMatchOverridePreference({ ManualLyricsSelection: true }, null), false);
});
