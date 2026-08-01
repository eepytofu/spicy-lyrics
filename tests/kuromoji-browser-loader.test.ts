import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKuromojiBrowserTokenizer,
  KUROMOJI_DICTIONARY_ROOT,
  kuromojiDictionaryUrl,
} from "../src/utils/Lyrics/Analyzer/KuromojiBrowserLoader.ts";

test("Kuromoji dictionary paths resolve against the remote URL origin", () => {
  assert.equal(
    kuromojiDictionaryUrl("https:/kuromoji.pkgs.spikerko.org/base.dat.gz"),
    `${KUROMOJI_DICTIONARY_ROOT}base.dat.gz`
  );
  assert.equal(
    kuromojiDictionaryUrl("https:\\kuromoji.pkgs.spikerko.org\\unk_pos.dat.gz"),
    `${KUROMOJI_DICTIONARY_ROOT}unk_pos.dat.gz`
  );
  assert.throws(() => kuromojiDictionaryUrl("https:/example.test/not-a-dictionary.js"));
});

test("the actual browser loader opens every dictionary request on the dictionary origin", async () => {
  const requested: string[] = [];
  const originalXhr = globalThis.XMLHttpRequest;

  class FailingXhr {
    responseType = "";
    onload: (() => void) | null = null;
    onerror: ((error: Error) => void) | null = null;

    open(_method: string, url: string): void {
      requested.push(url);
    }

    send(): void {
      queueMicrotask(() => this.onerror?.(new Error("fixture stops after URL capture")));
    }
  }

  Object.assign(globalThis, { XMLHttpRequest: FailingXhr });
  try {
    await assert.rejects(buildKuromojiBrowserTokenizer(), /fixture stops after URL capture/u);
  } finally {
    Object.assign(globalThis, { XMLHttpRequest: originalXhr });
  }

  assert.equal(requested.length, 12);
  assert.ok(requested.every((url) => url.startsWith(KUROMOJI_DICTIONARY_ROOT)));
  assert.ok(requested.includes(`${KUROMOJI_DICTIONARY_ROOT}base.dat.gz`));
  assert.ok(requested.includes(`${KUROMOJI_DICTIONARY_ROOT}unk_invoke.dat.gz`));
  assert.ok(requested.every((url) => !url.startsWith("https:/kuromoji")));
});
