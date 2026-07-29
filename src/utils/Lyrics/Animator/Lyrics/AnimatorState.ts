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

export function safeAnimationDelay(candidate: number, fallback: number): number {
  const resolved = finiteAnimationValue(candidate, fallback);
  return Math.max(0, resolved);
}

export function finiteAnimationValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Number.isFinite(fallback) ? fallback : 0;
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
