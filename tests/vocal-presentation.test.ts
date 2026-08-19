import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyVocalPresentation,
  resolveTtmlLinePresentation,
  resolveVocalAgentPresentation,
} from "../src/utils/Lyrics/Applyer/VocalPresentation.ts";

const document = {
  VocalAgents: {
    solo: { Type: "person", Names: ["奏"] },
    duet: { Type: "group", Names: ["初音ミク", "重音テト"] },
    v1: { Type: "person", Names: [] },
  },
};

test("named AMLL agents display once when the resolved agent changes", () => {
  assert.deepEqual(resolveVocalAgentPresentation(document, { VocalAgentId: "solo" }), {
    agentId: "solo",
    label: "奏",
    type: "person",
  });
  assert.deepEqual(resolveVocalAgentPresentation(document, { VocalAgentId: "solo" }, "solo"), {
    agentId: "solo",
    type: "person",
  });
  assert.deepEqual(resolveVocalAgentPresentation(document, { VocalAgentId: "duet" }, "solo"), {
    agentId: "duet",
    label: "初音ミク / 重音テト",
    type: "group",
  });
});

test("anonymous or missing AMLL agents never become visible identities", () => {
  assert.deepEqual(resolveVocalAgentPresentation(document, { VocalAgentId: "v1" }), {});
  assert.deepEqual(resolveVocalAgentPresentation(document, { VocalAgentId: "v2" }), {});
  assert.deepEqual(resolveVocalAgentPresentation(document, {}), {});
});

test("TTML song parts display only when the parser-provided block changes", () => {
  const verse = resolveTtmlLinePresentation({
    ProviderLineId: "L1",
    SongPart: "Verse",
    SongPartBlockIndex: 4,
  });
  assert.deepEqual(verse, {
    ProviderLineId: "L1",
    SongPart: "Verse",
    SongPartBlockIndex: 4,
    key: "4\u0000Verse",
    label: "Verse",
  });
  assert.deepEqual(resolveTtmlLinePresentation({
    ProviderLineId: "L2",
    SongPart: "Verse",
    SongPartBlockIndex: 4,
  }, verse.key), {
    ProviderLineId: "L2",
    SongPart: "Verse",
    SongPartBlockIndex: 4,
    key: "4\u0000Verse",
  });
  assert.equal(resolveTtmlLinePresentation({
    SongPart: "Verse",
    SongPartBlockIndex: 5,
  }, verse.key).label, "Verse");
  assert.deepEqual(resolveTtmlLinePresentation({ ProviderLineId: "L3" }, verse.key), {
    ProviderLineId: "L3",
  });
});

class FakeElement {
  classNames: string[] = [];
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  textContent = "";
  classList = { add: (...values: string[]) => this.classNames.push(...values) };

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
}

test("presentation toggles hide labels while preserving TTML and agent datasets", () => {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new FakeElement() },
  });
  try {
    const line = new FakeElement();
    const state = {};
    applyVocalPresentation(
      line as unknown as HTMLElement,
      document,
      {
        ProviderLineId: "L1",
        SongPart: "Chorus",
        SongPartBlockIndex: 2,
        VocalAgentId: "duet",
      },
      state,
      { showSongSections: false, showVocalistLabels: false },
    );

    assert.deepEqual(line.dataset, {
      ttmlLineId: "L1",
      ttmlSongPart: "Chorus",
      ttmlSongPartBlock: "2",
      vocalAgentId: "duet",
      vocalAgentType: "group",
    });
    assert.deepEqual(line.children, []);
    assert.deepEqual(state, { previousNamedAgentId: "duet", previousSongPartKey: "2\u0000Chorus" });
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("presentation defaults show independent section and named-agent labels", () => {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new FakeElement() },
  });
  try {
    const line = new FakeElement();
    applyVocalPresentation(
      line as unknown as HTMLElement,
      document,
      { SongPart: "Verse", SongPartBlockIndex: 4, VocalAgentId: "solo" },
      {},
    );
    assert.deepEqual(line.children.map((child) => [child.classNames, child.textContent]), [
      [["TtmlSongPartLabel"], "Verse"],
      [["VocalAgentLabel"], "奏"],
    ]);
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});
