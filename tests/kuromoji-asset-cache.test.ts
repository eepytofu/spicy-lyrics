import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDictionaryAssetLoader,
  dictionaryAssetName,
  dictionaryAssetUrl,
  dictionaryCacheKey,
  KUROMOJI_ASSET_VERSION,
  type DictionaryAssetStore,
} from "../src/utils/Lyrics/Analyzer/KuromojiAssetCache.ts";

function memoryStore(seed: Record<string, Uint8Array> = {}) {
  const entries = new Map<string, Uint8Array>(Object.entries(seed));
  const writes: string[] = [];
  const store: DictionaryAssetStore = {
    read: async (key) => entries.get(key),
    write: async (key, bytes) => {
      writes.push(key);
      entries.set(key, bytes);
    },
  };
  return { store, entries, writes };
}

function respondWith(bytes: Uint8Array, count = { calls: 0 }) {
  const fetchImpl = (async (url: string | URL | Request) => {
    count.calls += 1;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      url: String(url),
      arrayBuffer: async () => bytes.slice().buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, count };
}

test("a validated filename is reduced from whatever path Kuromoji asked for", () => {
  assert.equal(dictionaryAssetName("https:/kuromoji.example/base.dat.gz"), "base.dat.gz");
  assert.equal(dictionaryAssetName("https:\\kuromoji.example\\unk_pos.dat.gz"), "unk_pos.dat.gz");
  assert.equal(dictionaryAssetName("cc.dat.gz"), "cc.dat.gz");
  assert.throws(() => dictionaryAssetName("https:/example.test/not-a-dictionary.js"));
  assert.throws(() => dictionaryAssetName(""));
});

test("assets resolve against the pinned immutable npm mirror", () => {
  assert.equal(
    dictionaryAssetUrl("https:/anything/base.dat.gz"),
    "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/base.dat.gz"
  );
});

test("cache keys carry the asset version so a bump orphans stale entries", () => {
  assert.equal(dictionaryCacheKey("base.dat.gz"), `${KUROMOJI_ASSET_VERSION}/base.dat.gz`);
  assert.ok(KUROMOJI_ASSET_VERSION.includes("ipadic-2.7.0-20070801"));
});

test("a cached file is served without touching the network", async () => {
  const cached = new Uint8Array([1, 2, 3]);
  const { store, writes } = memoryStore({ [dictionaryCacheKey("base.dat.gz")]: cached });
  const { fetchImpl, count } = respondWith(new Uint8Array([9, 9]));

  const load = createDictionaryAssetLoader({ store, fetchImpl });
  assert.deepEqual(await load("base.dat.gz"), cached);
  assert.equal(count.calls, 0);
  assert.deepEqual(writes, []);
});

test("a miss fetches once and writes through under the versioned key", async () => {
  const { store, entries, writes } = memoryStore();
  const bytes = new Uint8Array([4, 5, 6]);
  const { fetchImpl, count } = respondWith(bytes);

  const load = createDictionaryAssetLoader({ store, fetchImpl });
  assert.deepEqual(await load("cc.dat.gz"), bytes);
  assert.equal(count.calls, 1);
  assert.deepEqual(writes, [`${KUROMOJI_ASSET_VERSION}/cc.dat.gz`]);
  assert.deepEqual(entries.get(`${KUROMOJI_ASSET_VERSION}/cc.dat.gz`), bytes);
});

test("entries written under an older asset version are not served", async () => {
  const { store } = memoryStore({ "kuromoji-0.0.1-old/base.dat.gz": new Uint8Array([7]) });
  const fresh = new Uint8Array([8]);
  const { fetchImpl, count } = respondWith(fresh);

  const load = createDictionaryAssetLoader({ store, fetchImpl });
  assert.deepEqual(await load("base.dat.gz"), fresh);
  assert.equal(count.calls, 1);
});

test("concurrent loads of one file share a single download", async () => {
  const { store } = memoryStore();
  const bytes = new Uint8Array([1]);
  const { fetchImpl, count } = respondWith(bytes);

  const load = createDictionaryAssetLoader({ store, fetchImpl });
  const [a, b, c] = await Promise.all([
    load("tid.dat.gz"),
    load("tid.dat.gz"),
    load("tid.dat.gz"),
  ]);

  assert.equal(count.calls, 1);
  assert.deepEqual(a, bytes);
  assert.deepEqual(b, bytes);
  assert.deepEqual(c, bytes);
});

test("a failed cache write still returns the bytes", async () => {
  const bytes = new Uint8Array([2, 4]);
  const { fetchImpl } = respondWith(bytes);
  const store: DictionaryAssetStore = {
    read: async () => undefined,
    write: async () => {
      throw new Error("quota exceeded");
    },
  };

  const load = createDictionaryAssetLoader({ store, fetchImpl });
  assert.deepEqual(await load("unk.dat.gz"), bytes);
});

test("a failed cache read falls through to the network", async () => {
  const bytes = new Uint8Array([3, 1]);
  const { fetchImpl, count } = respondWith(bytes);
  const store: DictionaryAssetStore = {
    read: async () => {
      throw new Error("store unavailable");
    },
    write: async () => {},
  };

  const load = createDictionaryAssetLoader({ store, fetchImpl });
  assert.deepEqual(await load("check.dat.gz"), bytes);
  assert.equal(count.calls, 1);
});

test("a non-ok response is reported rather than cached", async () => {
  const { store, writes } = memoryStore();
  const fetchImpl = (async () =>
    ({ ok: false, status: 404, statusText: "Not Found" }) as unknown as Response) as typeof fetch;

  const load = createDictionaryAssetLoader({ store, fetchImpl });
  await assert.rejects(load("base.dat.gz"), /404 Not Found/u);
  assert.deepEqual(writes, []);
});

test("an empty response is rejected rather than cached as a valid dictionary", async () => {
  const { store, writes } = memoryStore();
  const { fetchImpl } = respondWith(new Uint8Array([]));

  const load = createDictionaryAssetLoader({ store, fetchImpl });
  await assert.rejects(load("base.dat.gz"), /empty response/u);
  assert.deepEqual(writes, []);
});

test("a rejected filename never reaches the store or the network", async () => {
  const { store, writes } = memoryStore();
  const { fetchImpl, count } = respondWith(new Uint8Array([1]));

  const load = createDictionaryAssetLoader({ store, fetchImpl });
  await assert.rejects(load("evil.js"), /Unexpected Kuromoji dictionary filename/u);
  assert.equal(count.calls, 0);
  assert.deepEqual(writes, []);
});
