import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireProvider, type ProviderAdapterRegistry } from "../src/acquisition";
import type { TrackMetadata } from "../src/types";

const track: TrackMetadata = {
  id: "id",
  title: "Song",
  artists: ["Artist"],
  album: "Album",
  durationMs: 180_000,
};

describe("provider acquisition deadline", () => {
  afterEach(() => vi.useRealTimers());

  it("aborts the adapter and reports an internal deadline as a timeout", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const adapter = vi.fn(async (_track, context) => {
      receivedSignal = context.signal;
      return await new Promise<undefined>((_resolve, reject) => {
        context.signal?.addEventListener("abort", () => reject(context.signal?.reason), { once: true });
      });
    });
    const adapters: ProviderAdapterRegistry = {
      amlldb: adapter,
      qq: adapter,
      kugou: adapter,
      netease: adapter,
      soda: adapter,
    };

    const pending = acquireProvider("qq", track, { deadlineMs: 25 }, adapters);
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toEqual({ kind: "timeout" });
    expect(receivedSignal?.aborted).toBe(true);
  });
});
