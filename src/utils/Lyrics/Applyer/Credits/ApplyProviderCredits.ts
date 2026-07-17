type ProviderCreditRole = "syncedLyrics" | "lyrics" | "translation" | "romanization" | "credit";

export type ProviderCredit = {
  role: ProviderCreditRole;
  name: string;
  provider: string;
  userId?: string;
};

const ROLE_LABELS: Record<ProviderCreditRole, string> = {
  syncedLyrics: "Synced lyrics by",
  lyrics: "Lyrics credit",
  translation: "Translation by",
  romanization: "Romanization by",
  credit: "Credit",
};

const CREDIT_ROLES = new Set<ProviderCreditRole>(Object.keys(ROLE_LABELS) as ProviderCreditRole[]);

export function normalizeProviderCredits(data: any): ProviderCredit[] {
  if (!Array.isArray(data?.ProviderCredits)) return [];
  const seen = new Set<string>();
  return data.ProviderCredits.flatMap((value: any): ProviderCredit[] => {
    const role = CREDIT_ROLES.has(value?.role) ? value.role as ProviderCreditRole : "credit";
    const name = typeof value?.name === "string" ? value.name.trim().slice(0, 120) : "";
    const provider = typeof value?.provider === "string"
      ? value.provider.trim().toLowerCase()
      : String(data?.source || data?.fetchProvider || "").trim().toLowerCase();
    if (!name || !provider) return [];
    const rawUserId = typeof value?.userId === "number" || typeof value?.userId === "string"
      ? String(value.userId)
      : "";
    const userId = /^\d+$/.test(rawUserId) ? rawUserId : undefined;
    const credit = { role, name, provider, ...(userId ? { userId } : {}) };
    const key = `${credit.provider}\u0000${credit.role}\u0000${credit.name.toLowerCase()}\u0000${credit.userId ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [credit];
  });
}

export function providerCreditProfileUrl(credit: ProviderCredit): string | undefined {
  if (credit.provider !== "netease" || !credit.userId || !/^\d+$/.test(credit.userId)) return undefined;
  return `https://music.163.com/#/user/home?id=${encodeURIComponent(credit.userId)}`;
}

export function providerCreditLabel(role: ProviderCreditRole): string {
  return ROLE_LABELS[role];
}

export function ApplyProviderCredits(data: any, LyricsContainer: HTMLElement): void {
  if (!LyricsContainer) return;
  const credits = normalizeProviderCredits(data);
  if (!credits.length) return;

  const container = document.createElement("div");
  container.classList.add("ProviderCredits");

  for (const credit of credits) {
    const row = document.createElement("div");
    row.classList.add("ProviderCredit");

    const label = document.createElement("span");
    label.classList.add("ProviderCreditLabel");
    label.textContent = `${providerCreditLabel(credit.role)}: `;
    row.appendChild(label);

    const profileUrl = providerCreditProfileUrl(credit);
    const name = document.createElement(profileUrl ? "a" : "span");
    name.classList.add("ProviderCreditName");
    name.textContent = credit.name;
    if (name instanceof HTMLAnchorElement && profileUrl) {
      name.href = profileUrl;
      name.target = "_blank";
      name.rel = "noopener noreferrer";
    }
    row.appendChild(name);
    container.appendChild(row);
  }

  LyricsContainer.appendChild(container);
}
