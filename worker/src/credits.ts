import type { ProviderCredit, ProviderCreditRole, ProviderId } from "./types";

const MAX_CREDIT_NAME_LENGTH = 120;

export function cleanCreditName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const printable = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }).join("");
  const name = printable.replace(/\s+/g, " ").trim();
  return name ? name.slice(0, MAX_CREDIT_NAME_LENGTH) : undefined;
}

export function extractByCredit(
  text: unknown,
  role: ProviderCreditRole,
  provider: ProviderId,
): ProviderCredit | undefined {
  if (typeof text !== "string") return undefined;
  const match = /^\s*\[by\s*:\s*([^\]]+)\]\s*$/im.exec(text);
  const name = cleanCreditName(match?.[1]);
  return name ? { role, name, provider } : undefined;
}

export function dedupeProviderCredits(
  credits: Array<ProviderCredit | undefined>,
): ProviderCredit[] {
  const seen = new Set<string>();
  return credits.flatMap((credit) => {
    if (!credit) return [];
    const name = cleanCreditName(credit.name);
    if (!name) return [];
    const userId = typeof credit.userId === "string" && /^\d+$/.test(credit.userId)
      ? credit.userId
      : undefined;
    const normalized = { ...credit, name, ...(userId ? { userId } : {}) };
    const key = `${normalized.provider}\u0000${normalized.role}\u0000${normalized.name.toLocaleLowerCase()}\u0000${normalized.userId ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}
