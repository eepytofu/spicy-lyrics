const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong",
]);

function splitFamilyList(value: string): string[] {
  const families: string[] = [];
  let current = "";
  let quote = "";
  for (const character of value) {
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? "" : character;
      current += character;
    } else if (character === "," && !quote) {
      families.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  families.push(current);
  return families;
}

function normalizeFamily(value: string): string | null {
  let family = value.trim();
  if (!family) return null;
  const first = family[0];
  const last = family[family.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    family = family.slice(1, -1).trim();
  }
  const hasUnsafeCharacter = [...family].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || ";{}".includes(character);
  });
  if (!family || hasUnsafeCharacter) return null;
  const generic = family.toLowerCase();
  if (GENERIC_FAMILIES.has(generic)) return generic;
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Converts a comma-separated user font stack into a safe CSS font-family value. */
export function toCssFontFamilyStack(value: string): string {
  return splitFamilyList(value)
    .slice(0, 12)
    .map(normalizeFamily)
    .filter((family): family is string => family !== null)
    .join(", ");
}
