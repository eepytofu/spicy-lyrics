export const PausedAnimationSettleMs = 750;

export function shouldAnimateLyricsFrame(
  isPlaying: boolean,
  positionChanged: boolean,
  now: number,
  animateThrough: number,
): boolean {
  return isPlaying || positionChanged || now <= animateThrough;
}
