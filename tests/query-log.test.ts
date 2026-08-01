import assert from "node:assert/strict";
import { test } from "node:test";

import {
  redactQueryHeaders,
  summarizeQueries,
  summarizeQueryResponse,
  summarizeQueryResult,
} from "../src/utils/API/QueryLog.ts";

test("query logging redacts credentials and records only variable names", () => {
  assert.deepEqual(
    redactQueryHeaders({
      "SpicyLyrics-WebAuth": "Bearer secret-token",
      Authorization: "Bearer another-secret",
      Cookie: "session=value",
      "X-Request-Id": "request-123",
    }),
    {
      "SpicyLyrics-WebAuth": "[redacted]",
      Authorization: "[redacted]",
      Cookie: "[redacted]",
      "X-Request-Id": "request-123",
    },
  );

  assert.deepEqual(
    summarizeQueries([
      { operation: "lyrics", variables: { id: "track-id", auth: "header-name" } },
      { operation: "parseTTML", variables: { ttml: "<full private document />" } },
    ]),
    [
      { operation: "lyrics", variableKeys: ["auth", "id"] },
      { operation: "parseTTML", variableKeys: ["ttml"] },
    ],
  );
});

test("query response logging excludes returned lyric data", () => {
  const result = {
    httpStatus: 200,
    format: "json",
    data: { lyrics: "private response body" },
  };

  assert.deepEqual(summarizeQueryResult(result), {
    hasResult: true,
    httpStatus: 200,
    format: "json",
    hasData: true,
  });
  assert.deepEqual(
    summarizeQueryResponse({ queries: [{ operationId: "0", result }] }),
    {
      queryCount: 1,
      results: [{
        operationId: "0",
        hasResult: true,
        httpStatus: 200,
        format: "json",
        hasData: true,
      }],
    },
  );
});
