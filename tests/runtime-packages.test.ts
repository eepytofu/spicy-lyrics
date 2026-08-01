import assert from "node:assert/strict";
import { test } from "node:test";
import { transliterate } from "greek-transliteration";

test("Greek romanization is available from the pinned local dependency", () => {
  assert.equal(transliterate("λόγος"), "logos");
});
