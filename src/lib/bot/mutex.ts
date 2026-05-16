/**
 * Simple async mutex to prevent race conditions during bot startup
 * and connection sequences.
 */
export class Mutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true;
          resolve(() => this.release());
        } else {
          this._queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  private release(): void {
    this._locked = false;
    const next = this._queue.shift();
    if (next) next();
  }

  get isLocked(): boolean {
    return this._locked;
  }
}

/**
 * Run a function exclusively under a mutex lock.
 * Guarantees the lock is always released, even on error.
 */
export async function withMutex<T>(
  mutex: Mutex,
  fn: () => Promise<T>
): Promise<T> {
  const release = await mutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
