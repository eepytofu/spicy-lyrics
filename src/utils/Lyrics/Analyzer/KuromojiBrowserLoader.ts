import kuromoji from "kuromoji/build/kuromoji.js";
import { dictionaryAssetName, dictionaryBaseUrl, loadDictionaryAsset } from "./KuromojiAssetCache.ts";

const DictionaryRequest = Symbol("spicy-lyrics.kuromoji-dictionary-request");

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);
}

function dictionaryRequestName(url: unknown): string | undefined {
  try {
    return dictionaryAssetName(String(url));
  } catch {
    return undefined;
  }
}

export function buildKuromojiBrowserTokenizer(
  load: (filename: string) => Promise<Uint8Array> = loadDictionaryAsset
): Promise<any> {
  return new Promise((resolve, reject) => {
    // The browser build exposes dictionary loading only through XMLHttpRequest.
    const xhrPrototype = XMLHttpRequest.prototype as any;
    const originalOpen = xhrPrototype.open;
    const originalSend = xhrPrototype.send;

    const patchedOpen = function (this: any, method: string, url: string, ...args: any[]) {
      const filename = dictionaryRequestName(url);
      if (filename === undefined) return originalOpen.call(this, method, url, ...args);
      this[DictionaryRequest] = filename;
    };

    const patchedSend = function (this: any, ...args: any[]) {
      const filename = this[DictionaryRequest] as string | undefined;
      if (filename === undefined) return originalSend.call(this, ...args);

      load(filename).then(
        (bytes) => {
          // Own properties shadow the prototype's read-only response getters.
          Object.defineProperty(this, "status", { value: 200, configurable: true });
          Object.defineProperty(this, "response", {
            value: toArrayBuffer(bytes),
            configurable: true,
          });
          this.onload?.();
        },
        (error: unknown) => {
          this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        }
      );
    };

    const restore = () => {
      if (xhrPrototype.open === patchedOpen) xhrPrototype.open = originalOpen;
      if (xhrPrototype.send === patchedSend) xhrPrototype.send = originalSend;
    };

    xhrPrototype.open = patchedOpen;
    xhrPrototype.send = patchedSend;
    try {
      kuromoji
        .builder({ dicPath: dictionaryBaseUrl() })
        .build((error: unknown, analyzer: unknown) => {
          restore();
          if (error) reject(error);
          else resolve(analyzer);
        });
    } catch (error) {
      restore();
      reject(error);
    }
  });
}
