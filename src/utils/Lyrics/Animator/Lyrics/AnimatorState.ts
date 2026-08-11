import {
  ExtraGradientSungPosition,
  ExtraGradientUnsungPosition,
  extraGradientPositionAt,
} from "../ExtraGradient.ts";

export type LyricAnimationState = "NotSung" | "Active" | "Sung";
export type SyllableLinePaintAction =
  | "none"
  | "resetNotSung"
  | "continueSung"
  | "settleSung";

interface ClassTarget {
  classList: Pick<DOMTokenList, "toggle">;
}

interface TimedGroupWindowLike {
  start: number;
  firstEnd: number;
  lastStart: number;
  end: number;
}

export interface GradientTargets {
  base: number;
  extra: number;
}

export interface TimedFuriganaBaseGradient {
  position: number;
  width: number;
}

export function getElementState(
  currentTime: number,
  startTime: number,
  endTime: number
): LyricAnimationState {
  if (currentTime < startTime) return "NotSung";
  if (currentTime >= endTime) return "Sung";
  return "Active";
}

export function getProgressPercentage(
  currentTime: number,
  startTime: number,
  endTime: number
): number {
  if (currentTime <= startTime) return 0;
  if (currentTime >= endTime) return 1;
  return (currentTime - startTime) / (endTime - startTime);
}

/** Project the existing group-wide ruby sweep onto one canonical base slice. */
export function projectTimedFuriganaBaseGradient(
  groupPosition: number,
  range: { start: number; end: number },
  groupGradientWidth = 20,
): TimedFuriganaBaseGradient | undefined {
  if (
    Number.isFinite(groupPosition) &&
    Number.isFinite(range.start) &&
    Number.isFinite(range.end) &&
    range.start >= 0 &&
    range.end <= 1 &&
    range.end > range.start
  ) {
    const scale = 1 / (range.end - range.start);
    return {
      position: (groupPosition - range.start * 100) * scale,
      width: groupGradientWidth * scale,
    };
  }
  return undefined;
}

export function safeAnimationDelay(candidate: number, fallback: number): number {
  const resolved = finiteAnimationValue(candidate, fallback);
  return Math.max(0, resolved);
}

export function finiteAnimationValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Number.isFinite(fallback) ? fallback : 0;
}

/**
 * Compare lyric-clock movement with wall-clock movement. Ordinary playback
 * advances both together, while seeking jumps the lyric clock independently.
 * The animator uses this signal to snap stale springs before the seek frame is
 * painted.
 */
export function animationTimelineJumped(
  previousPosition: number | null,
  currentPosition: number,
  elapsedMs: number,
  thresholdMs = 250,
): boolean {
  if (
    previousPosition === null ||
    !Number.isFinite(previousPosition) ||
    !Number.isFinite(currentPosition)
  ) {
    return false;
  }
  const safeElapsed = Math.max(finiteAnimationValue(elapsedMs, 0), 0);
  const actualAdvance = currentPosition - previousPosition;
  if (Math.abs(actualAdvance) <= Math.max(thresholdMs, 0)) return false;
  return Math.abs(actualAdvance - safeElapsed) > Math.max(thresholdMs, 0);
}

export function wordGradientTargets(
  state: LyricAnimationState,
  progress: number,
  simpleMode: boolean
): GradientTargets {
  if (state === "Sung") {
    return {
      base: 100,
      extra: ExtraGradientSungPosition,
    };
  }
  if (state === "NotSung") {
    const base = simpleMode ? -50 : -20;
    return {
      base,
      extra: simpleMode ? base : ExtraGradientUnsungPosition,
    };
  }

  const base = (simpleMode ? -50 : -20) + 120 * progress;
  return {
    base,
    extra: simpleMode ? base : extraGradientPositionAt(progress),
  };
}

export function gradientTargetsAt(
  currentTime: number,
  startTime: number,
  endTime: number,
  simpleMode: boolean
): GradientTargets {
  return wordGradientTargets(
    getElementState(currentTime, startTime, endTime),
    getProgressPercentage(currentTime, startTime, endTime),
    simpleMode
  );
}

/**
 * A line reached through ordinary playback may finish its spring tail after
 * its timing window. A seek can skip that Active phase entirely, so those
 * lines must snap to their terminal paint state instead.
 */
export function syllableLinePaintAction(
  state: LyricAnimationState,
  previousState: LyricAnimationState | undefined,
  nextState: LyricAnimationState | undefined,
): SyllableLinePaintAction {
  if (state === "NotSung") {
    return previousState === "NotSung" ? "none" : "resetNotSung";
  }
  if (state !== "Sung") return "none";
  if (previousState === "Active" && nextState !== "Sung") return "continueSung";
  return previousState === "Sung" ? "none" : "settleSung";
}

export function timedGroupEnvelopeAt(
  times: TimedGroupWindowLike,
  position: number,
  hold: number
): number {
  if (position <= times.start) return 0;
  if (position >= times.end) return 1;
  if (position <= times.firstEnd) {
    const attack = Math.max(
      0,
      Math.min((position - times.start) / Math.max(times.firstEnd - times.start, 1), 1)
    );
    return Math.min(attack, hold);
  }
  if (position < times.lastStart) return hold;
  const release = Math.max(
    0,
    Math.min((position - times.lastStart) / Math.max(times.end - times.lastStart, 1), 1)
  );
  return Math.max(hold, release);
}

export function shouldHideDotLine(
  state: LyricAnimationState,
  position: number,
  endTime: number,
  preHiddenMs: number
): boolean {
  return state === "NotSung" || (state === "Active" && position > endTime - preHiddenMs);
}

export function applyLineState(target: ClassTarget, state: LyricAnimationState): void {
  target.classList.toggle("NotSung", state === "NotSung");
  target.classList.toggle("Active", state === "Active");
  target.classList.toggle("Sung", state === "Sung");
}

export function setClassPresence(target: ClassTarget, className: string, present: boolean): void {
  target.classList.toggle(className, present);
}
