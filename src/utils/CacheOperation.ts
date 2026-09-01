export type CacheOperationOutcome =
  | { kind: "success" }
  | { kind: "operation-failed"; error: unknown }
  | { kind: "refresh-failed"; error: unknown };

export async function performCacheOperation(
  operation: () => Promise<void>,
  refresh: () => Promise<void>,
): Promise<CacheOperationOutcome> {
  try {
    await operation();
  } catch (error) {
    return { kind: "operation-failed", error };
  }

  try {
    await refresh();
    return { kind: "success" };
  } catch (error) {
    return { kind: "refresh-failed", error };
  }
}
