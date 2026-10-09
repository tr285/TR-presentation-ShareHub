export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export interface LockoutResult {
  locked: boolean;
  remainingAttempts: number;
  lockoutRemainingMs?: number;
}

export class RateLimiter {
  private windows: Map<string, number[]> = new Map();
  private failedAttempts: Map<string, { count: number; lockedUntil?: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(autoCleanupIntervalMs: number = 60 * 1000) {
    if (autoCleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, autoCleanupIntervalMs);
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.windows.clear();
    this.failedAttempts.clear();
  }

  /**
   * Sliding window rate limit check
   */
  public isAllowed(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const timestamps = this.windows.get(key) || [];

    // Filter out timestamps outside the active window
    const valid = timestamps.filter((t) => now - t < windowMs);

    if (valid.length >= limit) {
      const oldest = valid[0];
      const resetMs = Math.max(0, windowMs - (now - oldest));
      return {
        allowed: false,
        remaining: 0,
        resetMs,
      };
    }

    valid.push(now);
    this.windows.set(key, valid);

    return {
      allowed: true,
      remaining: limit - valid.length,
      resetMs: windowMs,
    };
  }

  /**
   * Failed attempts and temporary lockout (e.g. for passcode guessing defense)
   */
  public recordFailedAttempt(
    key: string,
    maxAttempts: number = 5,
    lockoutDurationMs: number = 5 * 60 * 1000
  ): LockoutResult {
    const now = Date.now();
    const current = this.failedAttempts.get(key) || { count: 0 };

    if (current.lockedUntil && now < current.lockedUntil) {
      return {
        locked: true,
        remainingAttempts: 0,
        lockoutRemainingMs: current.lockedUntil - now,
      };
    }

    current.count += 1;

    if (current.count >= maxAttempts) {
      current.lockedUntil = now + lockoutDurationMs;
      this.failedAttempts.set(key, current);
      return {
        locked: true,
        remainingAttempts: 0,
        lockoutRemainingMs: lockoutDurationMs,
      };
    }

    this.failedAttempts.set(key, current);
    return {
      locked: false,
      remainingAttempts: Math.max(0, maxAttempts - current.count),
    };
  }

  public isLockedOut(key: string): boolean {
    const now = Date.now();
    const current = this.failedAttempts.get(key);
    if (!current || !current.lockedUntil) return false;
    if (now >= current.lockedUntil) {
      this.failedAttempts.delete(key);
      return false;
    }
    return true;
  }

  public resetAttempts(key: string): void {
    this.failedAttempts.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    // Clean windows older than 5 minutes
    for (const [key, timestamps] of this.windows.entries()) {
      const active = timestamps.filter((t) => now - t < 5 * 60 * 1000);
      if (active.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, active);
      }
    }

    // Clean expired lockouts
    for (const [key, data] of this.failedAttempts.entries()) {
      if (data.lockedUntil && now >= data.lockedUntil) {
        this.failedAttempts.delete(key);
      }
    }
  }
}
