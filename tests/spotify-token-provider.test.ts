import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSpotifyTokenProvider,
  SpotifyTokenAcquisitionError,
} from "../src/components/Global/SpotifyTokenProvider.ts";

const NOW = 1_000_000;
const FRESH = NOW + 120_000;

test("modern AuthorizationAPI state wins without reading legacy sources", async () => {
  let legacyReads = 0;
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: {
      readAuthorizationApiState: () => ({
        isAuthorized: true,
        token: { accessToken: "modern", accessTokenExpirationTimestampMs: FRESH },
      }),
      readLegacyCosmosToken: () => {
        legacyReads += 1;
        return { accessToken: "legacy" };
      },
    },
  });

  assert.equal(await provider.getToken(), "modern");
  assert.equal(legacyReads, 0);
});

test("unauthorized anonymous and near-expiry modern states fall back", async () => {
  for (const state of [
    { isAuthorized: false, token: { accessToken: "blocked", accessTokenExpirationTimestampMs: FRESH } },
    { isAuthorized: true, token: { accessToken: "anonymous", accessTokenExpirationTimestampMs: FRESH, isAnonymous: true } },
    { isAuthorized: true, token: { accessToken: "expiring", accessTokenExpirationTimestampMs: NOW + 30_000 } },
  ]) {
    const provider = createSpotifyTokenProvider({
      now: () => NOW,
      sources: {
        readAuthorizationApiState: () => state,
        readLegacyCosmosToken: () => ({ accessToken: "fallback" }),
      },
    });
    assert.equal(await provider.getToken(), "fallback");
  }
});

test("source rejection falls through and failed refreshes can recover", async () => {
  let available = false;
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: {
      readAuthorizationApiState: () => { throw new Error("modern unavailable"); },
      readLegacyCosmosToken: () => { throw new Error("resolver unavailable"); },
      readSessionTokenState: () => available ? { accessToken: "session" } : undefined,
    },
  });

  await assert.rejects(provider.getToken(), SpotifyTokenAcquisitionError);
  available = true;
  assert.equal(await provider.getToken(), "session");
});

test("invalidation prevents an old refresh from replacing new cached state", async () => {
  const resolvers: Array<(value: { accessToken: string }) => void> = [];
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: {
      readLegacyCosmosToken: () => new Promise((resolve) => resolvers.push(resolve)),
    },
  });
  const stale = provider.getToken();
  provider.invalidate();
  const current = provider.getToken();
  await new Promise((resolve) => setTimeout(resolve, 0));
  resolvers[0]({ accessToken: "stale" });
  resolvers[1]({ accessToken: "current" });

  assert.equal(await stale, "stale");
  assert.equal(await current, "current");
  assert.equal(await provider.getToken(), "current");
});
