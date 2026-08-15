import assert from "node:assert/strict";
import { test } from "node:test";
import { buildKuromojiBrowserTokenizer } from "../src/utils/Lyrics/Analyzer/KuromojiBrowserLoader.ts";

class RecordingXhr {
  responseType = "";
  onload: (() => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  status = 0;
  response: unknown = null;

  open(_method: string, _url: string): void {
    throw new Error("a dictionary request must never reach the real transport");
  }

  send(): void {
    throw new Error("a dictionary request must never reach the real transport");
  }
}

function withFakeXhr<T>(run: () => Promise<T>): Promise<T> {
  const originalXhr = globalThis.XMLHttpRequest;
  Object.assign(globalThis, { XMLHttpRequest: RecordingXhr });
  return run().finally(() => {
    Object.assign(globalThis, { XMLHttpRequest: originalXhr });
  });
}

test("every dictionary file is resolved through the asset loader, never the transport", async () => {
  const requested: string[] = [];

  await withFakeXhr(async () => {
    await assert.rejects(
      buildKuromojiBrowserTokenizer(async (filename) => {
        requested.push(filename);
        throw new Error("fixture stops after filename capture");
      }),
      /fixture stops after filename capture/u
    );
  });

  assert.equal(requested.length, 12);
  assert.ok(requested.includes("base.dat.gz"));
  assert.ok(requested.includes("unk_invoke.dat.gz"));
  assert.ok(requested.every((filename) => /^[a-z_]+\.dat\.gz$/u.test(filename)));
  assert.ok(requested.every((filename) => !filename.includes("/")));
});

test("the transport patch is removed once the build settles", async () => {
  await withFakeXhr(async () => {
    const prototype = RecordingXhr.prototype as any;
    const open = prototype.open;
    const send = prototype.send;

    await assert.rejects(
      buildKuromojiBrowserTokenizer(async () => {
        throw new Error("stop");
      })
    );

    assert.equal(prototype.open, open);
    assert.equal(prototype.send, send);
  });
});

test("non-dictionary requests are forwarded to the original transport", async () => {
  await withFakeXhr(async () => {
    const forwarded: string[] = [];
    const prototype = RecordingXhr.prototype as any;
    prototype.open = function (_method: string, url: string) {
      forwarded.push(url);
    };
    prototype.send = function () {};

    const pending = assert.rejects(
      buildKuromojiBrowserTokenizer(async () => {
        throw new Error("stop");
      })
    );

    const unrelated = new (globalThis as any).XMLHttpRequest();
    unrelated.open("GET", "https://example.test/not-a-dictionary.js");
    unrelated.send();

    await pending;
    assert.deepEqual(forwarded, ["https://example.test/not-a-dictionary.js"]);
  });
});
