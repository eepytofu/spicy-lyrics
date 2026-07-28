import assert from "node:assert/strict";
import { test } from "node:test";
import { LyricsRequestCoordinator } from "../src/utils/Lyrics/LyricsRequestSession.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("same-uri callers share one foreground request", async () => {
  const coordinator = new LyricsRequestCoordinator<string>();
  const pending = deferred<string>();
  let calls = 0;

  const first = coordinator.run("spotify:track:first", async () => {
    calls += 1;
    return pending.promise;
  });
  const second = coordinator.run("spotify:track:first", async () => {
    calls += 1;
    return "unexpected";
  });

  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);

  pending.resolve("lyrics");
  assert.equal(await first, "lyrics");
  assert.equal(await second, "lyrics");
});

test("a different uri aborts and supersedes the prior session", async () => {
  const coordinator = new LyricsRequestCoordinator<string>();
  const firstPending = deferred<string>();
  let firstSessionCurrent = true;
  let firstSignalAborted = false;

  const first = coordinator.run("spotify:track:first", async (session) => {
    firstSessionCurrent = session.isCurrent();
    session.signal.addEventListener("abort", () => {
      firstSignalAborted = true;
    });
    return firstPending.promise;
  });
  await Promise.resolve();

  const second = coordinator.run("spotify:track:second", async (session) => {
    assert.equal(session.isCurrent(), true);
    return "second";
  });

  assert.equal(firstSessionCurrent, true);
  assert.equal(firstSignalAborted, true);
  assert.equal(await second, "second");

  firstPending.resolve("first");
  assert.equal(await first, "first");
});

test("explicit invalidation makes an unfinished session stale", async () => {
  const coordinator = new LyricsRequestCoordinator<void>();
  const pending = deferred<void>();
  let sessionCurrentAfterInvalidate = true;

  const request = coordinator.run("spotify:track:first", async (session) => {
    await pending.promise;
    sessionCurrentAfterInvalidate = session.isCurrent();
  });
  await Promise.resolve();

  coordinator.invalidate();
  pending.resolve();
  await request;

  assert.equal(sessionCurrentAfterInvalidate, false);
});

test("a completed session stays current for guarded background work", async () => {
  const coordinator = new LyricsRequestCoordinator<string>();
  let isCurrent: (() => boolean) | undefined;

  assert.equal(
    await coordinator.run("spotify:track:first", async (session) => {
      isCurrent = session.isCurrent;
      return "ready";
    }),
    "ready",
  );

  assert.equal(isCurrent?.(), true);
  coordinator.invalidate();
  assert.equal(isCurrent?.(), false);
});
