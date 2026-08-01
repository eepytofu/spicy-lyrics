export type CancelableTask = {
  Cancel: () => void;
  Reset: () => void;
};

const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_MAX_CHECKS = 1200;

function Until<T>(
  statement: T | (() => T),
  callback: () => void,
  maxRepeats = DEFAULT_MAX_CHECKS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): CancelableTask {
  let isCancelled = false;
  let executedCount = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resolveStatement = (): T => typeof statement === "function"
    ? (statement as () => T)()
    : statement;

  const schedule = () => {
    timer = setTimeout(runner, pollIntervalMs);
  };
  const runner = () => {
    timer = undefined;
    if (isCancelled || executedCount >= maxRepeats) return;
    const conditionMet = resolveStatement();
    if (conditionMet) return;
    callback();
    executedCount += 1;
    if (executedCount < maxRepeats) schedule();
  };
  schedule();

  return {
    Cancel() {
      isCancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    Reset() {
      if (executedCount < maxRepeats && !isCancelled) return;
      isCancelled = false;
      executedCount = 0;
      if (timer !== undefined) clearTimeout(timer);
      schedule();
    },
  };
}

function When<T>(
  statement: T | (() => T),
  callback: (statement: T) => void,
  repeater = 1,
  options: { maxChecks?: number; pollIntervalMs?: number } = {},
): CancelableTask {
  const maxChecks = options.maxChecks ?? DEFAULT_MAX_CHECKS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let isCancelled = false;
  let checksRemaining = maxChecks;
  let executionsRemaining = repeater;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resolveStatement = (): T => typeof statement === "function"
    ? (statement as () => T)()
    : statement;

  const schedule = () => {
    timer = setTimeout(runner, pollIntervalMs);
  };
  const runner = () => {
    timer = undefined;
    if (isCancelled || executionsRemaining <= 0 || checksRemaining <= 0) return;
    checksRemaining -= 1;
    const resolved = resolveStatement();
    if (resolved) {
      callback(resolved);
      executionsRemaining -= 1;
    }
    if (executionsRemaining > 0 && checksRemaining > 0) schedule();
  };
  schedule();

  return {
    Cancel() {
      isCancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    Reset() {
      if (executionsRemaining > 0 && checksRemaining > 0 && !isCancelled) return;
      isCancelled = false;
      checksRemaining = maxChecks;
      executionsRemaining = repeater;
      if (timer !== undefined) clearTimeout(timer);
      schedule();
    },
  };
}

const Whentil = { When, Until };

export default Whentil;
