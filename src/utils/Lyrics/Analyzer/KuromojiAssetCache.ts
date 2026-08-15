// Changing this value invalidates every cached dictionary asset.
export const KUROMOJI_ASSET_VERSION = "kuromoji-0.1.2-ipadic-2.7.0-20070801";

const DEFAULT_DICTIONARY_BASE_URL = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";

const DictionaryFilename =
  /^(?:base|check|cc|tid|tid_pos|tid_map|unk|unk_pos|unk_map|unk_char|unk_compat|unk_invoke)\.dat\.gz$/u;

export function dictionaryBaseUrl(): string {
  const override = (globalThis as Record<string, any>).__SpicyKuromojiDictBase__;
  const base = typeof override === "string" && override ? override : DEFAULT_DICTIONARY_BASE_URL;
  return base.replace(/\/?$/u, "/");
}

export function dictionaryAssetName(requestedPath: string): string {
  const filename = requestedPath.replace(/\\/gu, "/").split("/").at(-1) || "";
  if (!DictionaryFilename.test(filename)) {
    throw new Error(`Unexpected Kuromoji dictionary filename: ${filename || "<empty>"}`);
  }
  return filename;
}

export function dictionaryAssetUrl(filename: string): string {
  return `${dictionaryBaseUrl()}${dictionaryAssetName(filename)}`;
}

export function dictionaryCacheKey(filename: string): string {
  return `${KUROMOJI_ASSET_VERSION}/${filename}`;
}

export type DictionaryAssetStore = {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, bytes: Uint8Array): Promise<void>;
};

// Keep browser-owned persistence and logging outside the testable asset loader boundary.
const database = () => import("../../db.ts");

let logger: Promise<{ warn(...args: unknown[]): void }> | undefined;
async function warnCacheFailure(...args: unknown[]): Promise<void> {
  try {
    logger ??= import("../../Logger.ts").then(({ default: Logger }) => new Logger("KuromojiAssets"));
    (await logger).warn(...args);
  } catch {
    return;
  }
}

let persistenceRequested = false;

function browserStore(): DictionaryAssetStore {
  return {
    async read(key) {
      try {
        const { dbPromise, ObjectStores } = await database();
        const stored = await (await dbPromise).get(ObjectStores.JapaneseAssets, key);
        if (stored instanceof Uint8Array) return stored;
        if (stored instanceof ArrayBuffer) return new Uint8Array(stored);
        return undefined;
      } catch (error) {
        await warnCacheFailure("Cache read failed for", key, error);
        return undefined;
      }
    },
    async write(key, bytes) {
      try {
        const { dbPromise, ensurePersistence, ObjectStores } = await database();
        if (!persistenceRequested) {
          persistenceRequested = true;
          // Request durable storage once before caching the dictionary.
          await ensurePersistence();
        }
        await (await dbPromise).put(ObjectStores.JapaneseAssets, bytes, key);
      } catch (error) {
        await warnCacheFailure("Cache write failed for", key, error);
      }
    },
  };
}

export type DictionaryAssetLoaderOptions = {
  store?: DictionaryAssetStore;
  fetchImpl?: typeof fetch;
};

export function createDictionaryAssetLoader(
  options: DictionaryAssetLoaderOptions = {}
): (requestedPath: string) => Promise<Uint8Array> {
  const store = options.store ?? browserStore();
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const inFlight = new Map<string, Promise<Uint8Array>>();

  async function fetchAsset(filename: string): Promise<Uint8Array> {
    const response = await fetchImpl(dictionaryAssetUrl(filename));
    if (!response.ok) {
      throw new Error(`Kuromoji dictionary ${filename}: ${response.status} ${response.statusText}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error(`Kuromoji dictionary ${filename}: empty response`);
    return bytes;
  }

  return async function loadDictionaryAsset(requestedPath: string): Promise<Uint8Array> {
    const filename = dictionaryAssetName(requestedPath);
    const key = dictionaryCacheKey(filename);

    // Cache failures must never make the dictionary unavailable.
    const cached = await store.read(key).catch(() => undefined);
    if (cached) return cached;

    const existing = inFlight.get(filename);
    if (existing) return existing;

    const request = (async () => {
      const bytes = await fetchAsset(filename);
      await store.write(key, bytes).catch(() => {});
      return bytes;
    })().finally(() => inFlight.delete(filename));

    inFlight.set(filename, request);
    return request;
  };
}

export const loadDictionaryAsset = createDictionaryAssetLoader();

export async function clearKuromojiAssetCache(): Promise<void> {
  const { dbPromise, ObjectStores } = await database();
  await (await dbPromise).clear(ObjectStores.JapaneseAssets);
}
