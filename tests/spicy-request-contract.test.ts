import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ProjectVersion } from "../project/config.ts";
import {
  buildSpicyApiHeaders,
  buildSpicyApiRequestBody,
  SPICY_API_CACHE_VERSION,
  SPICY_API_MODE,
} from "../src/utils/API/SpicyRequestContract.ts";

test("Spicy API requests use the complete 6.3.15 contract", () => {
  const queries = [{
    operation: "lyrics",
    variables: { id: "track-id", auth: "SpicyLyrics-WebAuth" },
  }];

  assert.equal(ProjectVersion, "6.3.15");
  assert.equal(SPICY_API_MODE, "2");
  assert.equal(SPICY_API_CACHE_VERSION, 1);
  assert.deepEqual(buildSpicyApiHeaders(ProjectVersion), {
    "Content-Type": "application/json",
    "SpicyLyrics-Version": "6.3.15",
    "X-mode": "2",
  });
  assert.deepEqual(
    buildSpicyApiHeaders(ProjectVersion, {
      "SpicyLyrics-WebAuth": "Bearer token",
    }),
    {
      "Content-Type": "application/json",
      "SpicyLyrics-Version": "6.3.15",
      "SpicyLyrics-WebAuth": "Bearer token",
      "X-mode": "2",
    },
  );
  assert.equal(
    buildSpicyApiRequestBody(queries, ProjectVersion),
    '{"queries":[{"operation":"lyrics","variables":{"id":"track-id","auth":"SpicyLyrics-WebAuth"}}],"client":{"version":"6.3.15"}}',
  );
});

test("the original API surface remains limited to lyrics and ext_version", () => {
  const sources = [
    readFileSync(
      new URL("../src/components/Global/Session.ts", import.meta.url),
      "utf8",
    ),
    readFileSync(
      new URL("../src/utils/Lyrics/ExternalSources.ts", import.meta.url),
      "utf8",
    ),
  ].join("\n");
  const operations = Array.from(
    sources.matchAll(/operation:\s*"([^"]+)"/gu),
    (match) => match[1],
  );

  assert.deepEqual(new Set(operations), new Set(["lyrics", "ext_version"]));
});
