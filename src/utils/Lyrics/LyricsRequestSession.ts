export type LyricsRequestSession = Readonly<{
  id: number;
  uri: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
}>;

type ActiveRequest<Result> = {
  session: LyricsRequestSession;
  controller: AbortController;
  promise: Promise<Result> | null;
};

export class LyricsRequestCoordinator<Result> {
  private nextId = 0;
  private active: ActiveRequest<Result> | null = null;

  run(
    uri: string,
    task: (session: LyricsRequestSession) => Promise<Result>,
  ): Promise<Result> {
    const existing = this.active;
    if (
      existing
      && existing.session.uri === uri
      && existing.promise
      && !existing.session.signal.aborted
    ) {
      return existing.promise;
    }

    this.invalidate();

    const id = ++this.nextId;
    const controller = new AbortController();
    const session: LyricsRequestSession = Object.freeze({
      id,
      uri,
      signal: controller.signal,
      isCurrent: () => this.active?.session.id === id && !controller.signal.aborted,
    });

    const active: ActiveRequest<Result> = {
      session,
      controller,
      promise: null,
    };
    this.active = active;

    const promise = Promise.resolve()
      .then(() => task(session))
      .finally(() => {
        if (this.active?.session.id === id) this.active.promise = null;
      });
    active.promise = promise;
    return promise;
  }

  invalidate(): void {
    if (!this.active) return;
    this.active.controller.abort();
    this.active = null;
  }
}
