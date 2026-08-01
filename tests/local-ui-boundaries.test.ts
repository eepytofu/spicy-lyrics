import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const modalSource = readFileSync(new URL("../src/components/Modal.ts", import.meta.url), "utf8");
const uploadSource = readFileSync(
  new URL(
    "../src/components/ReactComponents/LyricsManager/components/UploadTTMLModal.tsx",
    import.meta.url
  ),
  "utf8"
);

test("the generic modal accepts DOM nodes instead of executable markup strings", () => {
  assert.match(modalSource, /content: Node;/u);
  assert.match(modalSource, /main\.replaceChildren\(content\)/u);
  assert.doesNotMatch(modalSource, /main\.innerHTML = content/u);
});

test("the TTML upload UI discloses the remote parsing boundary", () => {
  assert.match(uploadSource, /TTML is parsed by the Spicy Lyrics service/u);
  assert.match(uploadSource, /their contents are sent for parsing when loaded/u);
});
