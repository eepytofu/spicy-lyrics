import assert from "node:assert/strict";
import { test } from "node:test";

test("expired blob URL entries are fetched again instead of returned once more", async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalNow = Date.now;
  let now = 1_000;
  let fetchCalls = 0;
  let objectUrlCalls = 0;

  try {
    Date.now = () => now;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return {
        ok: true,
        blob: async () => new Blob([String(fetchCalls)]),
      } as Response;
    }) as typeof fetch;
    URL.createObjectURL = () => `blob:test-${++objectUrlCalls}`;

    const url = new URL("../src/utils/BlobURLMaker.ts", import.meta.url);
    url.searchParams.set("test", String(now));
    const { default: BlobURLMaker } = await import(url.href);

    assert.equal(await BlobURLMaker("https://example.test/image"), "blob:test-1");
    now += 60_000;
    assert.equal(await BlobURLMaker("https://example.test/image"), "blob:test-1");
    now += 60 * 60 * 1000;
    assert.equal(await BlobURLMaker("https://example.test/image"), "blob:test-2");
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    Date.now = originalNow;
  }
});
