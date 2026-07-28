export interface RetryableLazyInitializer {
  ensure(): Promise<void>;
  isInitialized(): boolean;
}

export function createRetryableLazyInitializer(
  initialize: () => Promise<void>
): RetryableLazyInitializer {
  let initialized = false;
  let pending: Promise<void> | undefined;

  return {
    ensure(): Promise<void> {
      if (initialized) return Promise.resolve();
      if (pending) return pending;

      const attempt = Promise.resolve()
        .then(initialize)
        .then(() => {
          initialized = true;
        })
        .catch((error) => {
          if (pending === attempt) pending = undefined;
          throw error;
        });
      pending = attempt;
      return attempt;
    },
    isInitialized(): boolean {
      return initialized;
    },
  };
}
