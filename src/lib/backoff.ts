/**
 * Exponential backoff with full jitter.
 *
 * Formula: min(maxDelayMs, baseDelayMs * 2^attempt) * random(0, 1)
 *
 * References:
 *   https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export interface BackoffOptions {
  /** Initial delay in milliseconds (default: 1 000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30 000) */
  maxDelayMs?: number;
  /** Maximum number of attempts before giving up (default: 15) */
  maxAttempts?: number;
}

export class ExponentialBackoff {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  readonly maxAttempts: number;

  private _attempt = 0;

  constructor(options: BackoffOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 15;
  }

  /** Current attempt count (0-based). */
  get attempt(): number {
    return this._attempt;
  }

  /** True when the maximum number of attempts has been reached. */
  get exhausted(): boolean {
    return this._attempt >= this.maxAttempts;
  }

  /**
   * Compute the next delay and increment the attempt counter.
   * Returns `null` when `maxAttempts` has been reached.
   */
  nextDelayMs(): number | null {
    if (this.exhausted) return null;
    const cap = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * Math.pow(2, this._attempt)
    );
    const delay = Math.random() * cap; // full jitter
    this._attempt++;
    return Math.round(delay);
  }

  /**
   * Wait for the next backoff interval.
   * Returns `false` if attempts are exhausted (no sleep performed).
   */
  async wait(): Promise<boolean> {
    const delay = this.nextDelayMs();
    if (delay === null) return false;
    await sleep(delay);
    return true;
  }

  /** Reset the attempt counter so the backoff can be reused. */
  reset(): void {
    this._attempt = 0;
  }
}

/** Simple promise-based sleep. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
