/*
 * Recursive transform semantics are adapted from Yomitan 26.7.21.0
 * LanguageTransformer (GPL-3.0-or-later), Copyright (C) Yomitan Authors.
 * This AGPL project keeps only generated transform rules and a compact
 * attributed dictionary-evidence index, never Yomitan's scanner.
 */

import { normalizeJapaneseKana } from "./JapaneseKana.ts";
import type * as GeneratedJapaneseDeinflectionData from "./GeneratedJapaneseDeinflectionData.ts";

type GeneratedData = typeof GeneratedJapaneseDeinflectionData;
export type JapaneseDeinflectionRuleTuple = readonly [
  family: string,
  ruleIndex: number,
  type: "suffix" | "wholeWord",
  inflected: string,
  deinflected: string,
  conditionsIn: readonly string[],
  conditionsOut: readonly string[],
];
type RuleTuple = JapaneseDeinflectionRuleTuple;

export type JapaneseDeinflectionTraceFrame = {
  family: string;
  ruleIndex: number;
  type: "suffix" | "wholeWord";
  inflected: string;
  deinflected: string;
  source: string;
};

export type JapaneseDeinflectionCandidate = {
  lemma: string;
  lemmaReading: string;
  projectedReading: string;
  geometryEvidence: "singleKanji" | "okurigana" | "jitendex";
  conditions: readonly string[];
  trace: readonly JapaneseDeinflectionTraceFrame[];
};

export type JapaneseDeinflectionResult = {
  candidates: readonly JapaneseDeinflectionCandidate[];
  rejectedAmbiguous: number;
  rejectedGeometry: number;
  budgetExceeded: boolean;
};

export type JapaneseDeinflectionLimits = {
  maxStates?: number;
  maxDepth?: number;
  maxCandidates?: number;
};

const DEFAULT_MAX_STATES = 256;
const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_CANDIDATES = 32;
const MAX_SURFACE_CACHE_ENTRIES = 2_048;
const KANA_ONLY = /^[ぁ-んー]+$/u;
const SAFE_GEOMETRY_EVIDENCE = new Set(["singleKanji", "okurigana", "jitendex"]);

let loadedData: GeneratedData | undefined;
let loadingData: Promise<GeneratedData> | undefined;
let loadGeneration = 0;
let rulesByFinalCharacter: ReadonlyMap<string, readonly RuleTuple[]> | undefined;
const surfaceCache = new Map<string, JapaneseDeinflectionResult>();

export async function loadJapaneseDeinflectionData(): Promise<GeneratedData> {
  if (loadedData) return loadedData;
  const generation = loadGeneration;
  loadingData ??= import("./GeneratedJapaneseDeinflectionData.ts");
  const data = await loadingData;
  if (generation === loadGeneration) loadedData = data;
  return data;
}

export function releaseJapaneseDeinflectionData(): void {
  loadGeneration += 1;
  loadedData = undefined;
  loadingData = undefined;
  rulesByFinalCharacter = undefined;
  surfaceCache.clear();
}

function getRulesByFinalCharacter(rules: readonly RuleTuple[]): ReadonlyMap<string, readonly RuleTuple[]> {
  if (rulesByFinalCharacter) return rulesByFinalCharacter;
  const mutable = new Map<string, RuleTuple[]>();
  for (const rule of rules) {
    const finalCharacter = Array.from(rule[3]).at(-1);
    if (!finalCharacter) continue;
    const bucket = mutable.get(finalCharacter);
    if (bucket) bucket.push(rule);
    else mutable.set(finalCharacter, [rule]);
  }
  rulesByFinalCharacter = mutable;
  return rulesByFinalCharacter;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function conditionLeaves(condition: string): readonly string[] {
  switch (condition) {
    case "v": return ["v1d", "v1p", "v5d", "v5ss", "v5sp", "vk", "vs", "vz"];
    case "v1": return ["v1d", "v1p"];
    case "v5": return ["v5d", "v5ss", "v5sp"];
    case "v5s": return ["v5ss", "v5sp"];
    default: return [condition];
  }
}

function expandConditions(conditions: readonly string[]): Set<string> {
  const expanded = new Set<string>();
  for (const condition of conditions) {
    for (const leaf of conditionLeaves(condition)) expanded.add(leaf);
  }
  return expanded;
}

function conditionsMatch(current: ReadonlySet<string>, required: readonly string[]): boolean {
  if (current.size === 0) return true;
  for (const condition of required) {
    for (const leaf of conditionLeaves(condition)) {
      if (current.has(leaf)) return true;
    }
  }
  return false;
}

function lookupLemma(data: GeneratedData, surface: string): {
  reading: string;
  conditions: readonly string[];
  geometryEvidence: JapaneseDeinflectionCandidate["geometryEvidence"];
} | undefined {
  const buckets = data.JAPANESE_DEINFLECTION_LEMMA_BUCKETS as readonly string[];
  const bucket = buckets[fnv1a(surface) & (buckets.length - 1)];
  const marker = `\n${surface}\t`;
  const start = bucket.indexOf(marker);
  if (start < 0) return undefined;
  const valueStart = start + marker.length;
  const end = bucket.indexOf("\n", valueStart);
  const [reading, rawConditions, rawGeometryEvidence] = bucket.slice(valueStart, end).split("\t");
  if (!reading || !rawConditions || !SAFE_GEOMETRY_EVIDENCE.has(rawGeometryEvidence)) return undefined;
  return {
    reading,
    conditions: rawConditions.split(","),
    geometryEvidence: rawGeometryEvidence as JapaneseDeinflectionCandidate["geometryEvidence"],
  };
}

function lookupRejectedLemma(
  data: GeneratedData,
  surface: string,
): "ambiguous" | "geometryMissing" | undefined {
  const buckets = data.JAPANESE_DEINFLECTION_REJECTED_LEMMA_BUCKETS as readonly string[];
  const bucket = buckets[fnv1a(surface) & (buckets.length - 1)];
  const marker = `\n${surface}\t`;
  const start = bucket.indexOf(marker);
  if (start < 0) return undefined;
  const valueStart = start + marker.length;
  const end = bucket.indexOf("\n", valueStart);
  const status = bucket.slice(valueStart, end);
  return status === "ambiguous" || status === "geometryMissing" ? status : undefined;
}

export function deinflectJapaneseRuleSurface(text: string, rule: RuleTuple): string | undefined {
  const [, , type, inflected, deinflected] = rule;
  if (type === "wholeWord") return text === inflected ? deinflected : undefined;
  if (!text.endsWith(inflected)) return undefined;
  return `${text.slice(0, text.length - inflected.length)}${deinflected}`;
}

export function reinflectJapaneseRuleSurface(text: string, rule: RuleTuple): string | undefined {
  const [, , type, inflected, deinflected] = rule;
  if (type === "wholeWord") return text === deinflected ? inflected : undefined;
  if (!text.endsWith(deinflected)) return undefined;
  return `${text.slice(0, text.length - deinflected.length)}${inflected}`;
}

function projectReading(
  lemmaReading: string,
  trace: readonly JapaneseDeinflectionTraceFrame[],
): string | undefined {
  let reading = lemmaReading;
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const frame = trace[index];
    const inflected = normalizeJapaneseKana(frame.inflected);
    const deinflected = normalizeJapaneseKana(frame.deinflected);
    if (!KANA_ONLY.test(inflected) || !KANA_ONLY.test(deinflected)) return undefined;
    if (frame.type === "wholeWord") {
      if (reading !== deinflected) return undefined;
      reading = inflected;
      continue;
    }
    if (!reading.endsWith(deinflected)) return undefined;
    reading = `${reading.slice(0, reading.length - deinflected.length)}${inflected}`;
  }
  return reading;
}

function reinflectSurface(
  lemma: string,
  trace: readonly JapaneseDeinflectionTraceFrame[],
): string | undefined {
  let surface = lemma;
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const frame = trace[index];
    if (frame.type === "wholeWord") {
      if (surface !== frame.deinflected) return undefined;
      surface = frame.inflected;
      continue;
    }
    if (!surface.endsWith(frame.deinflected)) return undefined;
    surface = `${surface.slice(0, surface.length - frame.deinflected.length)}${frame.inflected}`;
  }
  return surface;
}

export async function deinflectJapaneseSurface(
  source: string,
  limits: JapaneseDeinflectionLimits = {},
): Promise<JapaneseDeinflectionResult> {
  const usesDefaultLimits = limits.maxStates === undefined
    && limits.maxDepth === undefined
    && limits.maxCandidates === undefined;
  const cached = usesDefaultLimits ? surfaceCache.get(source) : undefined;
  if (cached) return cached;
  const data = await loadJapaneseDeinflectionData();
  const rules = data.JAPANESE_DEINFLECTION_RULES as readonly RuleTuple[];
  const indexedRules = getRulesByFinalCharacter(rules);
  const maxStates = Math.max(1, limits.maxStates ?? DEFAULT_MAX_STATES);
  const maxDepth = Math.max(0, limits.maxDepth ?? DEFAULT_MAX_DEPTH);
  const maxCandidates = Math.max(1, limits.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  const states: Array<{
    text: string;
    conditions: Set<string>;
    trace: JapaneseDeinflectionTraceFrame[];
  }> = [{ text: source, conditions: new Set(), trace: [] }];
  const visited = new Set([`${source}\t`]);
  const candidates = new Map<string, JapaneseDeinflectionCandidate>();
  let rejectedAmbiguous = 0;
  let rejectedGeometry = 0;
  let budgetExceeded = false;

  search: for (let cursor = 0; cursor < states.length; cursor += 1) {
    const state = states[cursor];
    if (state.trace.length > 0) {
      const rejectedLemma = lookupRejectedLemma(data, state.text);
      if (rejectedLemma === "ambiguous") rejectedAmbiguous += 1;
      else if (rejectedLemma === "geometryMissing") rejectedGeometry += 1;
      const lemma = lookupLemma(data, state.text);
      if (lemma && conditionsMatch(state.conditions, lemma.conditions)) {
        const projectedReading = projectReading(lemma.reading, state.trace);
        const reinflectedSurface = reinflectSurface(state.text, state.trace);
        if (projectedReading && reinflectedSurface === source) {
          const key = `${state.text}\t${projectedReading}`;
          const existing = candidates.get(key);
          if (!existing || state.trace.length < existing.trace.length) {
            if (!existing && candidates.size >= maxCandidates) {
              budgetExceeded = true;
              break search;
            }
            candidates.set(key, {
              lemma: state.text,
              lemmaReading: lemma.reading,
              projectedReading,
              geometryEvidence: lemma.geometryEvidence,
              conditions: lemma.conditions,
              trace: state.trace,
            });
          }
        } else {
          rejectedGeometry += 1;
        }
      }
    }

    if (state.trace.length >= maxDepth) {
      const applicableRules = indexedRules.get(state.text.at(-1) || "") || [];
      const hasUnvisitedExpansion = applicableRules.some((rule) => {
        if (!conditionsMatch(state.conditions, rule[5])) return false;
        const nextText = deinflectJapaneseRuleSurface(state.text, rule);
        if (!nextText || nextText === state.text) return false;
        const nextConditions = expandConditions(rule[6]);
        const key = `${nextText}\t${[...nextConditions].sort().join(",")}`;
        return !visited.has(key);
      });
      if (hasUnvisitedExpansion) {
        budgetExceeded = true;
        break search;
      }
      continue;
    }
    const applicableRules = indexedRules.get(state.text.at(-1) || "") || [];
    for (const rule of applicableRules) {
      const conditionsIn = rule[5];
      if (!conditionsMatch(state.conditions, conditionsIn)) continue;
      const nextText = deinflectJapaneseRuleSurface(state.text, rule);
      if (!nextText || nextText === state.text) continue;
      const nextConditions = expandConditions(rule[6]);
      const key = `${nextText}\t${[...nextConditions].sort().join(",")}`;
      if (visited.has(key)) continue;
      if (states.length >= maxStates) {
        budgetExceeded = true;
        break search;
      }
      visited.add(key);
      states.push({
        text: nextText,
        conditions: nextConditions,
        trace: [...state.trace, {
          family: rule[0],
          ruleIndex: rule[1],
          type: rule[2],
          inflected: rule[3],
          deinflected: rule[4],
          source: state.text,
        }],
      });
    }
  }

  const result = {
    candidates: [...candidates.values()],
    rejectedAmbiguous,
    rejectedGeometry,
    budgetExceeded,
  };
  if (usesDefaultLimits) {
    surfaceCache.set(source, result);
    if (surfaceCache.size > MAX_SURFACE_CACHE_ENTRIES) {
      surfaceCache.delete(surfaceCache.keys().next().value!);
    }
  }
  return result;
}
