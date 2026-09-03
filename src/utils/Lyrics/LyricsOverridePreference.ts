import {
  clearAllManualLyricsSelections,
  clearManualLyricsSelection,
  getManualLyricsSelection,
} from "./ManualLyricsSelection.ts";
import type { CompleteLyricsSearchOverrides } from "./ManualLyricsSearch.ts";
import { isLyricsRevisionCacheCompatible, LyricsRevisionStore } from "./LyricsRevisionCache.ts";

export const LYRICS_OVERRIDE_SCHEMA_VERSION = 1;

export type LyricsOverrideLifetime = "persistent" | "temporary";

type LyricsOverrideBase = {
  schemaVersion: typeof LYRICS_OVERRIDE_SCHEMA_VERSION;
  preferenceId: string;
  trackUri: string;
  lifetime: LyricsOverrideLifetime;
};

export type AutomaticLyricsOverride = LyricsOverrideBase & {
  kind: "automatic";
};

export type LocalLyricsOverride = LyricsOverrideBase & {
  kind: "local";
  rawSource?: unknown;
};

export type CandidateLyricsOverride = LyricsOverrideBase & {
  kind: "candidate";
  revisionId: string;
  automaticRevisionId: string | null;
  searchOverrides?: CompleteLyricsSearchOverrides;
  snapshot: Record<string, unknown>;
};

export type LyricsOverridePreference =
  | AutomaticLyricsOverride
  | LocalLyricsOverride
  | CandidateLyricsOverride;

export type LyricsCandidateOverrideReset = {
  affected: boolean;
  revisionIds: string[];
};

export type LyricsOverrideStorage = {
  get(trackUri: string): Promise<unknown>;
  put(trackUri: string, preference: LyricsOverridePreference): Promise<void>;
  remove(trackUri: string): Promise<void>;
  removeCandidates(): Promise<string[]>;
};

const databaseStorage: LyricsOverrideStorage = {
  async get(trackUri) {
    const { dbPromise, ObjectStores } = await import("../db.ts");
    return (await dbPromise).get(ObjectStores.LyricsOverrides, trackUri);
  },
  async put(trackUri, preference) {
    const { dbPromise, ObjectStores } = await import("../db.ts");
    await (await dbPromise).put(ObjectStores.LyricsOverrides, preference, trackUri);
  },
  async remove(trackUri) {
    const { dbPromise, ObjectStores } = await import("../db.ts");
    await (await dbPromise).delete(ObjectStores.LyricsOverrides, trackUri);
  },
  async removeCandidates() {
    const { dbPromise, ObjectStores } = await import("../db.ts");
    const database = await dbPromise;
    const transaction = database.transaction(ObjectStores.LyricsOverrides, "readwrite");
    const removed: string[] = [];
    let cursor = await transaction.store.openCursor();
    while (cursor) {
      if (
        typeof cursor.key === "string" &&
        normalizeLyricsOverridePreference(cursor.value, cursor.key)?.kind === "candidate"
      ) {
        removed.push(cursor.key);
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await transaction.done;
    return removed;
  },
};

function preferenceId(): string {
  return globalThis.crypto.randomUUID();
}

function validBase(value: Record<string, unknown>, trackUri: string): boolean {
  return (
    value.schemaVersion === LYRICS_OVERRIDE_SCHEMA_VERSION &&
    value.trackUri === trackUri &&
    typeof value.preferenceId === "string" &&
    value.preferenceId.length > 0 &&
    (value.lifetime === "persistent" || value.lifetime === "temporary")
  );
}

export function normalizeLyricsOverridePreference(
  value: unknown,
  trackUri: string
): LyricsOverridePreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (!validBase(entry, trackUri)) return null;
  const base = {
    schemaVersion: LYRICS_OVERRIDE_SCHEMA_VERSION,
    preferenceId: entry.preferenceId as string,
    trackUri,
    lifetime: entry.lifetime as LyricsOverrideLifetime,
  };
  if (entry.kind === "automatic") return { ...base, kind: "automatic" };
  if (entry.kind === "local") {
    return {
      ...base,
      kind: "local",
      ...(entry.rawSource === undefined ? {} : { rawSource: entry.rawSource }),
    };
  }
  if (
    entry.kind !== "candidate" ||
    typeof entry.revisionId !== "string" ||
    entry.revisionId.length === 0 ||
    !(
      entry.automaticRevisionId === null ||
      (typeof entry.automaticRevisionId === "string" && entry.automaticRevisionId.length > 0)
    ) ||
    !entry.snapshot ||
    typeof entry.snapshot !== "object" ||
    Array.isArray(entry.snapshot)
  )
    return null;
  const rawOverrides =
    entry.searchOverrides &&
    typeof entry.searchOverrides === "object" &&
    !Array.isArray(entry.searchOverrides)
      ? (entry.searchOverrides as Record<string, unknown>)
      : null;
  const searchOverrides =
    rawOverrides &&
    typeof rawOverrides.title === "string" &&
    typeof rawOverrides.artist === "string" &&
    rawOverrides.title.trim() &&
    rawOverrides.artist.trim()
      ? { title: rawOverrides.title.trim(), artist: rawOverrides.artist.trim() }
      : undefined;
  return {
    ...base,
    kind: "candidate",
    revisionId: entry.revisionId,
    automaticRevisionId: entry.automaticRevisionId as string | null,
    ...(searchOverrides ? { searchOverrides } : {}),
    snapshot: entry.snapshot as Record<string, unknown>,
  };
}

function durablePreference(preference: LyricsOverridePreference): LyricsOverridePreference {
  if (preference.kind !== "local") return { ...preference, lifetime: "persistent" };
  const { rawSource: _rawSource, ...stored } = preference;
  return { ...stored, lifetime: "persistent" };
}

export class LyricsOverridePreferenceController {
  private readonly session = new Map<string, LyricsOverridePreference>();
  private readonly loaded = new Set<string>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly storage: LyricsOverrideStorage;

  constructor(storage: LyricsOverrideStorage) {
    this.storage = storage;
  }

  async get(trackUri: string): Promise<LyricsOverridePreference | null> {
    const current = this.session.get(trackUri);
    if (current) return structuredClone(current);
    if (this.loaded.has(trackUri)) return null;
    const stored = await this.storage.get(trackUri);
    this.loaded.add(trackUri);
    const normalized = normalizeLyricsOverridePreference(stored, trackUri);
    if (!normalized || normalized.lifetime !== "persistent") {
      if (stored !== undefined) await this.storage.remove(trackUri);
      return null;
    }
    this.session.set(trackUri, normalized);
    return structuredClone(normalized);
  }

  async set(preference: LyricsOverridePreference): Promise<void> {
    const normalized = normalizeLyricsOverridePreference(preference, preference.trackUri);
    if (!normalized) throw new TypeError("Invalid lyrics override preference");
    this.setSession(normalized);
    if (normalized.lifetime === "temporary") return;
    const stored = durablePreference(normalized);
    const previous = this.writes.get(normalized.trackUri) ?? Promise.resolve();
    const write = previous
      .catch(() => {})
      .then(() => this.storage.put(normalized.trackUri, stored));
    this.writes.set(normalized.trackUri, write);
    try {
      await write;
    } finally {
      if (this.writes.get(normalized.trackUri) === write) {
        this.writes.delete(normalized.trackUri);
      }
    }
  }

  setSession(preference: LyricsOverridePreference): void {
    const normalized = normalizeLyricsOverridePreference(preference, preference.trackUri);
    if (!normalized) throw new TypeError("Invalid lyrics override preference");
    this.loaded.add(normalized.trackUri);
    this.session.set(normalized.trackUri, structuredClone(normalized));
  }

  clearSession(): void {
    this.session.clear();
    this.loaded.clear();
  }

  async resetCandidate(trackUri: string): Promise<LyricsCandidateOverrideReset> {
    const pendingWrite = this.writes.get(trackUri);
    if (pendingWrite) await pendingWrite;

    const sessionPreference = this.session.get(trackUri);
    const storedPreference = normalizeLyricsOverridePreference(
      await this.storage.get(trackUri),
      trackUri,
    );
    const activePreference = sessionPreference ?? storedPreference;
    if (activePreference?.kind !== "candidate") {
      return { affected: false, revisionIds: [] };
    }

    const revisionIds = [
      activePreference.revisionId,
      activePreference.automaticRevisionId,
    ].filter((revisionId): revisionId is string => typeof revisionId === "string");

    if (
      sessionPreference?.kind === "candidate" &&
      storedPreference &&
      storedPreference.kind !== "candidate"
    ) {
      this.loaded.add(trackUri);
      this.session.set(trackUri, structuredClone(storedPreference));
      return { affected: true, revisionIds: [...new Set(revisionIds)] };
    }

    await this.set(automaticLyricsOverride(trackUri));
    return { affected: true, revisionIds: [...new Set(revisionIds)] };
  }

  async resetCandidates(): Promise<string[]> {
    await Promise.all(this.writes.values());
    const sessionCandidateUris = [...this.session]
      .filter(([, preference]) => preference.kind === "candidate")
      .map(([trackUri]) => trackUri);
    const storedPreferences = new Map(
      await Promise.all(
        sessionCandidateUris.map(async (trackUri) => [
          trackUri,
          normalizeLyricsOverridePreference(await this.storage.get(trackUri), trackUri),
        ] as const),
      ),
    );
    const removedDurableCandidates = new Set(await this.storage.removeCandidates());
    const affected = new Set([...removedDurableCandidates, ...sessionCandidateUris]);
    const automaticUris: string[] = [];
    for (const trackUri of affected) {
      const storedPreference = storedPreferences.get(trackUri);
      if (
        !removedDurableCandidates.has(trackUri) &&
        storedPreference &&
        storedPreference.kind !== "candidate"
      ) {
        this.loaded.add(trackUri);
        this.session.set(trackUri, structuredClone(storedPreference));
      } else {
        automaticUris.push(trackUri);
      }
    }
    await Promise.all(
      automaticUris.map((trackUri) => this.set(automaticLyricsOverride(trackUri))),
    );
    return [...affected];
  }

  isCurrent(trackUri: string, preferenceId: string): boolean {
    return this.session.get(trackUri)?.preferenceId === preferenceId;
  }

  clearIfCurrent(trackUri: string, preferenceId: string): void {
    if (this.isCurrent(trackUri, preferenceId)) this.session.delete(trackUri);
  }
}

const preferences = new LyricsOverridePreferenceController(databaseStorage);
const legacyMigrations = new Map<string, Promise<LyricsOverridePreference | null>>();

export function automaticLyricsOverride(trackUri: string): AutomaticLyricsOverride {
  return {
    schemaVersion: LYRICS_OVERRIDE_SCHEMA_VERSION,
    preferenceId: preferenceId(),
    trackUri,
    lifetime: "persistent",
    kind: "automatic",
  };
}

export function localLyricsOverride(
  trackUri: string,
  lifetime: LyricsOverrideLifetime,
  rawSource?: unknown
): LocalLyricsOverride {
  return {
    schemaVersion: LYRICS_OVERRIDE_SCHEMA_VERSION,
    preferenceId: preferenceId(),
    trackUri,
    lifetime,
    kind: "local",
    ...(rawSource === undefined ? {} : { rawSource }),
  };
}

export function candidateLyricsOverride(
  trackUri: string,
  lifetime: LyricsOverrideLifetime,
  value: Omit<CandidateLyricsOverride, keyof LyricsOverrideBase | "kind">
): CandidateLyricsOverride {
  return {
    schemaVersion: LYRICS_OVERRIDE_SCHEMA_VERSION,
    preferenceId: preferenceId(),
    trackUri,
    lifetime,
    kind: "candidate",
    ...value,
  };
}

export async function setLyricsOverridePreference(
  preference: LyricsOverridePreference
): Promise<void> {
  await preferences.set(preference);
}

export function setLyricsOverrideSessionPreference(preference: LyricsOverridePreference): void {
  preferences.setSession(preference);
}

export function isCurrentLyricsOverridePreference(trackUri: string, preferenceId: string): boolean {
  return preferences.isCurrent(trackUri, preferenceId);
}

export function clearLyricsOverrideSessionIfCurrent(trackUri: string, preferenceId: string): void {
  preferences.clearIfCurrent(trackUri, preferenceId);
}

export function resetLyricsCandidateOverride(
  trackUri: string,
): Promise<LyricsCandidateOverrideReset> {
  return preferences.resetCandidate(trackUri);
}

export async function resetLyricsCandidateOverrides(): Promise<string[]> {
  const affected = await preferences.resetCandidates();
  await clearAllManualLyricsSelections();
  for (const trackUri of affected) legacyMigrations.delete(trackUri);
  return affected;
}

async function migrateLegacyPreference(trackUri: string): Promise<LyricsOverridePreference | null> {
  const selection = await getManualLyricsSelection(trackUri);
  if (selection) {
    const cached = await LyricsRevisionStore.GetItem(selection.revisionId);
    if (isLyricsRevisionCacheCompatible(cached, selection.revisionId) && cached?.uri === trackUri) {
      const active = await preferences.get(trackUri);
      if (active) {
        await clearManualLyricsSelection(trackUri);
        return active;
      }
      const migrated = candidateLyricsOverride(trackUri, "persistent", {
        revisionId: selection.revisionId,
        automaticRevisionId: selection.automaticRevisionId,
        ...(selection.searchOverrides ? { searchOverrides: selection.searchOverrides } : {}),
        snapshot: structuredClone(cached),
      });
      await preferences.set(migrated);
      await clearManualLyricsSelection(trackUri);
      return migrated;
    }
    await clearManualLyricsSelection(trackUri);
  }
  const { LocalLyricsManager } = await import("./manager/index.ts");
  const rawSource = await LocalLyricsManager.getRaw(trackUri);
  if (rawSource !== null) {
    const active = await preferences.get(trackUri);
    if (active) return active;
    const migrated = localLyricsOverride(trackUri, "persistent");
    await preferences.set(migrated);
    return migrated;
  }
  return null;
}

export async function getLyricsOverridePreference(
  trackUri: string
): Promise<LyricsOverridePreference | null> {
  const current = await preferences.get(trackUri);
  if (current) return current;
  const existing = legacyMigrations.get(trackUri);
  if (existing) return existing;
  const migration = migrateLegacyPreference(trackUri).catch((error) => {
    legacyMigrations.delete(trackUri);
    throw error;
  });
  legacyMigrations.set(trackUri, migration);
  return migration;
}

export function lyricsMatchOverridePreference(
  lyrics: any,
  preference: LyricsOverridePreference | null
): boolean {
  if (!preference) {
    return (
      lyrics?.LyricsOverridePreferenceId === undefined &&
      lyrics?.ManualLyricsSelection !== true &&
      lyrics?.source !== "ldb"
    );
  }
  return (
    lyrics?.LyricsOverridePreferenceId === preference.preferenceId &&
    lyrics?.LyricsOverrideKind === preference.kind
  );
}

export function markLyricsOverridePreference(
  lyrics: any,
  preference: LyricsOverridePreference | null
): void {
  if (!preference) {
    delete lyrics.LyricsOverridePreferenceId;
    delete lyrics.LyricsOverrideKind;
    delete lyrics.LyricsOverrideLifetime;
    return;
  }
  lyrics.LyricsOverridePreferenceId = preference.preferenceId;
  lyrics.LyricsOverrideKind = preference.kind;
  lyrics.LyricsOverrideLifetime = preference.lifetime;
}
