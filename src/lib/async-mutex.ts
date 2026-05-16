/**
 * A simple async mutual-exclusion lock.
 *
 * Usage:
 *   const mutex = new AsyncMutex();
 *   const release = await mutex.acquire();
 *   try { ... } finally { release(); }
 *
 * Or with the helper:
 *   await mutex.runExclusive(async () => { ... });
 */
export class AsyncMutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  /** Returns true if the mutex is currently held. */
  get isLocked(): boolean {
    return this._locked;
  }

  /**
   * Acquire the lock.  Resolves with a release function that MUST be called
   * (ideally in a finally block) to unblock the next waiter.
   */
  acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true;
          resolve(() => this._release());
        } else {
          this._queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  /**
   * Run `fn` exclusively — acquires the lock, awaits `fn`, then releases.
   * Returns the value produced by `fn`.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Try to acquire without waiting.  Returns a release function on success,
   * or `null` if the lock is already held.
   */
  tryAcquire(): (() => void) | null {
    if (this._locked) return null;
    this._locked = true;
    return () => this._release();
  }

  private _release(): void {
    const next = this._queue.shift();
    if (next) {
      // Schedule on the microtask queue so the current stack unwinds first.
      Promise.resolve().then(next);
    } else {
      this._locked = false;
    }
  }
}
