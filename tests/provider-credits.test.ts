import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeProviderCredits,
  providerCreditLabel,
  providerCreditProfileUrl,
} from "../src/utils/Lyrics/Applyer/Credits/ApplyProviderCredits.ts";

test("normalizes multiple provider credits while preserving distinct roles", () => {
  const credits = normalizeProviderCredits({
    source: "netease",
    ProviderCredits: [
      { role: "syncedLyrics", name: "Hendrix_u", provider: "netease", userId: "6493075429" },
      { role: "translation", name: "冰霜暗月", provider: "netease", userId: 270201970 },
    ],
  });

  assert.deepEqual(credits, [
    { role: "syncedLyrics", name: "Hendrix_u", provider: "netease", userId: "6493075429" },
    { role: "translation", name: "冰霜暗月", provider: "netease", userId: "270201970" },
  ]);
  assert.equal(providerCreditLabel(credits[0].role), "Synced lyrics by");
  assert.equal(providerCreditLabel(credits[1].role), "Translation by");
});

test("only creates profile links for numeric NetEase Cloud Music user ids", () => {
  assert.equal(
    providerCreditProfileUrl({ role: "lyrics", name: "user", provider: "netease", userId: "123" }),
    "https://music.163.com/#/user/home?id=123",
  );
  assert.equal(
    providerCreditProfileUrl({ role: "lyrics", name: "user", provider: "qq", userId: "123" }),
    undefined,
  );
  assert.equal(
    providerCreditProfileUrl({ role: "lyrics", name: "user", provider: "netease", userId: "javascript:alert(1)" }),
    undefined,
  );
});

test("keeps plain by-tag credits as non-linked text", () => {
  const [credit] = normalizeProviderCredits({
    source: "qq",
    ProviderCredits: [{ role: "lyrics", name: "community editor", provider: "qq" }],
  });
  assert.deepEqual(credit, { role: "lyrics", name: "community editor", provider: "qq" });
  assert.equal(providerCreditProfileUrl(credit), undefined);
});
