import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("notice entries do not hide operation zero", () => {
  const source = readFileSync(
    new URL("../src/utils/API/Query.ts", import.meta.url),
    "utf8",
  );
  const indexingLoop = source.match(
    /for \(const job of data\.queries\) \{[\s\S]*?^    \}/mu,
  )?.[0];
  assert.ok(indexingLoop, "Query result-indexing loop was not found");

  const indexResults = new Function(
    "data",
    "results",
    "queryLogger",
    "summarizeQueryResult",
    `${indexingLoop}\nreturn results;`,
  ) as (
    data: { queries: unknown[] },
    results: Map<string | undefined, unknown>,
    queryLogger: { debug: (...values: unknown[]) => void },
    summarizeQueryResult: (value: unknown) => unknown,
  ) => Map<string | undefined, unknown>;
  const results = indexResults(
    {
      queries: [
        {
          type: "notice",
          message: "maintenance notice",
        },
        {
          operationId: "0",
          result: {
            data: { lyrics: "payload" },
            httpStatus: 200,
            format: "json",
          },
        },
      ],
    },
    new Map(),
    { debug: () => {} },
    (value) => value,
  );

  assert.deepEqual(results.get("0"), {
    data: { lyrics: "payload" },
    httpStatus: 200,
    format: "json",
  });
  assert.equal(results.has(undefined), true);
});
