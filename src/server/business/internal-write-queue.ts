/**
 * Single-process serializer for the internal-controlled write lane.
 *
 * The queue deliberately has one execution slot.  A rejected operation is
 * normalized out of the tail so a failed write cannot permanently stop later
 * operator actions.  A timeout never releases the slot before the underlying
 * operation settles; this prevents a timed-out Feishu request from
 * overlapping the next write.
 */
export interface InternalWriteQueueOptions {
  maxConcurrency?: number;
  timeoutMs?: number;
}

export interface InternalWriteExecutionContext {
  /** True once the caller-visible timeout has fired. */
  isTimedOut(): boolean;
}

export interface InternalWriteQueueExecution<T> {
  /** The promise observed by the caller, including the optional timeout. */
  responsePromise: Promise<T>;
  /** Resolves only after the underlying queued operation has settled. */
  settlementPromise: Promise<void>;
}

export class InternalWriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private activeCount = 0;

  constructor(private readonly options: InternalWriteQueueOptions = {}) {
    const maxConcurrency = options.maxConcurrency ?? 1;
    if (maxConcurrency !== 1) {
      throw new Error('INTERNAL_WRITE_MAX_CONCURRENCY must be 1');
    }
  }

  get active(): number {
    return this.activeCount;
  }

  runWithSettlement<T>(
    operation: (context: InternalWriteExecutionContext) => Promise<T>,
    timeoutMs = this.options.timeoutMs,
  ): InternalWriteQueueExecution<T> {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectTimeout: ((reason?: unknown) => void) | undefined;
    const executionTimeoutMs = timeoutMs && timeoutMs > 0 ? timeoutMs : undefined;
    const timeoutPromise = executionTimeoutMs
      ? new Promise<never>((_, reject) => {
          rejectTimeout = reject;
        })
      : undefined;
    const execute = async (): Promise<T> => {
      this.activeCount += 1;
      // Queue wait is intentionally outside the execution timeout budget.
      // The timer starts only after this request owns the single slot.
      if (executionTimeoutMs) {
        timer = setTimeout(() => {
          timedOut = true;
          rejectTimeout?.(new Error('INTERNAL_WRITE_TIMEOUT'));
        }, executionTimeoutMs);
      }
      try {
        return await operation({ isTimedOut: () => timedOut });
      } finally {
        if (timer) clearTimeout(timer);
        timer = undefined;
        this.activeCount -= 1;
      }
    };

    const queuedRun = this.tail.then(execute, execute);
    // The queue tail follows the real operation, including a request that
    // outlives the caller-visible timeout.  This preserves the single-slot
    // invariant while allowing the caller to persist result_unknown promptly.
    this.tail = queuedRun.then(
      () => undefined,
      () => undefined,
    );
    const settlementPromise = queuedRun.then(
      () => undefined,
      () => undefined,
    );
    if (!timeoutPromise) {
      return { responsePromise: queuedRun, settlementPromise };
    }
    const responsePromise = Promise.race([queuedRun, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    return { responsePromise, settlementPromise };
  }

  run<T>(
    operation: (context: InternalWriteExecutionContext) => Promise<T>,
    timeoutMs = this.options.timeoutMs,
  ): Promise<T> {
    return this.runWithSettlement(operation, timeoutMs).responsePromise;
  }
}
