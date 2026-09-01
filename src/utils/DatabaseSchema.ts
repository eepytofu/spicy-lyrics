export const SPICY_LYRICS_MINIMUM_DATABASE_VERSION = 3;

export type ObjectStoreCollection = {
  contains(name: string): boolean;
};

export function missingRequiredObjectStores(
  objectStoreNames: ObjectStoreCollection,
  requiredStores: readonly string[],
): string[] {
  return requiredStores.filter((name) => !objectStoreNames.contains(name));
}

export function nextCompatibleDatabaseVersion(currentVersion: number): number {
  return Math.max(
    SPICY_LYRICS_MINIMUM_DATABASE_VERSION,
    currentVersion + 1,
  );
}
