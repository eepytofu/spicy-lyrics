const ReadingFields = [
  "JapaneseReading",
  "ReadingRenderPlan",
  "ReadingPrimaryScript",
  "RomanizedText",
  "TransliteratedText",
  "ProviderRomanizedText",
  "RomajiSpaceBefore",
] as const;

export function isProviderInfoLine(group: any): boolean {
  return group?.IsProviderInfo === true || group?.IsMetadata === true;
}

export function clearProviderMetadataReadings(group: any): boolean {
  if (!isProviderInfoLine(group)) return false;

  const syllables = Array.isArray(group.Syllables) ? group.Syllables : [];
  for (const entry of [group, ...syllables]) {
    for (const field of ReadingFields) delete entry[field];
  }
  return true;
}

export function useReadingsForProviderLine(group: any, useRomanized: boolean): boolean {
  return isProviderInfoLine(group) ? false : useRomanized;
}

export function providerMetadataSeekTimeMs(group: any): number | undefined {
  if (!isProviderInfoLine(group)) return undefined;
  const startTime = Number(group.StartTime);
  return Number.isFinite(startTime) ? Math.max(0, startTime * 1000) : undefined;
}
