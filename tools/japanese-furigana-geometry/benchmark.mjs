import { performance } from "node:perf_hooks";

const iterations = 250_000;

globalThis.gc?.();
const beforeImport = process.memoryUsage();
const lookupImportStarted = performance.now();
const {
  loadJitendexFuriganaGeometry,
  lookupJitendexFuriganaGeometry,
} =
  await import("../../src/utils/Lyrics/Processing/Japanese/JitendexFuriganaGeometry.ts");
const lookupModuleImportMs = performance.now() - lookupImportStarted;
globalThis.gc?.();
const afterLookupModuleImport = process.memoryUsage();

const assetImportStarted = performance.now();
await loadJitendexFuriganaGeometry();
const assetImportMs = performance.now() - assetImportStarted;
globalThis.gc?.();
const afterAssetImport = process.memoryUsage();

const fixtures = [
  ["運命", "うんめい"],
  ["運命", "さだめ"],
  ["一昨日", "おととい"],
  ["海女", "あま"],
];
for (const [surface, reading] of fixtures) {
  lookupJitendexFuriganaGeometry(surface, reading);
}

let checksum = 0;
const lookupStarted = performance.now();
for (let index = 0; index < iterations; index += 1) {
  const [surface, reading] = fixtures[index % fixtures.length];
  checksum += lookupJitendexFuriganaGeometry(surface, reading)?.length ?? 0;
}
const lookupMs = performance.now() - lookupStarted;

console.log(
  JSON.stringify(
    {
      node: process.version,
      iterations,
      lookupModuleImportMs: Number(lookupModuleImportMs.toFixed(3)),
      lookupModuleRetainedHeapBytes:
        afterLookupModuleImport.heapUsed - beforeImport.heapUsed,
      lookupModuleRetainedRssBytes:
        afterLookupModuleImport.rss - beforeImport.rss,
      assetImportMs: Number(assetImportMs.toFixed(3)),
      assetRetainedHeapBytes:
        afterAssetImport.heapUsed - afterLookupModuleImport.heapUsed,
      assetRetainedRssBytes:
        afterAssetImport.rss - afterLookupModuleImport.rss,
      totalLookupMs: Number(lookupMs.toFixed(3)),
      nanosecondsPerLookup: Number(((lookupMs * 1_000_000) / iterations).toFixed(1)),
      checksum,
    },
    null,
    2
  )
);
