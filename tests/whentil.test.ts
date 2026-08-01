import assert from "node:assert/strict";
import { test } from "node:test";
import Whentil from "../src/modules/Whentil.ts";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("When evaluates a successful statement once and passes that exact value", async () => {
  let checks = 0;
  const value = { ready: true };
  const received = await new Promise((resolve) => {
    Whentil.When(() => {
      checks += 1;
      return value;
    }, resolve, 1, { pollIntervalMs: 1, maxChecks: 3 });
  });

  assert.equal(checks, 1);
  assert.equal(received, value);
});

test("When stops after its bounded check budget and Cancel clears polling", async () => {
  let boundedChecks = 0;
  Whentil.When(() => {
    boundedChecks += 1;
    return false;
  }, () => {}, 1, { pollIntervalMs: 1, maxChecks: 3 });
  for (let attempt = 0; attempt < 50 && boundedChecks < 3; attempt += 1) await wait(10);
  assert.equal(boundedChecks, 3);

  let cancelledChecks = 0;
  const task = Whentil.When(() => {
    cancelledChecks += 1;
    return false;
  }, () => {}, 1, { pollIntervalMs: 1, maxChecks: 3 });
  task.Cancel();
  await wait(5);
  assert.equal(cancelledChecks, 0);
});
