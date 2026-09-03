export type LyricsRefreshQueueOptions<Request> = {
  merge(pending: Request, next: Request): Request;
  run(revision: number, request: Request): Promise<void>;
  onError(error: unknown, revision: number): void;
  onIdle?(revision: number): void;
};

export class LyricsRefreshQueue<Request> {
  private readonly options: LyricsRefreshQueueOptions<Request>;
  private requestedRevision = 0;
  private completedRevision = 0;
  private running = false;
  private pending: { request: Request } | null = null;

  constructor(options: LyricsRefreshQueueOptions<Request>) {
    this.options = options;
  }

  enqueue(request: Request): number {
    this.pending = {
      request: this.pending
        ? this.options.merge(this.pending.request, request)
        : request,
    };
    const revision = ++this.requestedRevision;
    void this.drain();
    return revision;
  }

  isCurrent(revision: number): boolean {
    return revision === this.requestedRevision;
  }

  isIdleAt(revision: number): boolean {
    return (
      !this.running &&
      revision === this.completedRevision &&
      this.completedRevision === this.requestedRevision
    );
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.completedRevision < this.requestedRevision) {
        const targetRevision = this.requestedRevision;
        const pending = this.pending;
        if (!pending) {
          this.completedRevision = targetRevision;
          this.options.onError(
            new Error("Lyrics refresh queue lost its pending request"),
            targetRevision,
          );
          continue;
        }
        this.pending = null;
        try {
          await this.options.run(targetRevision, pending.request);
        } catch (error) {
          this.options.onError(error, targetRevision);
        } finally {
          this.completedRevision = targetRevision;
        }
      }
    } finally {
      this.running = false;
      if (this.completedRevision < this.requestedRevision) {
        void this.drain();
      } else {
        this.options.onIdle?.(this.completedRevision);
      }
    }
  }
}
