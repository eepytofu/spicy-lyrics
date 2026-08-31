import assert from "node:assert/strict";
import { test } from "node:test";
import { ProjectVersion } from "../project/config.ts";
import {
  buildSpicyApiHeaders,
  buildSpicyApiRequestBody,
  SPICY_API_CACHE_VERSION,
  SPICY_API_MODE,
} from "../src/utils/API/SpicyRequestContract.ts";

test("Spicy API requests use the complete 6.3.12 contract", () => {
  const queries = [{
    operation: "lyrics",
    variables: { id: "track-id", auth: "SpicyLyrics-WebAuth" },
  }];

  assert.equal(ProjectVersion, "6.3.12");
  assert.equal(SPICY_API_MODE, "2");
  assert.equal(SPICY_API_CACHE_VERSION, 1);
  assert.deepEqual(buildSpicyApiHeaders(ProjectVersion), {
    "Content-Type": "application/json",
    "SpicyLyrics-Version": "6.3.12",
    "X-mode": "2",
  });
  assert.deepEqual(
    buildSpicyApiHeaders(ProjectVersion, {
      "SpicyLyrics-WebAuth": "Bearer token",
    }),
    {
      "Content-Type": "application/json",
      "SpicyLyrics-Version": "6.3.12",
      "SpicyLyrics-WebAuth": "Bearer token",
      "X-mode": "2",
    },
  );
  assert.equal(
    buildSpicyApiRequestBody(queries, ProjectVersion),
    '{"queries":[{"operation":"lyrics","variables":{"id":"track-id","auth":"SpicyLyrics-WebAuth"}}],"client":{"version":"6.3.12"}}',
  );
});
