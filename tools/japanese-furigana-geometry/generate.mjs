import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { gunzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "../..");
const DEFAULTS = {
  jitendexOutput: resolve(
    ROOT,
    "builds/private-research/experiments/furigana-geometry-comparison/jitendex-strict-on-release-output.jsonl"
  ),
  specialPairs: resolve(
    ROOT,
    "builds/private-research/experiments/furigana-geometry-comparison/jitendex-special-pairs.tsv"
  ),
  oracle: resolve(
    ROOT,
    "builds/private-research/experiments/japanese-reading/assets/JmdictFurigana.txt.gz"
  ),
  output: resolve(
    ROOT,
    "src/utils/Lyrics/Processing/Japanese/GeneratedJitendexFuriganaGeometry.ts"
  ),
  metadata: resolve(ROOT, "tools/japanese-furigana-geometry/generated-metadata.json"),
  kuromojiPackage: resolve(ROOT, "package.json"),
};

const BUCKET_COUNT = 256;
const ALL_KANJI = /^[\u3005\u3006\u3400-\u9fff\u{20000}-\u{2ffff}]+$/u;

function parseArguments(argv) {
  const options = { ...DEFAULTS, check: false };
  const names = new Map([
    ["--jitendex-output", "jitendexOutput"],
    ["--special-pairs", "specialPairs"],
    ["--oracle", "oracle"],
    ["--output", "output"],
    ["--metadata", "metadata"],
    ["--kuromoji-package", "kuromojiPackage"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    const property = names.get(argument);
    if (!property || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    options[property] = resolve(argv[++index]);
  }
  return options;
}

function normalizeReading(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u30a1-\u30f6]/gu, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60)
    );
}

function keyOf(surface, reading) {
  return `${surface}\t${reading}`;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function geometryFromJitendexParts(surface, reading, parts) {
  if (!Array.isArray(parts)) return undefined;
  if (parts.map((part) => String(part.base || "")).join("") !== surface) {
    throw new Error(`Jitendex geometry does not reconstruct ${JSON.stringify(surface)}`);
  }

  const reconstructedReading = normalizeReading(
    parts.map((part) => String(part.ruby ?? part.base ?? "")).join("")
  );
  if (reconstructedReading !== reading) {
    throw new Error(`Jitendex geometry does not reconstruct the reading for ${surface}`);
  }

  const segments = parts.map((part) => ({
    length: Array.from(String(part.base || "")).length,
    reading: part.ruby == null ? "" : normalizeReading(part.ruby),
  }));
  if (segments.some((segment) => segment.length < 1 || !segment.reading)) return undefined;
  if (
    segments.reduce((total, segment) => total + segment.length, 0) !== Array.from(surface).length
  ) {
    throw new Error(`Jitendex geometry has an invalid surface length for ${surface}`);
  }
  return segments.map((segment) => `${segment.length.toString(36)}:${segment.reading}`).join("|");
}

function geometryFromJmdict(surface, rawGeometry) {
  const surfaceLength = Array.from(surface).length;
  let cursor = 0;
  const segments = [];

  for (const rawSegment of String(rawGeometry || "").split(";")) {
    const separator = rawSegment.indexOf(":");
    if (separator < 1) return undefined;
    const rawRange = rawSegment.slice(0, separator);
    const rawReading = normalizeReading(rawSegment.slice(separator + 1));
    const [rawStart, rawEnd = rawStart] = rawRange.split("-");
    const start = Number.parseInt(rawStart, 10);
    const end = Number.parseInt(rawEnd, 10) + 1;
    if (!rawReading || start !== cursor || end <= start || end > surfaceLength) return undefined;
    segments.push(`${(end - start).toString(36)}:${rawReading}`);
    cursor = end;
  }
  return cursor === surfaceLength ? segments.join("|") : undefined;
}

async function loadSpecialPairs(path) {
  const pairs = new Set();
  for (const line of (await readFile(path, "utf8")).replace(/^\ufeff/u, "").split(/\r?\n/u)) {
    if (!line) continue;
    const [surface, reading] = line.split("\t");
    if (surface && reading) pairs.add(keyOf(surface.normalize("NFKC"), normalizeReading(reading)));
  }
  return pairs;
}

async function collectCandidates(path, specialPairs) {
  const bySurface = new Map();
  const counters = {
    releasedPairs: 0,
    solverUnresolved: 0,
    nonCompound: 0,
    safeBroadFallback: 0,
    specialReadingFallback: 0,
    detailedCandidates: 0,
  };
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line) continue;
    counters.releasedPairs += 1;
    const row = JSON.parse(line);
    if (!row.parts) {
      counters.solverUnresolved += 1;
      continue;
    }

    const surface = String(row.surface || "").normalize("NFKC");
    const reading = normalizeReading(row.reading);
    if (Array.from(surface).length < 2 || !ALL_KANJI.test(surface)) {
      counters.nonCompound += 1;
      continue;
    }

    const geometry = geometryFromJitendexParts(surface, reading, row.parts);
    if (!geometry || geometry.split("|").length < 2) {
      counters.safeBroadFallback += 1;
      continue;
    }
    if (specialPairs.has(keyOf(surface, reading))) {
      counters.specialReadingFallback += 1;
      continue;
    }

    const entries = bySurface.get(surface) || [];
    entries.push({ reading, geometry });
    bySurface.set(surface, entries);
    counters.detailedCandidates += 1;
  }
  return { bySurface, counters };
}

async function loadKuromoji(packagePath) {
  const require = createRequire(packagePath);
  const kuromoji = require("kuromoji");
  const packageJsonPath = require.resolve("kuromoji/package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const dictionaryPath = resolve(dirname(packageJsonPath), "dict").replaceAll("\\", "/") + "/";
  const started = performance.now();
  const tokenizer = await new Promise((resolveTokenizer, reject) => {
    kuromoji
      .builder({ dicPath: dictionaryPath })
      .build((error, value) => (error ? reject(error) : resolveTokenizer(value)));
  });
  return {
    tokenizer,
    version: packageJson.version,
    initializeMs: performance.now() - started,
  };
}

function selectReachablePairs(bySurface, tokenizer) {
  const selected = [];
  const counters = {
    candidateSurfaces: bySurface.size,
    singleTokenSurfaces: 0,
    readingMatchedPairs: 0,
  };

  for (const [surface, entries] of bySurface) {
    const tokens = tokenizer.tokenize(surface);
    if (tokens.length !== 1 || tokens[0].surface_form !== surface) continue;
    counters.singleTokenSurfaces += 1;
    const reading = normalizeReading(tokens[0].reading || tokens[0].pronunciation || "");
    for (const entry of entries) {
      if (entry.reading !== reading) continue;
      selected.push({ surface, reading, geometry: entry.geometry });
      counters.readingMatchedPairs += 1;
    }
  }
  return { selected, counters };
}

async function compareOracle(path, selected) {
  const selectedKeys = new Set(selected.map((entry) => keyOf(entry.surface, entry.reading)));
  const geometries = new Map();
  const compressed = await readFile(path);
  const text = gunzipSync(compressed)
    .toString("utf8")
    .replace(/^\ufeff/u, "");

  for (const line of text.split(/\r?\n/u)) {
    if (!line) continue;
    const first = line.indexOf("|");
    const second = line.indexOf("|", first + 1);
    if (first < 1 || second <= first) continue;
    const surface = line.slice(0, first).normalize("NFKC");
    const reading = normalizeReading(line.slice(first + 1, second));
    const key = keyOf(surface, reading);
    if (!selectedKeys.has(key)) continue;
    const geometry = geometryFromJmdict(surface, line.slice(second + 1));
    if (!geometry) continue;
    const values = geometries.get(key) || new Set();
    values.add(geometry);
    geometries.set(key, values);
  }

  let exact = 0;
  let divergent = 0;
  let missing = 0;
  const exactKeys = new Set();
  const divergenceSamples = [];
  for (const entry of selected) {
    const key = keyOf(entry.surface, entry.reading);
    const candidates = geometries.get(key);
    if (!candidates) {
      missing += 1;
    } else if (candidates.has(entry.geometry)) {
      exact += 1;
      exactKeys.add(key);
    } else {
      divergent += 1;
      if (divergenceSamples.length < 20) {
        divergenceSamples.push({
          surface: entry.surface,
          reading: entry.reading,
          jitendex: entry.geometry,
          jmdictFurigana: [...candidates].sort(),
        });
      }
    }
  }
  return {
    exactKeys,
    report: {
      compressedBytes: compressed.byteLength,
      sha256: sha256(compressed),
      exact,
      divergent,
      missing,
      divergenceSamples,
    },
  };
}

function escapeTemplateLiteral(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
}

function buildAsset(selected) {
  const buckets = Array.from({ length: BUCKET_COUNT }, () => []);
  const seenSurfaces = new Set();
  for (const entry of selected) {
    if (seenSurfaces.has(entry.surface)) {
      throw new Error(`Multiple reachable readings survived for ${JSON.stringify(entry.surface)}`);
    }
    seenSurfaces.add(entry.surface);
    buckets[fnv1a(entry.surface) & (BUCKET_COUNT - 1)].push(
      `\n${entry.surface}\t${entry.geometry}`
    );
  }

  const serialized = buckets.map((entries) => `${entries.sort().join("")}\n`);
  const body = serialized.map((bucket) => `  \`${escapeTemplateLiteral(bucket)}\`,`).join("\n");
  const source = `/*
 * SPDX-License-Identifier: CC-BY-SA-4.0
 *
 * Generated from Jitendex headword furigana geometry. Jitendex includes
 * JMdict/KANJIDIC data from EDRDG. See tools/japanese-furigana-geometry/README.md.
 * Do not edit this file by hand.
 */

export const JAPANESE_FURIGANA_GEOMETRY_BUCKETS = [
${body}
] as const;
`;
  return { source, bucketBytes: serialized.map((bucket) => Buffer.byteLength(bucket)) };
}

async function writeOrCheck(path, content, check) {
  if (check) {
    const existing = await readFile(path, "utf8");
    if (existing !== content) throw new Error(`Generated output is stale: ${path}`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const started = performance.now();
  const specialPairs = await loadSpecialPairs(options.specialPairs);
  const { bySurface, counters: candidateCounters } = await collectCandidates(
    options.jitendexOutput,
    specialPairs
  );
  const kuromoji = await loadKuromoji(options.kuromojiPackage);
  const reachabilityStarted = performance.now();
  const { selected, counters: reachabilityCounters } = selectReachablePairs(
    bySurface,
    kuromoji.tokenizer
  );
  const reachabilityMs = performance.now() - reachabilityStarted;
  selected.sort((left, right) => {
    const leftKey = keyOf(left.surface, left.reading);
    const rightKey = keyOf(right.surface, right.reading);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  const oracle = await compareOracle(options.oracle, selected);
  const consensus = selected.filter((entry) =>
    oracle.exactKeys.has(keyOf(entry.surface, entry.reading))
  );
  const { source, bucketBytes } = buildAsset(consensus);
  const metadata = {
    schemaVersion: 1,
    source: {
      jitendexRelease: "2026.07.09.0",
      jitendexSolverCommit: "1d3f994607c4ba1f90b6c2e5fb20f99fc5571278",
      jitendexSolverMode: "strict-informed",
      japaneseTextUtilsCommit: "a67bfbe",
      jitendexKnowledgeCommit: "5d422e5",
      jitendexOutputSha256: await sha256File(options.jitendexOutput),
      specialPairsSha256: await sha256File(options.specialPairs),
      specialPairs: specialPairs.size,
      kuromojiVersion: kuromoji.version,
    },
    filters: {
      ...candidateCounters,
      ...reachabilityCounters,
    },
    oracle: oracle.report,
    output: {
      buckets: BUCKET_COUNT,
      entries: consensus.length,
      utf8Bytes: Buffer.byteLength(source),
      sha256: sha256(source),
      smallestBucketBytes: Math.min(...bucketBytes),
      largestBucketBytes: Math.max(...bucketBytes),
    },
  };
  const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;

  await writeOrCheck(options.output, source, options.check);
  await writeOrCheck(options.metadata, metadataText, options.check);
  console.log(metadataText);
  console.log(
    JSON.stringify({
      observedGeneration: {
        kuromojiInitializeMs: Number(kuromoji.initializeMs.toFixed(3)),
        reachabilityMs: Number(reachabilityMs.toFixed(3)),
        totalMs: Number((performance.now() - started).toFixed(3)),
      },
    })
  );
}

await main();
