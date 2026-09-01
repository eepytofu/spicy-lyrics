import assert from "node:assert/strict";
import { test } from "node:test";

let moduleSequence = 0;

async function loadPlatform(
  getToken: () => Promise<unknown>,
  session?: { accessToken: string; accessTokenExpirationTimestampMs: number },
  authorizationState?: unknown,
) {
  (globalThis as any).Spicetify = {
    Platform: {
      version: "1.2.3",
      Session: session,
      ...(authorizationState === undefined
        ? {}
        : { AuthorizationAPI: { getState: () => authorizationState } }),
    },
    CosmosAsync: { get: getToken },
  };
  (globalThis as any).requestAnimationFrame = (callback: () => void) => {
    callback();
    return 1;
  };

  const url = new URL("../src/components/Global/Platform.ts", import.meta.url);
  url.searchParams.set("test", String(moduleSequence++));
  const module = await import(url.href);
  await module.default.OnSpotifyReady;
  return module.default;
}

test("Spotify token requests reject cleanly, retry, deduplicate, and refresh near expiry", async () => {
  let failedCalls = 0;
  const failed = await loadPlatform(async () => {
    failedCalls += 1;
    throw new Error("network down");
  });
  await assert.rejects(failed.GetSpotifyAccessToken(), /any source/u);
  await assert.rejects(failed.GetSpotifyAccessToken(), /any source/u);
  assert.equal(failedCalls, 2);

  let resolveToken!: (value: unknown) => void;
  let concurrentCalls = 0;
  const concurrent = await loadPlatform(() => {
    concurrentCalls += 1;
    return new Promise((resolve) => {
      resolveToken = resolve;
    });
  });
  const first = concurrent.GetSpotifyAccessToken();
  const second = concurrent.GetSpotifyAccessToken();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(concurrentCalls, 1);
  resolveToken({
    accessToken: "shared-token",
    expiresAtTime: Date.now() + 60_000,
    tokenType: "Bearer",
  });
  assert.deepEqual(await Promise.all([first, second]), ["shared-token", "shared-token"]);

  let refreshCalls = 0;
  const refreshing = await loadPlatform(async () => {
    refreshCalls += 1;
    return {
      accessToken: `token-${refreshCalls}`,
      expiresAtTime: Date.now() + (refreshCalls === 1 ? 100 : 60_000),
      tokenType: "Bearer",
    };
  });
  await assert.rejects(refreshing.GetSpotifyAccessToken(), /any source/u);
  assert.equal(await refreshing.GetSpotifyAccessToken(), "token-2");
  assert.equal(refreshCalls, 2);
});

test("Spotify token requests retain the Session fallback for missing resolvers", async () => {
  const platform = await loadPlatform(
    async () => { throw new Error("Resolver not found"); },
    {
      accessToken: "session-token",
      accessTokenExpirationTimestampMs: Date.now() + 60_000,
    },
  );

  assert.equal(await platform.GetSpotifyAccessToken(), "session-token");
});

test("Spotify token requests prefer the modern AuthorizationAPI", async () => {
  let cosmosCalls = 0;
  const platform = await loadPlatform(
    async () => {
      cosmosCalls += 1;
      return { accessToken: "legacy-token" };
    },
    undefined,
    {
      isAuthorized: true,
      token: {
        accessToken: "modern-token",
        accessTokenExpirationTimestampMs: Date.now() + 60_000,
      },
    },
  );

  assert.equal(await platform.GetSpotifyAccessToken(), "modern-token");
  assert.equal(cosmosCalls, 0);
});

test("Spotify token invalidation forces a new OAuth resolver read", async () => {
  let calls = 0;
  const platform = await loadPlatform(async () => ({
    accessToken: `token-${++calls}`,
    expiresAtTime: Date.now() + 60_000,
    tokenType: "Bearer",
  }));

  assert.equal(await platform.GetSpotifyAccessToken(), "token-1");
  assert.equal(await platform.GetSpotifyAccessToken(), "token-1");
  platform.InvalidateSpotifyAccessToken();
  assert.equal(await platform.GetSpotifyAccessToken(), "token-2");
  assert.equal(calls, 2);
});

test("pre-invalidation token refresh cannot overwrite newer cached state", async () => {
  const resolvers: Array<(value: unknown) => void> = [];
  let calls = 0;
  const platform = await loadPlatform(() => {
    calls += 1;
    return new Promise((resolve) => resolvers.push(resolve));
  });

  const stale = platform.GetSpotifyAccessToken();
  platform.InvalidateSpotifyAccessToken();
  const current = platform.GetSpotifyAccessToken();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);

  resolvers[0]({
    accessToken: "stale-token",
    expiresAtTime: Date.now() + 60_000,
    tokenType: "Bearer",
  });
  resolvers[1]({
    accessToken: "current-token",
    expiresAtTime: Date.now() + 60_000,
    tokenType: "Bearer",
  });

  assert.equal(await stale, "stale-token");
  assert.equal(await current, "current-token");
  assert.equal(await platform.GetSpotifyAccessToken(), "current-token");
  assert.equal(calls, 2);
});
