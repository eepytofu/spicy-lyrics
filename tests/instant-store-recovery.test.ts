import assert from "node:assert/strict";
import { test } from "node:test";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

const { GetInstantStore } = await import("../src/modules/Store.ts");

test("instant store resets a malformed current-version envelope", () => {
  values.set("malformed-null", JSON.stringify({ Version: 1, Items: null }));
  const store = GetInstantStore("malformed-null", 1, { enabled: true });
  assert.deepEqual(store.Items, { enabled: true });
});

test("instant store resets values that violate the current template", () => {
  values.set("malformed-type", JSON.stringify({ Version: 1, Items: { enabled: "yes" } }));
  const originalWarn = console.warn;
  let warning = "";
  console.warn = (...parts: unknown[]) => {
    warning = parts.map(String).join(" ");
  };
  const store = GetInstantStore("malformed-type", 1, { enabled: true });
  console.warn = originalWarn;
  assert.deepEqual(store.Items, { enabled: true });
  assert.match(warning, /stored data is malformed, resetting/);
});

test("instant store keeps valid values and tops up new defaults", () => {
  values.set("valid-top-up", JSON.stringify({ Version: 1, Items: { enabled: false } }));
  const store = GetInstantStore("valid-top-up", 1, { enabled: true, nested: { count: 2 } });
  assert.deepEqual(store.Items, { enabled: false, nested: { count: 2 } });
});
