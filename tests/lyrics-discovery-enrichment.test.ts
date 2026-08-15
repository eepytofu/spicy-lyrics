import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireWithNativeTitleEnrichment,
  isAcceptedNativeTitleResult,
  nativeTitleHint,
  nativeTitleRetryInfo,
  type NativeTitleHint,
} from "../src/utils/Lyrics/LyricsDiscoveryEnrichment.ts";
import {
  selectLyricsCandidate,
  type LyricsMatchMetadata,
} from "../src/utils/Lyrics/LyricsCandidateSelector.ts";
import type { LyricsSourceProviderId } from "../src/utils/Lyrics/LyricsSourcePreferences.ts";
import type { ProviderAcquisitionOutcome } from "../src/utils/Lyrics/ProviderAcquisition.ts";

type Result = {
  lyrics: Record<string, unknown>;
  match?: LyricsMatchMetadata;
};

function lyricsResult(match: LyricsMatchMetadata, source = "netease"): Result {
  return {
    lyrics: {
      Type: "Line",
      Content: [],
      source,
      SourceMatch: match,
    },
    match,
  };
}

function staticResult(match: LyricsMatchMetadata, source: string): Result {
  return {
    lyrics: {
      Type: "Static",
      Lines: ["alpha", "beta", "gamma"].map((Text) => ({ Text })),
      source,
      SourceMatch: match,
    },
    match,
  };
}

function lineResult(match: LyricsMatchMetadata, source: string): Result {
  return {
    lyrics: {
      Type: "Line",
      Content: [
        { Text: "alpha", StartTime: 0, EndTime: 60 },
        { Text: "beta", StartTime: 60, EndTime: 120 },
        { Text: "gamma", StartTime: 120, EndTime: 180 },
      ],
      source,
      SourceMatch: match,
    },
    match,
  };
}

function syllableResult(match: LyricsMatchMetadata, source: string): Result {
  return {
    lyrics: {
      Type: "Syllable",
      Content: [
        { Lead: { StartTime: 0, EndTime: 60, Syllables: [{ Text: "alpha", StartTime: 0, EndTime: 60 }] } },
        { Lead: { StartTime: 60, EndTime: 120, Syllables: [{ Text: "beta", StartTime: 60, EndTime: 120 }] } },
        { Lead: { StartTime: 120, EndTime: 180, Syllables: [{ Text: "gamma", StartTime: 120, EndTime: 180 }] } },
      ],
      source,
      SourceMatch: match,
    },
    match,
  };
}

function match(
  title: string,
  overrides: Partial<LyricsMatchMetadata> = {},
): LyricsMatchMetadata {
  return {
    title,
    artists: ["Mikito P"],
    coherent: true,
    evidence: {
      title: 1,
      artists: 1,
      album: 1,
      albumArtists: null,
      duration: 1,
      versionConflict: false,
    },
    method: "catalog-search",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

test("derives a trusted CJK title hint without replacing Spotify metadata", () => {
  const hint = nativeTitleHint(
    "Shojo Rei",
    lyricsResult(match("少女レイ", { evidence: { ...match("少女レイ").evidence!, title: 0 } })),
  );
  assert.deepEqual(hint, {
    title: "少女レイ",
    discovery: {
      kind: "netease-native-title",
      provider: "netease",
      originalTitle: "Shojo Rei",
      queryTitle: "少女レイ",
    },
  });

  const original = {
    id: "spotify-id",
    title: "Shojo Rei",
    artists: ["Mikito P"],
    album: "Shojo Rei",
    durationMs: 280_000,
  };
  assert.deepEqual(nativeTitleRetryInfo(original, hint!), {
    ...original,
    title: "少女レイ",
  });
});

test("rejects unsafe or unnecessary NetEase title hints", () => {
  const good = match("少女レイ", { evidence: { ...match("少女レイ").evidence!, title: 0 } });
  assert.equal(nativeTitleHint("少女レイ", lyricsResult(good)), null);
  assert.equal(nativeTitleHint("Shojo Rei", lyricsResult(match("Shojo Rei"))), null);
  assert.equal(nativeTitleHint("Shojo Rei", lyricsResult(match("Shoujo Rei"))), null);
  assert.equal(nativeTitleHint("Shojo Rei", lyricsResult(match("少女レイ", {
    evidence: { ...good.evidence!, artists: 0.8 },
  }))), null);
  assert.equal(nativeTitleHint("Shojo Rei", lyricsResult(match("少女レイ", {
    evidence: { ...good.evidence!, duration: 0.79 },
  }))), null);
  assert.equal(nativeTitleHint("Shojo Rei", lyricsResult(match("少女レイ", {
    evidence: { ...good.evidence!, versionConflict: true },
  }))), null);
});

test("requires strong title and artist evidence from an enriched provider result", () => {
  assert.equal(isAcceptedNativeTitleResult(lyricsResult(match("少女レイ"), "qq")), true);
  assert.equal(isAcceptedNativeTitleResult(lyricsResult(match("少女レイ", {
    evidence: { ...match("少女レイ").evidence!, duration: null },
  }), "amlldb")), true);
  assert.equal(isAcceptedNativeTitleResult(lyricsResult(match("ロキ", {
    confidence: 1,
    evidence: { ...match("ロキ").evidence!, artists: 0 },
  }), "qq")), false);
  assert.equal(isAcceptedNativeTitleResult(lyricsResult(match("少女レイ", {
    evidence: { ...match("少女レイ").evidence!, title: 0.89 },
  }), "kugou")), false);
});

test("Roki-shaped timing confidence cannot admit wrong-artist QQ or KuGou results", async () => {
  const records = await acquireWithNativeTitleEnrichment(
    ["netease", "qq", "kugou"],
    "Roki",
    async (provider, hint) => {
      if (!hint) {
        if (provider === "netease") {
          return {
            kind: "lyrics",
            result: lineResult(match("ロキ", {
              evidence: { ...match("ロキ").evidence!, title: 0 },
            }), "netease"),
          };
        }
        return { kind: "no-match" };
      }
      return {
        kind: "lyrics",
        result: syllableResult(match("ロキ", {
          artists: ["Wrong Artist"],
          confidence: 1,
          evidence: { ...match("ロキ").evidence!, artists: 0 },
        }), provider),
      };
    },
  );
  assert.deepEqual(
    records.map(({ provider, outcome }) => [provider, outcome.kind]),
    [["netease", "lyrics"], ["qq", "no-match"], ["kugou", "no-match"]],
  );
});

test("retry failures leave the provider's original no-match outcome unchanged", async () => {
  for (const retryOutcome of [
    { kind: "queued" as const },
    { kind: "rate-limited" as const, retryAfterMs: 1_000 },
    { kind: "upstream-error" as const, status: 502 },
    { kind: "error" as const, error: new Error("malformed") },
  ]) {
    const records = await acquireWithNativeTitleEnrichment(
      ["netease", "qq"],
      "Shojo Rei",
      async (provider, hint) => {
        if (hint) return retryOutcome;
        if (provider === "netease") {
          return {
            kind: "lyrics",
            result: lyricsResult(match("少女レイ", {
              evidence: { ...match("少女レイ").evidence!, title: 0 },
            })),
          };
        }
        return { kind: "no-match" };
      },
    );
    assert.equal(records.find(({ provider }) => provider === "qq")?.outcome.kind, "no-match");
  }
});

test("starts every base request immediately and fills only approved no-match providers", async () => {
  const order: LyricsSourceProviderId[] = ["apple", "netease", "qq", "kugou", "soda"];
  const pending = new Map(order.map((provider) => [provider, deferred<ProviderAcquisitionOutcome<Result>>() ]));
  const calls: string[] = [];
  const request = acquireWithNativeTitleEnrichment(
    order,
    "Shojo Rei",
    async (provider, hint) => {
      calls.push(`${provider}:${hint?.title ?? "base"}`);
      if (!hint) return pending.get(provider)!.promise;
      if (provider === "qq") return { kind: "lyrics", result: lyricsResult(match("少女レイ"), "qq") };
      if (provider === "kugou") return {
        kind: "lyrics",
        result: lyricsResult(match("少女レイ", {
          artists: ["Wrong Artist"],
          evidence: { ...match("少女レイ").evidence!, artists: 0 },
        }), "kugou"),
      };
      return { kind: "no-match" };
    },
  );

  assert.deepEqual(calls, order.map((provider) => `${provider}:base`));
  pending.get("netease")!.resolve({
    kind: "lyrics",
    result: lyricsResult(match("少女レイ", {
      evidence: { ...match("少女レイ").evidence!, title: 0 },
    })),
  });
  pending.get("qq")!.resolve({ kind: "no-match" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.includes("qq:少女レイ"));

  pending.get("apple")!.resolve({ kind: "lyrics", result: lyricsResult(match("Shojo Rei"), "apple") });
  pending.get("kugou")!.resolve({ kind: "no-match" });
  pending.get("soda")!.resolve({ kind: "upstream-error", status: 502 });
  const records = await request;

  assert.equal(calls.filter((call) => call === "qq:少女レイ").length, 1);
  assert.equal(calls.filter((call) => call === "kugou:少女レイ").length, 1);
  assert.equal(calls.some((call) => call === "soda:少女レイ"), false);
  assert.equal(records.find((record) => record.provider === "qq")?.outcome.kind, "lyrics");
  assert.equal(records.find((record) => record.provider === "kugou")?.outcome.kind, "no-match");
  assert.equal(records.find((record) => record.provider === "soda")?.outcome.kind, "upstream-error");
  const qq = records.find((record) => record.provider === "qq")?.outcome;
  assert.equal(qq?.kind === "lyrics" && qq.result.match?.discovery?.kind, "netease-native-title");
  assert.equal(new Set(records.map((record) => record.provider)).size, records.length);
});

test("does not retry an existing provider hit or start a retry after cancellation", async () => {
  const hint = match("エイリアンエイリアン", {
    evidence: { ...match("エイリアンエイリアン").evidence!, title: 0 },
  });
  const calls: string[] = [];
  const existing = await acquireWithNativeTitleEnrichment(
    ["netease", "qq", "kugou"],
    "Alien Alien",
    async (provider, nativeHint) => {
      calls.push(`${provider}:${nativeHint?.title ?? "base"}`);
      if (provider === "netease") return { kind: "lyrics", result: lyricsResult(hint) };
      return { kind: "lyrics", result: lyricsResult(match("Alien Alien"), provider) };
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(existing.every((record) => record.outcome.kind === "lyrics"), true);

  const controller = new AbortController();
  const netease = deferred<ProviderAcquisitionOutcome<Result>>();
  const qq = deferred<ProviderAcquisitionOutcome<Result>>();
  const cancelledCalls: Array<{ provider: LyricsSourceProviderId; hint?: NativeTitleHint }> = [];
  const cancelled = acquireWithNativeTitleEnrichment(
    ["netease", "qq"],
    "Shojo Rei",
    async (provider, nativeHint) => {
      cancelledCalls.push({ provider, hint: nativeHint });
      return provider === "netease" ? netease.promise : qq.promise;
    },
    controller.signal,
  );
  controller.abort();
  netease.resolve({ kind: "lyrics", result: lyricsResult(hint) });
  qq.resolve({ kind: "no-match" });
  await cancelled;
  assert.equal(cancelledCalls.some((call) => call.hint), false);
});

test("Sabaku-shaped recovery preserves Apple when native-title retries find nothing", async () => {
  const records = await acquireWithNativeTitleEnrichment(
    ["apple", "netease", "qq", "kugou"],
    "Sabaku ni sumu mamono",
    async (provider, hint) => {
      if (hint) return { kind: "no-match" };
      if (provider === "apple") {
        return { kind: "lyrics", result: staticResult(match("Sabaku ni sumu mamono", {
          confidence: 1,
        }), "apple") };
      }
      if (provider === "netease") {
        return { kind: "lyrics", result: lineResult(match("砂漠に棲む魔物", {
          confidence: 0.658,
          evidence: { ...match("砂漠に棲む魔物").evidence!, title: 0 },
        }), "netease") };
      }
      return { kind: "no-match" };
    },
  );
  const candidates = records.flatMap(({ provider, orderIndex, outcome }) => outcome.kind === "lyrics"
    ? [{ provider, orderIndex, lyrics: outcome.result.lyrics, match: outcome.result.match }]
    : []);
  assert.deepEqual(candidates.map((candidate) => candidate.provider), ["apple", "netease"]);
  assert.equal(selectLyricsCandidate(candidates, 180_000, "smart").candidate?.provider, "netease");
});

test("Shojo-shaped recovery adds valid QQ timing and rejects wrong-artist KuGou", async () => {
  const records = await acquireWithNativeTitleEnrichment(
    ["apple", "qq", "kugou", "netease"],
    "Shojo Rei",
    async (provider, hint) => {
      if (!hint) {
        if (provider === "apple") {
          return { kind: "lyrics", result: lineResult(match("Shojo Rei", { confidence: 1 }), "apple") };
        }
        if (provider === "netease") {
          return { kind: "lyrics", result: lineResult(match("少女レイ", {
            confidence: 0.691,
            evidence: { ...match("少女レイ").evidence!, title: 0 },
          }), "netease") };
        }
        return { kind: "no-match" };
      }
      if (provider === "qq") {
        return { kind: "lyrics", result: syllableResult(match("少女レイ", { confidence: 0.824 }), "qq") };
      }
      return {
        kind: "lyrics",
        result: syllableResult(match("少女レイ", {
          artists: ["Wrong Artist"],
          confidence: 0.667,
          evidence: { ...match("少女レイ").evidence!, artists: 0 },
        }), "kugou"),
      };
    },
  );
  const candidates = records.flatMap(({ provider, orderIndex, outcome }) => outcome.kind === "lyrics"
    ? [{ provider, orderIndex, lyrics: outcome.result.lyrics, match: outcome.result.match }]
    : []);
  assert.deepEqual(candidates.map((candidate) => candidate.provider), ["apple", "qq", "netease"]);
  assert.equal(selectLyricsCandidate(candidates, 180_000, "syncType").candidate?.provider, "qq");
});
