export const ForkBuildName = "eepytofu";

export function createBuildMarker(
  version: string,
  revision: string | undefined,
  dirty: boolean,
): string {
  const normalizedRevision = revision?.trim().toLowerCase() || "unknown";
  return `${ForkBuildName}-${version}-${normalizedRevision}${dirty ? "-dirty" : ""}`;
}
