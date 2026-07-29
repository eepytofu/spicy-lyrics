import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldHideNpvForMissingLyrics } from "../src/components/Utils/NPVAvailability.ts";

test("NPV hides only for a matching current-track no-lyrics sentinel", () => {
  const uri = "spotify:track:current";
  assert.equal(shouldHideNpvForMissingLyrics(true, uri, `NO_LYRICS:${uri}`), true);
  assert.equal(
    shouldHideNpvForMissingLyrics(true, uri, "NO_LYRICS:spotify:track:previous"),
    false,
  );
  assert.equal(shouldHideNpvForMissingLyrics(true, uri, "lyrics payload"), false);
  assert.equal(shouldHideNpvForMissingLyrics(false, uri, `NO_LYRICS:${uri}`), false);
  assert.equal(shouldHideNpvForMissingLyrics(true, null, `NO_LYRICS:${uri}`), false);
});
