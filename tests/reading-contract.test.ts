import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  codePointLength,
  codePointOffsetToUtf16Index,
  codePointSlice,
  isValidCodePointRange,
  utf16IndexToCodePointOffset,
} from "../src/utils/Lyrics/Processing/CodePoint.ts";
import type { ParsedDocument } from "../src/utils/Lyrics/Processing/Model.ts";

test("reading contract uses Unicode code-point coordinates", () => {
  const text = "A😀한국";
  assert.equal(codePointLength(text), 4);
  assert.equal(codePointSlice(text, { startCp: 1, endCp: 3 }), "😀한");
  assert.equal(codePointOffsetToUtf16Index(text, 2), 3);
  assert.equal(utf16IndexToCodePointOffset(text, 3), 2);
  assert.equal(isValidCodePointRange(text, { startCp: 0, endCp: 4 }), true);
  assert.equal(isValidCodePointRange(text, { startCp: 3, endCp: 5 }), false);
});

test("parsed contract represents unavailable paragraph provenance explicitly", () => {
  const document: ParsedDocument = {
    id: "provider-capture",
    language: "ko",
    lines: [{
      id: "line-1",
      displayText: "주저 없이 다, Probably delete it",
      paragraphProvenance: "unavailable",
      spans: [],
    }],
  };

  assert.equal(document.lines[0].paragraphId, undefined);
  assert.equal(document.lines[0].paragraphProvenance, "unavailable");
});

test("shared reading fixtures expose provider spans and semantic expectations", () => {
  const path = fileURLToPath(new URL("./fixtures/lyrics-reading/v1/camouflage-provider.json", import.meta.url));
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.lines.length, 7);
  assert.deepEqual(fixture.capture.spanTuple, ["rawText", "providerPartOfWord", "startMs", "endMs"]);
  const mixed = fixture.lines.find((line: any) => line.id === "camouflage-29");
  assert.equal(mixed.expected.canonicalText, "주저 없이 다, Probably delete it");
  assert.deepEqual(mixed.spans.at(-1), ["it", false, 74437, 75002]);
  for (const line of fixture.lines) {
    for (const field of ["boundaries", "spanMappings", "scriptRuns", "readingUnits", "timedReadingUnits"]) {
      assert.ok(Array.isArray(line.expected[field]), `${line.id}.${field}`);
    }
  }
});
