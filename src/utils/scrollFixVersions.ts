const LAST_AFFECTED_SPICETIFY = [2, 45, 1] as const;

const parseVersion = (value: string | undefined): number[] | null => {
  const parsed = value?.split(".").slice(0, 3).map((part) => Number.parseInt(part, 10));
  return parsed?.length === 3 && parsed.every(Number.isFinite) ? parsed : null;
};

export function isAffectedSpotifyVersion(value: string | undefined): boolean {
  const version = parseVersion(value);
  if (!version) return false;
  const [, minor, patch] = version;
  const releasedPredicateSkips = minor >= 2 && patch >= 57;
  const correctedPredicateSkips = minor > 2 || (minor === 2 && patch >= 57);
  return correctedPredicateSkips && !releasedPredicateSkips;
}

export function isAffectedSpicetifyVersion(value: string | undefined): boolean {
  const version = parseVersion(value);
  if (!version) return false;
  for (let index = 0; index < LAST_AFFECTED_SPICETIFY.length; index += 1) {
    if (version[index] !== LAST_AFFECTED_SPICETIFY[index]) {
      return version[index] < LAST_AFFECTED_SPICETIFY[index];
    }
  }
  return true;
}
