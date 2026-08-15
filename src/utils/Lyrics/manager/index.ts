import { dbPromise, ObjectStores } from "../../db";
import Logger from "../../Logger";
import {
  normalizeLocalLyricsRaw,
  parseLocalLyricsRaw,
  type LocalLyricsEnvelope,
} from "../LocalLyricsSource.ts";

const logger = new Logger("Local Lyrics Manager");

const objStore = ObjectStores.LyricsStore;

function logCaught(operation: string, error: unknown, context?: Record<string, unknown>) {
  const detail =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  logger.error(`${operation} failed:`, detail, context);
}

async function put(uri: string, lyrics: LocalLyricsEnvelope) {
  try {
    const db = await dbPromise;
    return await db.put(objStore, lyrics, uri);
  } catch (error) {
    logCaught("put", error, { uri });
    throw error;
  }
}

function parseRaw(data: unknown): any | null {
  return parseLocalLyricsRaw(data);
}

async function get(uri: string): Promise<any | null> {
  try {
    const db = await dbPromise;
    const data = await db.get(objStore, uri);
    if (data == null) {
      return null;
    }

    return parseRaw(data);
  } catch (error) {
    logCaught("get", error, { uri });
    return null;
  }
}

async function listKeys(): Promise<Array<string>> {
  try {
    const db = await dbPromise;
    const keys = await db.getAllKeys(objStore);
    return keys.filter((key): key is string => typeof key === "string");
  } catch (error) {
    logCaught("listKeys", error);
    return [];
  }
}

async function getRaw(uri: string): Promise<LocalLyricsEnvelope | null> {
  try {
    const db = await dbPromise;
    const data = await db.get(objStore, uri);
    if (data == null) return null;
    return normalizeLocalLyricsRaw(data);
  } catch (error) {
    logCaught("getRaw", error, { uri });
    return null;
  }
}

async function remove(uri: string): Promise<void> {
  try {
    const db = await dbPromise;
    await db.delete(objStore, uri);
  } catch (error) {
    logCaught("remove", error, { uri });
    throw error;
  }
}

export const LocalLyricsManager = {
  put,
  get,
  parseRaw,
  getRaw,
  listKeys,
  remove,
};
