/** Spread a delay uniformly around its target without changing the mean. */
export function jitter(milliseconds: number, ratio: number): number {
  return milliseconds * (1 - ratio + Math.random() * ratio * 2);
}
