import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVocalAgentPresentation } from "../src/utils/Lyrics/Applyer/VocalPresentation.ts";

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
