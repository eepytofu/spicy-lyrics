import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "../src/http/fetch";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("preserves an incoming request abort signal", async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: string, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener(
          "abort",
          () => reject(receivedSignal?.reason),
          { once: true },
        );
      });
    }));
    const controller = new AbortController();

    const pending = fetchWithTimeout(
      "https://provider.test/lyrics",
      { signal: controller.signal },
      60_000,
    );
    controller.abort(new DOMException("Client disconnected", "AbortError"));

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "Client disconnected",
    });
    expect(receivedSignal).not.toBe(controller.signal);
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("aborts an upstream request when its own timeout expires", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: string, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener(
          "abort",
          () => reject(receivedSignal?.reason),
          { once: true },
        );
      });
    }));

    const pending = fetchWithTimeout("https://provider.test/lyrics", undefined, 50);
    const rejection = expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "Provider request timed out",
    });
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(receivedSignal?.aborted).toBe(true);
  });
});
