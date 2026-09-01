import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const exposeSource = readFileSync(new URL("../src/utils/expose.ts", import.meta.url), "utf8");

test("the frozen testing API exposes bounded breaker inspect and reset controls", () => {
  assert.match(exposeSource, /queryBreaker:\s*\{\s*inspect:\s*inspectQueryBreaker/u);
  assert.match(exposeSource, /reset:\s*\(\) => \{\s*BreakerDebug\.reset\(\);\s*return inspectQueryBreaker\(\);/u);
  assert.match(exposeSource, /open:\s*state\.open === true/u);
  assert.match(exposeSource, /retryAfterMs:\s*Math\.max\(0, Number\(state\.retryAfterMs\) \|\| 0\)/u);
  assert.doesNotMatch(exposeSource, /endpoint|accessToken|authorization/i);
});
