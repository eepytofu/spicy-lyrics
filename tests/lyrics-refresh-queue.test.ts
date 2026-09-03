import assert from "node:assert/strict";
import { test } from "node:test";
import { LyricsRefreshQueue } from "../src/utils/Lyrics/LyricsRefreshQueue.ts";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("refresh work stays serialized and pending requests merge into the latest revision", async () => {
  const firstRun = deferred();
  const drained = deferred();
  const runs: Array<{ revision: number; reprocessCurrent: boolean }> = [];
  let active = 0;
  let maxActive = 0;
  const queue = new LyricsRefreshQueue<{ reprocessCurrent: boolean }>({
    merge: (pending, next) => ({
      reprocessCurrent: pending.reprocessCurrent || next.reprocessCurrent,
    }),
    async run(revision, request) {
      active++;
      maxActive = Math.max(maxActive, active);
      runs.push({ revision, ...request });
      if (revision === 1) await firstRun.promise;
      active--;
    },
    onError(error) {
      assert.fail(error);
    },
    onIdle(revision) {
      if (revision === 3) drained.resolve();
    },
  });

  queue.enqueue({ reprocessCurrent: false });
  queue.enqueue({ reprocessCurrent: true });
  queue.enqueue({ reprocessCurrent: false });
  assert.equal(queue.isCurrent(1), false);
  assert.equal(queue.isCurrent(3), true);

  firstRun.resolve();
  await drained.promise;

  assert.equal(maxActive, 1);
  assert.deepEqual(runs, [
    { revision: 1, reprocessCurrent: false },
    { revision: 3, reprocessCurrent: true },
  ]);
  assert.equal(queue.isIdleAt(3), true);
});

test("a failed refresh advances the queue and later work still runs", async () => {
  const drained = deferred();
  const runs: number[] = [];
  const errors: Array<{ error: unknown; revision: number }> = [];
  const queue = new LyricsRefreshQueue<void>({
    merge: () => undefined,
    async run(revision) {
      runs.push(revision);
      if (revision === 1) throw new Error("first refresh failed");
    },
    onError(error, revision) {
      errors.push({ error, revision });
    },
    onIdle(revision) {
      if (revision === 1) queue.enqueue();
      if (revision === 2) drained.resolve();
    },
  });

  queue.enqueue();
  await drained.promise;

  assert.deepEqual(runs, [1, 2]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].revision, 1);
  assert.match(String(errors[0].error), /first refresh failed/u);
  assert.equal(queue.isIdleAt(2), true);
});
