import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireProvider, type ProviderAdapterRegistry } from "../src/acquisition";
import { ProviderTimeoutError } from "../src/http/fetch";
import type { TrackMetadata } from "../src/types";

const track: TrackMetadata = {
  id: "id",
  title: "Song",
  artists: ["Artist"],
  album: "Album",
  durationMs: 180_000,
};

describe("provider acquisition", () => {
  afterEach(() => vi.useRealTimers());

  it("reports a per-request timeout without imposing a whole-provider deadline", async () => {
    const adapter = vi.fn(async () => {
      throw new ProviderTimeoutError("request timed out");
    });
    const adapters: ProviderAdapterRegistry = {
      amlldb: adapter,
      qq: adapter,
      kugou: adapter,
      netease: adapter,
      soda: adapter,
    };

    await expect(acquireProvider("qq", track, {}, adapters)).resolves.toEqual({ kind: "timeout" });
  });

  it("allows a multi-step provider ladder to run beyond the former five-second cutoff", async () => {
    vi.useFakeTimers();
    const adapter = vi.fn(async () => await new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), 5_500);
    }));
    const adapters: ProviderAdapterRegistry = {
      amlldb: adapter,
      qq: adapter,
      kugou: adapter,
      netease: adapter,
      soda: adapter,
    };
    const pending = acquireProvider("netease", track, {}, adapters);
    await vi.advanceTimersByTimeAsync(5_500);

    await expect(pending).resolves.toEqual({ kind: "no-match" });
  });
});
