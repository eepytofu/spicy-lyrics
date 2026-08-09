import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import kuromoji from "kuromoji";

// Yomitan transform definitions are GPL-3.0-or-later. JMdict,
// JmdictFurigana, and KANJIDIC2-derived data are CC BY-SA 4.0 and include
// EDRDG material.
// The generated output preserves those notices inside this AGPL project.

const ROOT = resolve(import.meta.dirname, "../..");
const YOMITAN_ROOT = resolve(
  ROOT,
  "builds/private-research/experiments/yomitan-analyzer/cache/yomitan-26.7.21.0",
);
const YOMITAN_ARCHIVE = resolve(YOMITAN_ROOT, "yomitan-chrome.zip");
const TRANSFORMS_SOURCE = resolve(YOMITAN_ROOT, "chrome/js/language/ja/japanese-transforms.js");
const YOMITAN_LEGAL = resolve(YOMITAN_ROOT, "chrome/legal.html");
const JMDICT_ROOT = resolve(
  ROOT,
  "builds/private-research/experiments/yomitan-analyzer/cache/jmdict-2026-07-28/JMdict_english_without_proper_names",
);
const JMDICT_ARCHIVE = resolve(
  ROOT,
  "builds/private-research/experiments/yomitan-analyzer/cache/jmdict-2026-07-28/JMdict_english_without_proper_names.zip",
);
const FURIGANA_SOURCE = resolve(
  ROOT,
  "builds/private-research/experiments/japanese-reading/assets/JmdictFurigana.txt.gz",
);
const JITENDEX_GEOMETRY_SOURCE = resolve(
  ROOT,
  "src/utils/Lyrics/Processing/Japanese/GeneratedJitendexFuriganaGeometry.ts",
);
const KANJIDIC_READING_SOURCE = resolve(
  ROOT,
  "builds/private-research/experiments/suzume-reading-hybrid/generated/kanjidic-readings.tsv.gz",
);
const JMDICT_INDEX = resolve(JMDICT_ROOT, "index.json");
const OUTPUT = resolve(
  ROOT,
  "src/utils/Lyrics/Processing/Japanese/GeneratedJapaneseDeinflectionData.ts",
);

const EXPECTED_HASHES = new Map([
  [YOMITAN_ARCHIVE, "3a2ae02426aa94b0381cae90e8295f97b7f0926f7332841a6a18ea0d7c6c26a4"],
  [JMDICT_ARCHIVE, "c67c2238dc31c67d7b10a99d8cf39d40fd8ee2467dadcb77793a523d336eede4"],
  [FURIGANA_SOURCE, "f2f376606758f315c385f014d26bd6a976a36b76845e7bd60f409ee7b0e6da53"],
  [TRANSFORMS_SOURCE, "467b7973efec4ba871bda47a0098e13585aa223b936a95a8d734bea474d0589a"],
  [YOMITAN_LEGAL, "0e2351394d8e963169c5fea7d2b1b982864fc144694e0bd776fae690b85937bd"],
  [JMDICT_INDEX, "a3f36a4d7fbfc0c75d1b7af3aa9775ac2211518959d2e789de266352cdf71c1c"],
  [JITENDEX_GEOMETRY_SOURCE, "0d620d50040fb65b0baa9fea4cccf6325b82451e96553de46045c79033ee6503"],
  [KANJIDIC_READING_SOURCE, "fb4ce3297c74bc0cd3cca882e0c6d7edbacaec3087ca293741ca5bebaaff2acc"],
]);
const EXPECTED_TERM_BANK_SHA256 = "d66650a297348fae4ec5cb09fa43378534ca447fbad3efc2deb8e28e1498a8af";

const JAPANESE_TERM = /^[々〆ヶぁ-ゖァ-ヺー一-鿿豈-﫿]+$/u;
const HAS_KANJI = /[々〆ヶ一-鿿豈-﫿]/u;
const BUCKET_COUNT = 256;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function verifyInputs() {
  for (const [path, expected] of EXPECTED_HASHES) {
    const bytes = await readFile(path).catch(() => undefined);
    if (!bytes) throw new Error(`Missing private Japanese deinflection input: ${path}`);
    const actual = sha256(bytes);
    if (actual !== expected) {
      throw new Error(`SHA-256 mismatch for ${path}: expected ${expected}, received ${actual}`);
    }
  }

  const legal = await readFile(YOMITAN_LEGAL, "utf8");
  if (!legal.includes("GNU General Public License") || !legal.includes("Yomitan Authors")) {
    throw new Error(`Yomitan license evidence was not recognized: ${YOMITAN_LEGAL}`);
  }
  const jmdictIndex = JSON.parse(await readFile(JMDICT_INDEX, "utf8"));
  if (
    jmdictIndex.revision !== "JMdict.2026-07-28"
    || !String(jmdictIndex.attribution || "").includes("Electronic Dictionaries Research Group")
  ) {
    throw new Error(`JMdict revision or EDRDG attribution was not recognized: ${JMDICT_INDEX}`);
  }
}

function loadTransforms(source) {
  const suffixInflection = (inflected, deinflected, conditionsIn, conditionsOut) => ({
    type: "suffix",
    inflected,
    deinflected,
    conditionsIn,
    conditionsOut,
  });
  const wholeWordInflection = (inflected, deinflected, conditionsIn, conditionsOut) => ({
    type: "wholeWord",
    inflected,
    deinflected,
    conditionsIn,
    conditionsOut,
  });
  const executable = source
    .replace(/^import .*?;\r?\n/mu, "")
    .replace("export const japaneseTransforms =", "const japaneseTransforms =");
  const descriptor = Function(
    "suffixInflection",
    "wholeWordInflection",
    `"use strict";\n${executable}\nreturn japaneseTransforms;`,
  )(suffixInflection, wholeWordInflection);
  const rules = [];
  for (const [family, transform] of Object.entries(descriptor.transforms)) {
    for (let index = 0; index < transform.rules.length; index += 1) {
      const rule = transform.rules[index];
      rules.push([
        family,
        index,
        rule.type,
        rule.inflected,
        rule.deinflected,
        rule.conditionsIn,
        rule.conditionsOut,
      ]);
    }
  }
  return { conditionCount: Object.keys(descriptor.conditions).length, familyCount: Object.keys(descriptor.transforms).length, rules };
}

function normalizeDictionaryCondition(tags) {
  const output = new Set();
  for (const tag of String(tags || "").split(/\s+/u)) {
    if (tag === "v1" || tag.startsWith("v1-")) output.add("v1");
    else if (tag.startsWith("v5")) output.add("v5");
    else if (tag === "vk") output.add("vk");
    else if (tag === "vs" || tag.startsWith("vs-")) output.add("vs");
    else if (tag === "vz") output.add("vz");
    else if (tag === "adj-i" || tag === "adj-ix") output.add("adj-i");
  }
  return [...output].sort();
}

function parseFurigana(text) {
  const pairs = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const first = line.indexOf("|");
    const second = line.indexOf("|", first + 1);
    if (first < 1 || second < first + 2) continue;
    const surface = line.slice(0, first).normalize("NFKC");
    const reading = line.slice(first + 1, second).normalize("NFKC");
    const geometry = line.slice(second + 1);
    if (!JAPANESE_TERM.test(surface) || !HAS_KANJI.test(surface) || !reading || !geometry) continue;
    const key = `${surface}\t${reading}`;
    const existing = pairs.get(key);
    if (existing === undefined) pairs.set(key, geometry);
    else if (existing !== geometry) pairs.set(key, "");
  }
  return pairs;
}

function normalizeKana(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/gu, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60));
}

function parseKanjidicOnReadings(text) {
  const readingsByCharacter = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const [character, rawReading, type] = line.split("\t");
    if (type !== "ja_on" || Array.from(character || "").length !== 1) continue;
    const reading = normalizeKana(rawReading);
    if (!/^[ぁ-んー]+$/u.test(reading)) continue;
    const readings = readingsByCharacter.get(character) || new Set();
    readings.add(reading);
    readingsByCharacter.set(character, readings);
  }
  return readingsByCharacter;
}

function parseJitendexGeometry(source) {
  const arrayStart = source.indexOf("[");
  const arrayEnd = source.lastIndexOf("] as const;");
  if (arrayStart < 0 || arrayEnd < arrayStart) {
    throw new Error(`Could not parse generated Jitendex geometry: ${JITENDEX_GEOMETRY_SOURCE}`);
  }
  const buckets = Function(`"use strict"; return (${source.slice(arrayStart, arrayEnd + 1)});`)();
  const pairs = new Map();
  for (const bucket of buckets) {
    for (const line of bucket.split("\n")) {
      if (!line) continue;
      const separator = line.indexOf("\t");
      if (separator < 1) throw new Error(`Invalid generated Jitendex row: ${line}`);
      const surface = line.slice(0, separator);
      const encodedSegments = line.slice(separator + 1).split("|");
      let cursor = 0;
      const geometry = [];
      let reading = "";
      for (const segment of encodedSegments) {
        const readingSeparator = segment.indexOf(":");
        const length = Number.parseInt(segment.slice(0, readingSeparator), 36);
        const segmentReading = segment.slice(readingSeparator + 1);
        if (readingSeparator < 1 || !Number.isInteger(length) || length < 1 || !segmentReading) {
          throw new Error(`Invalid generated Jitendex segment: ${line}`);
        }
        const end = cursor + length - 1;
        geometry.push(`${cursor}${end > cursor ? `-${end}` : ""}:${segmentReading}`);
        cursor = end + 1;
        reading += segmentReading;
      }
      if (!reading) throw new Error(`Invalid generated Jitendex reading: ${line}`);
      pairs.set(`${surface}\t${reading}`, geometry.join(";"));
    }
  }
  return pairs;
}

function furiganaReconstructs(surface, reading, geometry) {
  const characters = Array.from(surface);
  const segments = new Map();
  for (const rawSegment of String(geometry || "").split(";")) {
    const separator = rawSegment.indexOf(":");
    if (separator < 1) return false;
    const [rawStart, rawEnd = rawStart] = rawSegment.slice(0, separator).split("-");
    const start = Number.parseInt(rawStart, 10);
    const end = Number.parseInt(rawEnd, 10) + 1;
    const segmentReading = rawSegment.slice(separator + 1);
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end <= start
      || end > characters.length
      || !segmentReading
      || segments.has(start)
    ) return false;
    segments.set(start, { end, reading: segmentReading });
  }

  let reconstructed = "";
  for (let index = 0; index < characters.length;) {
    const segment = segments.get(index);
    if (segment) {
      reconstructed += segment.reading;
      index = segment.end;
      continue;
    }
    const character = characters[index];
    if (!/^[ぁ-んー]$/u.test(character)) return false;
    reconstructed += character;
    index += 1;
  }
  return reconstructed === reading;
}

function geometrySegmentCount(geometry) {
  return String(geometry || "").split(";").filter(Boolean).length;
}

function isIterationMarkGeometry(surface, reading, geometry) {
  const characters = Array.from(surface);
  if (
    characters.length < 2
    || characters.length % 2 !== 0
    || geometrySegmentCount(geometry) !== characters.length
    || !characters.every((character, index) =>
      index % 2 === 0 ? /^[〆ヶ一-鿿豈-﫿]$/u.test(character) : character === "々")
  ) return false;
  const coveredIndexes = String(geometry || "").split(";").map((rawSegment) => {
    const [range] = rawSegment.split(":");
    const [start, end = start] = range.split("-").map(Number);
    return start === end ? start : -1;
  });
  return coveredIndexes.every((index, position) => index === position)
    && furiganaReconstructs(surface, reading, geometry);
}

async function loadDictionarySurfaceReadings() {
  const readingsBySurface = new Map();
  const readingsBySequence = new Map();
  const aliases = [];
  const expressionSurfaces = new Set();
  const files = (await readdir(JMDICT_ROOT))
    .filter((name) => /^term_bank_\d+\.json$/u.test(name))
    .sort((left, right) => Number(left.match(/\d+/u)[0]) - Number(right.match(/\d+/u)[0]));

  const addReading = (surface, reading) => {
    if (!JAPANESE_TERM.test(surface) || !HAS_KANJI.test(surface) || !/^[ぁ-んー]+$/u.test(reading)) {
      return;
    }
    const readings = readingsBySurface.get(surface) || new Set();
    readings.add(reading);
    readingsBySurface.set(surface, readings);
  };

  for (const name of files) {
    const bank = JSON.parse(await readFile(resolve(JMDICT_ROOT, name), "utf8"));
    for (const row of bank) {
      const surface = String(row[0] || "").normalize("NFKC");
      const reading = String(row[1] || "").normalize("NFKC");
      const sequence = Number(row[6]);
      const dictionaryTags = new Set(String(row[2] || "").split(/\s+/u));
      if (dictionaryTags.has("exp")) expressionSurfaces.add(surface);

      if (reading) {
        addReading(surface, reading);
        if (Number.isInteger(sequence) && sequence > 0 && /^[ぁ-んー]+$/u.test(reading)) {
          const sequenceReadings = readingsBySequence.get(sequence) || new Set();
          sequenceReadings.add(reading);
          readingsBySequence.set(sequence, sequenceReadings);
        }
      } else if (Number.isInteger(sequence) && sequence < 0 && JAPANESE_TERM.test(surface)) {
        aliases.push({ surface, sequence: -sequence });
      }
    }
  }

  for (const alias of aliases) {
    for (const reading of readingsBySequence.get(alias.sequence) || []) {
      addReading(alias.surface, reading);
    }
  }
  return { readingsBySurface, expressionSurfaces };
}

function readingFallbackGeometry(surface, reading, furiganaPairs, jitendexPairs) {
  const geometry = furiganaPairs.get(`${surface}\t${reading}`);
  if (!geometry || !furiganaReconstructs(surface, reading, geometry)) return undefined;
  const characters = Array.from(surface);
  const kanjiCount = characters.filter((character) => HAS_KANJI.test(character)).length;
  if (kanjiCount === 1 && characters.length === 1) return geometry;
  if (characters.some((character) => /^[ぁ-んー]$/u.test(character))) return geometry;
  if (jitendexPairs.has(`${surface}\t${reading}`)) return geometry;
  return isIterationMarkGeometry(surface, reading, geometry) ? geometry : undefined;
}

function kuromojiReading(token) {
  return normalizeKana(token.reading || token.pronunciation);
}

function kuromojiPartiallyAnchorsGeometry(
  tokenizer,
  kanjidicOnReadings,
  surface,
  reading,
  geometry,
) {
  if (!geometry || !furiganaReconstructs(surface, reading, geometry)) return false;
  const characters = Array.from(surface);
  if (characters.length !== 2 || !characters.every((character) => HAS_KANJI.test(character))) {
    return false;
  }
  const utf16Offsets = [0];
  for (const character of characters) utf16Offsets.push(utf16Offsets.at(-1) + character.length);
  const offsetIndexes = new Map(utf16Offsets.map((offset, index) => [offset, index]));
  const segments = String(geometry).split(";").map((rawSegment) => {
    const separator = rawSegment.indexOf(":");
    const [rawStart, rawEnd = rawStart] = rawSegment.slice(0, separator).split("-");
    return {
      start: Number.parseInt(rawStart, 10),
      end: Number.parseInt(rawEnd, 10) + 1,
      reading: rawSegment.slice(separator + 1),
    };
  });
  if (segments.some((segment) =>
    !Number.isInteger(segment.start)
    || !Number.isInteger(segment.end)
    || segment.end !== segment.start + 1
    || !segment.reading)) return false;

  const tokens = tokenizer.tokenize(surface);
  let cursor = 0;
  let missingHanReadings = 0;
  let matchingHanAnchors = 0;
  for (const token of tokens) {
    const tokenSurface = String(token.surface_form || "");
    const tokenStart = offsetIndexes.get(cursor);
    cursor += tokenSurface.length;
    const tokenEnd = offsetIndexes.get(cursor);
    if (tokenStart === undefined || tokenEnd === undefined) return false;

    const tokenSegments = segments.filter((segment) =>
      segment.start < tokenEnd && segment.end > tokenStart);
    if (tokenSegments.some((segment) =>
      segment.start < tokenStart || segment.end > tokenEnd)) return false;

    let projectedReading = "";
    const segmentsByStart = new Map(tokenSegments.map((segment) => [segment.start, segment]));
    for (let index = tokenStart; index < tokenEnd;) {
      const segment = segmentsByStart.get(index);
      if (segment) {
        projectedReading += segment.reading;
        index = segment.end;
        continue;
      }
      const character = characters[index];
      if (!/^[ぁ-んー]$/u.test(character)) return false;
      projectedReading += character;
      index += 1;
    }

    if (!HAS_KANJI.test(tokenSurface)) continue;
    if (
      Array.from(tokenSurface).length !== 1
      || !kanjidicOnReadings.get(tokenSurface)?.has(projectedReading)
    ) return false;
    const analyzerReading = kuromojiReading(token);
    if (analyzerReading) {
      if (analyzerReading !== projectedReading) return false;
      matchingHanAnchors += 1;
    } else {
      missingHanReadings += 1;
    }
  }

  return cursor === surface.length && missingHanReadings === 1 && matchingHanAnchors === 1;
}

function kuromojiHasReadingGap(tokenizer, surface) {
  return tokenizer.tokenize(surface).some((token) =>
    HAS_KANJI.test(String(token.surface_form || ""))
    && !/^[ぁ-んー]+$/u.test(kuromojiReading(token)));
}

function kuromojiReturnsExactReading(tokenizer, surface, reading) {
  const tokens = tokenizer.tokenize(surface);
  return tokens.length === 1
    && tokens[0].surface_form === surface
    && kuromojiReading(tokens[0]) === reading;
}

async function buildReadingCoverageEntries(
  furiganaPairs,
  jitendexPairs,
  kanjidicOnReadings,
  tokenizer,
) {
  const { readingsBySurface, expressionSurfaces } = await loadDictionarySurfaceReadings();
  const fallbackEntries = [];
  const okuriganaGeometryEntries = [];

  for (const [surface, readings] of readingsBySurface) {
    if (!(expressionSurfaces.has(surface) && crossesGrammaticalBoundary(tokenizer, surface))) {
      if (readings.size === 1) {
        const [reading] = readings;
        const dictionaryGeometry = furiganaPairs.get(`${surface}\t${reading}`);
        const geometry = readingFallbackGeometry(surface, reading, furiganaPairs, jitendexPairs)
          || (kuromojiPartiallyAnchorsGeometry(
            tokenizer,
            kanjidicOnReadings,
            surface,
            reading,
            dictionaryGeometry,
          ) ? dictionaryGeometry : undefined);
        if (geometry && kuromojiHasReadingGap(tokenizer, surface)) {
          fallbackEntries.push([surface, reading, geometry]);
        }
      }
    }

    const characters = Array.from(surface);
    const kanjiCount = characters.filter((character) => HAS_KANJI.test(character)).length;
    const hasKana = characters.some((character) => /^[ぁ-んー]$/u.test(character));
    if (kanjiCount < 2 || !hasKana) continue;
    for (const reading of readings) {
      const geometry = furiganaPairs.get(`${surface}\t${reading}`);
      if (
        geometrySegmentCount(geometry) >= 2
        && furiganaReconstructs(surface, reading, geometry)
        && kuromojiReturnsExactReading(tokenizer, surface, reading)
      ) {
        okuriganaGeometryEntries.push([surface, reading, geometry]);
      }
    }
  }

  fallbackEntries.sort((left, right) => left[0].localeCompare(right[0], "ja"));
  okuriganaGeometryEntries.sort((left, right) =>
    left[0].localeCompare(right[0], "ja") || left[1].localeCompare(right[1], "ja"));
  return { fallbackEntries, okuriganaGeometryEntries };
}

function geometryEvidence(surface, reading, furiganaPairs, jitendexPairs) {
  const characters = Array.from(surface);
  const kanjiCount = characters.filter((character) => HAS_KANJI.test(character)).length;
  if (kanjiCount === 1 && characters.length === 1) {
    const geometry = furiganaPairs.get(`${surface}\t${reading}`) || `0:${reading}`;
    return furiganaReconstructs(surface, reading, geometry)
      ? { evidence: "singleKanji", geometry }
      : undefined;
  }
  if (characters.some((character) => /^[ぁ-んー]$/u.test(character))) {
    const geometry = furiganaPairs.get(`${surface}\t${reading}`);
    return furiganaReconstructs(surface, reading, geometry)
      ? { evidence: "okurigana", geometry }
      : undefined;
  }
  const geometry = jitendexPairs.get(`${surface}\t${reading}`);
  return furiganaReconstructs(surface, reading, geometry)
    ? { evidence: "jitendex", geometry }
    : undefined;
}

async function buildKuromojiTokenizer() {
  const dictionaryPath = fileURLToPath(
    new URL("../../node_modules/kuromoji/dict/", import.meta.url),
  ).replaceAll("\\", "/");
  return new Promise((resolveTokenizer, reject) => {
    kuromoji.builder({ dicPath: dictionaryPath }).build((error, tokenizer) =>
      error ? reject(error) : resolveTokenizer(tokenizer));
  });
}

function crossesGrammaticalBoundary(tokenizer, surface) {
  return tokenizer.tokenize(surface).some((token) =>
    token.pos === "助詞" || token.pos === "助動詞");
}

async function buildLemmaEntries(furiganaPairs, jitendexPairs, tokenizer) {
  const candidates = new Map();
  const expressionSurfaces = new Set();
  const files = (await readdir(JMDICT_ROOT))
    .filter((name) => /^term_bank_\d+\.json$/u.test(name))
    .sort((left, right) => Number(left.match(/\d+/u)[0]) - Number(right.match(/\d+/u)[0]));
  const termBankHash = createHash("sha256");
  for (const name of files) {
    const bytes = await readFile(resolve(JMDICT_ROOT, name));
    termBankHash.update(bytes);
    const bank = JSON.parse(bytes.toString("utf8"));
    for (const row of bank) {
      const surface = String(row[0] || "").normalize("NFKC");
      const reading = String(row[1] || surface).normalize("NFKC");
      const conditions = normalizeDictionaryCondition(row[3]);
      const dictionaryTags = new Set(String(row[2] || "").split(/\s+/u));
      if (dictionaryTags.has("exp")) expressionSurfaces.add(surface);
      if (
        conditions.length === 0 ||
        !JAPANESE_TERM.test(surface) ||
        !HAS_KANJI.test(surface) ||
        !/^[ぁ-んー]+$/u.test(reading)
      ) continue;
      const geometry = geometryEvidence(surface, reading, furiganaPairs, jitendexPairs);
      const key = surface;
      let entry = candidates.get(key);
      if (!entry) {
        entry = new Map();
        candidates.set(key, entry);
      }
      const conditionSet = entry.get(reading) || { conditions: new Set(), geometry };
      if (!conditionSet.geometry && geometry) conditionSet.geometry = geometry;
      for (const condition of conditions) conditionSet.conditions.add(condition);
      entry.set(reading, conditionSet);
    }
  }
  const actualTermBankHash = termBankHash.digest("hex");
  if (actualTermBankHash !== EXPECTED_TERM_BANK_SHA256) {
    throw new Error(
      `JMdict extracted term-bank SHA-256 mismatch: expected ${EXPECTED_TERM_BANK_SHA256}, received ${actualTermBankHash}`,
    );
  }

  const entries = [];
  const rejectedEntries = [];
  for (const [surface, readings] of candidates) {
    if (expressionSurfaces.has(surface) && crossesGrammaticalBoundary(tokenizer, surface)) continue;
    if (readings.size !== 1) {
      rejectedEntries.push([surface, "ambiguous"]);
      continue;
    }
    const [[reading, value]] = readings;
    if (!value.geometry) {
      rejectedEntries.push([surface, "geometryMissing"]);
      continue;
    }
    entries.push([
      surface,
      reading,
      [...value.conditions].sort().join(","),
      value.geometry.evidence,
      value.geometry.geometry,
    ]);
  }
  entries.sort((left, right) => left[0].localeCompare(right[0], "ja"));
  rejectedEntries.sort((left, right) => left[0].localeCompare(right[0], "ja"));
  return { entries, rejectedEntries };
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function render({
  transforms,
  entries,
  rejectedEntries,
  fallbackEntries,
  okuriganaGeometryEntries,
  sourceHashes,
}) {
  const buckets = Array.from({ length: BUCKET_COUNT }, () => []);
  for (const entry of entries) buckets[fnv1a(entry[0]) & (BUCKET_COUNT - 1)].push(entry.join("\t"));
  const bucketSource = buckets.map((rows) => `\n${rows.join("\n")}\n`);
  const rejectedBuckets = Array.from({ length: BUCKET_COUNT }, () => []);
  for (const entry of rejectedEntries) {
    rejectedBuckets[fnv1a(entry[0]) & (BUCKET_COUNT - 1)].push(entry.join("\t"));
  }
  const rejectedBucketSource = rejectedBuckets.map((rows) => `\n${rows.join("\n")}\n`);
  const fallbackBuckets = Array.from({ length: BUCKET_COUNT }, () => []);
  for (const entry of fallbackEntries) {
    fallbackBuckets[fnv1a(entry[0]) & (BUCKET_COUNT - 1)].push(entry.join("\t"));
  }
  const fallbackBucketSource = fallbackBuckets.map((rows) => `\n${rows.join("\n")}\n`);
  const okuriganaGeometryBuckets = Array.from({ length: BUCKET_COUNT }, () => []);
  for (const entry of okuriganaGeometryEntries) {
    okuriganaGeometryBuckets[fnv1a(entry[0]) & (BUCKET_COUNT - 1)].push(entry.join("\t"));
  }
  const okuriganaGeometryBucketSource = okuriganaGeometryBuckets.map(
    (rows) => `\n${rows.join("\n")}\n`,
  );
  return `/*\n * SPDX-License-Identifier: AGPL-3.0-only AND CC-BY-SA-4.0\n *\n * Generated from Yomitan 26.7.21.0 transform definitions (GPL-3.0-or-later).\n * Copyright (C) 2024-2026 Yomitan Authors.\n * JMdict.2026-07-28, JmdictFurigana, and KANJIDIC2-derived dictionary data is\n * CC BY-SA 4.0 and includes material from EDRDG. Do not edit this file by hand.\n */\n\nexport const JAPANESE_DEINFLECTION_METADATA = ${JSON.stringify({
    yomitanRelease: "26.7.21.0",
    jmdictRevision: "JMdict.2026-07-28",
    ...sourceHashes,
    transformFamilies: transforms.familyCount,
    transformRules: transforms.rules.length,
    lemmaEntries: entries.length,
    rejectedLemmaEntries: rejectedEntries.length,
    readingFallbackEntries: fallbackEntries.length,
    okuriganaGeometryEntries: okuriganaGeometryEntries.length,
  }, null, 2)} as const;\n\nexport const JAPANESE_DEINFLECTION_RULES = ${JSON.stringify(transforms.rules)} as const;\n\nexport const JAPANESE_DEINFLECTION_LEMMA_BUCKETS = ${JSON.stringify(bucketSource)} as const;\n\nexport const JAPANESE_DEINFLECTION_REJECTED_LEMMA_BUCKETS = ${JSON.stringify(rejectedBucketSource)} as const;\n\nexport const JAPANESE_READING_FALLBACK_BUCKETS = ${JSON.stringify(fallbackBucketSource)} as const;\n\nexport const JAPANESE_OKURIGANA_GEOMETRY_BUCKETS = ${JSON.stringify(okuriganaGeometryBucketSource)} as const;\n`;
}

await verifyInputs();
const transformText = await readFile(TRANSFORMS_SOURCE, "utf8");
const transforms = loadTransforms(transformText);
const furiganaCompressed = await readFile(FURIGANA_SOURCE);
const furiganaPairs = parseFurigana(gunzipSync(furiganaCompressed).toString("utf8"));
const jitendexPairs = parseJitendexGeometry(await readFile(JITENDEX_GEOMETRY_SOURCE, "utf8"));
const kanjidicOnReadings = parseKanjidicOnReadings(
  gunzipSync(await readFile(KANJIDIC_READING_SOURCE)).toString("utf8"),
);
const tokenizer = await buildKuromojiTokenizer();
const { entries, rejectedEntries } = await buildLemmaEntries(
  furiganaPairs,
  jitendexPairs,
  tokenizer,
);
const { fallbackEntries, okuriganaGeometryEntries } = await buildReadingCoverageEntries(
  furiganaPairs,
  jitendexPairs,
  kanjidicOnReadings,
  tokenizer,
);
const output = render({
  transforms,
  entries,
  rejectedEntries,
  fallbackEntries,
  okuriganaGeometryEntries,
  sourceHashes: {
    yomitanArchiveSha256: EXPECTED_HASHES.get(YOMITAN_ARCHIVE),
    yomitanTransformSourceSha256: EXPECTED_HASHES.get(TRANSFORMS_SOURCE),
    yomitanLegalSha256: EXPECTED_HASHES.get(YOMITAN_LEGAL),
    jmdictArchiveSha256: EXPECTED_HASHES.get(JMDICT_ARCHIVE),
    jmdictIndexSha256: EXPECTED_HASHES.get(JMDICT_INDEX),
    jmdictTermBanksSha256: EXPECTED_TERM_BANK_SHA256,
    jmdictFuriganaSha256: EXPECTED_HASHES.get(FURIGANA_SOURCE),
    jitendexGeometrySha256: EXPECTED_HASHES.get(JITENDEX_GEOMETRY_SOURCE),
    kanjidicReadingsSha256: EXPECTED_HASHES.get(KANJIDIC_READING_SOURCE),
  },
});
const compressedBytes = gzipSync(output, { level: 9 }).length;
if (compressedBytes > 2 * 1024 * 1024) {
  throw new Error(
    `Generated deinflection data exceeds 2 MiB gzip: ${compressedBytes} bytes `
    + `(${fallbackEntries.length} fallbacks, ${okuriganaGeometryEntries.length} geometries)`,
  );
}

if (process.argv.includes("--check")) {
  const existing = await readFile(OUTPUT, "utf8").catch(() => "");
  if (existing !== output) throw new Error(`Generated deinflection data is stale: ${OUTPUT}`);
} else {
  await writeFile(OUTPUT, output, "utf8");
}

console.log(JSON.stringify({
  transformFamilies: transforms.familyCount,
  transformRules: transforms.rules.length,
  lemmaEntries: entries.length,
  rejectedLemmaEntries: rejectedEntries.length,
  readingFallbackEntries: fallbackEntries.length,
  okuriganaGeometryEntries: okuriganaGeometryEntries.length,
  utf8Bytes: Buffer.byteLength(output),
  gzipBytes: compressedBytes,
}, null, 2));
