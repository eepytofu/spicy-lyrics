import assert from "node:assert/strict";
import { test } from "node:test";
import { isProviderInfoKind as isClientProviderInfoKind } from "../src/utils/Lyrics/ProviderInfo.ts";
import { isVocalCue as isClientVocalCue } from "../src/utils/Lyrics/VocalSemantics.ts";
import {
  isProviderInfoKind as isWorkerProviderInfoKind,
  isVocalCue as isWorkerVocalCue,
} from "../worker/src/types.ts";

const PROVIDER_INFO_KINDS = [
  "trackHeader",
  "credit",
  "rightsHolder",
  "rightsNotice",
  "providerNotice",
] as const;

test("client and Worker accept exactly the same provider-info kinds", () => {
  const candidates: unknown[] = [
    ...PROVIDER_INFO_KINDS,
    "",
    "providerInfo",
    "unknown",
    "Credit",
    null,
    undefined,
    0,
    {},
    [],
  ];

  for (const candidate of candidates) {
    assert.equal(
      isClientProviderInfoKind(candidate),
      isWorkerProviderInfoKind(candidate),
      JSON.stringify(candidate),
    );
  }
  assert.deepEqual(candidates.filter(isClientProviderInfoKind), PROVIDER_INFO_KINDS);
});

test("client and Worker accept exactly the same vocal-cue forms and shapes", () => {
  const validCues = [
    { Label: "合", Form: "labelColon" },
    { Label: "尚辰", Form: "bracketedLabel" },
  ];
  const candidates: unknown[] = [
    ...validCues,
    { Label: "合", Form: "unknown" },
    { Label: "", Form: "labelColon" },
    { Label: 1, Form: "labelColon" },
    { Form: "labelColon" },
    { Label: "合" },
    null,
    undefined,
    "合：",
    [],
    {},
  ];

  for (const candidate of candidates) {
    assert.equal(
      isClientVocalCue(candidate),
      isWorkerVocalCue(candidate),
      JSON.stringify(candidate),
    );
  }
  assert.deepEqual(candidates.filter(isClientVocalCue), validCues);
});
