import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRetryableLazyInitializer } from "../src/utils/Lyrics/Analyzer/LazyInitializer.ts";

const kuromojiSource = readFileSync(
  new URL("../src/utils/Lyrics/KuromojiAnalyzer.ts", import.meta.url),
  "utf8"
);
const processLyricsSource = readFileSync(
  new URL("../src/utils/Lyrics/ProcessLyrics.ts", import.meta.url),
  "utf8"
);

test("lazy initialization does no work before first use and deduplicates callers", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lazy = createRetryableLazyInitializer(async () => {
    calls += 1;
    await gate;
  });

  assert.equal(calls, 0);
  assert.equal(lazy.isInitialized(), false);

  const first = lazy.ensure();
  const second = lazy.ensure();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);

  release();
  await Promise.all([first, second]);
  assert.equal(lazy.isInitialized(), true);
  assert.equal(calls, 1);
});

test("failed lazy initialization can be retried", async () => {
  let attempts = 0;
  const lazy = createRetryableLazyInitializer(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("network unavailable");
  });

  await assert.rejects(lazy.ensure(), /network unavailable/u);
  assert.equal(lazy.isInitialized(), false);
  await lazy.ensure();
  assert.equal(lazy.isInitialized(), true);
  assert.equal(attempts, 2);
});

test("Japanese analyzer loading is deferred to nonempty browser parsing", () => {
  assert.match(kuromojiSource, /buildKuromojiBrowserTokenizer/u);
  assert.doesNotMatch(kuromojiSource, /kuromoji\/build\/kuromoji\.js/u);
  assert.doesNotMatch(kuromojiSource, /RetrievePackage|https:\/\/pkgs\.spikerko\.org/u);
  assert.match(processLyricsSource, /from "greek-transliteration"/u);
  assert.doesNotMatch(processLyricsSource, /RetrievePackage|pkgs\.spikerko\.org/u);
  assert.match(kuromojiSource, /if \(text\.trim\(\) === ""\) return \[\];/u);
  assert.match(kuromojiSource, /if \(typeof window === "undefined"\) return \[\];/u);
  assert.match(kuromojiSource, /await init\(\);/u);
  assert.doesNotMatch(processLyricsSource, /new Kuroshiro\(\)\.init/u);
  assert.doesNotMatch(processLyricsSource, /RomajiPromise/u);
});
