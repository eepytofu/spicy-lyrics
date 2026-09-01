import { openDB, type IDBPDatabase } from "idb";
import Logger from "./Logger";
import {
  missingRequiredObjectStores,
  nextCompatibleDatabaseVersion,
} from "./DatabaseSchema.ts";

const dbLogger = new Logger("Database");

export const ObjectStores = {
  LyricsStore: "lyricsStore",
  JapaneseAssets: "japaneseAssets",
  LyricsOverrides: "lyricsOverrides",
};

const DATABASE_NAME = "spicylyrics";
const REQUIRED_OBJECT_STORES = Object.values(ObjectStores);

function createMissingObjectStores(db: IDBPDatabase) {
  for (const name of missingRequiredObjectStores(
    db.objectStoreNames,
    REQUIRED_OBJECT_STORES,
  )) {
    db.createObjectStore(name);
    dbLogger.debug("Created '", name, "' store");
  }
}

async function openCompatibleDatabase() {
  const existing = await openDB(DATABASE_NAME);
  const missing = missingRequiredObjectStores(
    existing.objectStoreNames,
    REQUIRED_OBJECT_STORES,
  );
  if (missing.length === 0) return existing;

  const nextVersion = nextCompatibleDatabaseVersion(existing.version);
  existing.close();
  dbLogger.debug("Upgrading database without removing newer stores", {
    nextVersion,
    missing,
  });
  return openDB(DATABASE_NAME, nextVersion, {
    upgrade(db) {
      createMissingObjectStores(db);
    },
  });
}

export const dbPromise = openCompatibleDatabase();

export async function ensurePersistence() {
  try {
    if (await navigator.storage.persisted()) return true;

    const granted = await navigator.storage.persist();
    if (!granted) {
      dbLogger.warn("Data persistence request was denied; This can lead to potential data loss");
    } else {
      dbLogger.debug("Data persistence request was accepted");
    }
    return granted;
  } catch {
    dbLogger.warn("Persistence check failed");
    return false;
  }
}
