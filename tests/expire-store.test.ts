import assert from "node:assert/strict";
import { test } from "node:test";
import { GetExpireStore } from "../src/modules/Store.ts";

type CacheEntry = {
  body: string;
};

function installCacheMock(initial: Record<string, CacheEntry>) {
  const entries = new Map(Object.entries(initial));
  const deleted: string[] = [];
  const originalCaches = globalThis.caches;

  globalThis.caches = {
    open: async () => ({
      match: async (url: string) => {
        const entry = entries.get(url);
        return entry
          ? new Response(entry.body, { headers: { "Content-Type": "application/json" } })
          : undefined;
      },
      delete: async (url: string) => {
        deleted.push(url);
        return entries.delete(url);
      },
      put: async () => {},
    }),
    delete: async () => true,
    has: async () => false,
    keys: async () => [],
    match: async () => undefined,
  } as CacheStorage;

  return {
    deleted,
    restore: () => {
      globalThis.caches = originalCaches;
    },
  };
}

test("expire store deletes an expired exact entry", async () => {
  const cache = installCacheMock({
    "/track": {
      body: JSON.stringify({
        CacheVersion: 1,
        ExpiresAt: Date.now() - 1,
        Content: { value: "old" },
      }),
    },
  });

  try {
    const store = GetExpireStore<{ value: string }>(
      `expire-test-${crypto.randomUUID()}`,
      1,
      { Duration: 1, Unit: "Days" },
    );
    assert.equal(await store.GetItem("track"), undefined);
    assert.deepEqual(cache.deleted, ["/track"]);
  } finally {
    cache.restore();
  }
});
test("expire store deletes version-mismatched and malformed entries", async () => {
  const cache = installCacheMock({
    "/old-version": {
      body: JSON.stringify({
        CacheVersion: 1,
        ExpiresAt: Date.now() + 60_000,
        Content: "old",
      }),
    },
    "/malformed": { body: "{not-json" },
  });

  try {
    const store = GetExpireStore<string>(
      `invalid-test-${crypto.randomUUID()}`,
      2,
      { Duration: 1, Unit: "Days" },
    );
    assert.equal(await store.GetItem("old-version"), undefined);
    assert.equal(await store.GetItem("malformed"), undefined);
    assert.deepEqual(cache.deleted, ["/old-version", "/malformed"]);
  } finally {
    cache.restore();
  }
});

test("expire store returns a current compatible entry without deleting it", async () => {
  const cache = installCacheMock({
    "/track": {
      body: JSON.stringify({
        CacheVersion: 3,
        ExpiresAt: Date.now() + 60_000,
        Content: { value: "current" },
      }),
    },
  });

  try {
    const store = GetExpireStore<{ value: string }>(
      `current-test-${crypto.randomUUID()}`,
      3,
      { Duration: 1, Unit: "Days" },
    );
    assert.deepEqual(await store.GetItem("track"), { value: "current" });
    assert.deepEqual(cache.deleted, []);
  } finally {
    cache.restore();
  }
});
