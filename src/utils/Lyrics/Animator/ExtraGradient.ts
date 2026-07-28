export const ExtraGradientUnsungPosition = -40;
export const ExtraGradientSungPosition = 100;

export function extraGradientPositionAt(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return ExtraGradientUnsungPosition +
    (ExtraGradientSungPosition - ExtraGradientUnsungPosition) * clamped;
}
