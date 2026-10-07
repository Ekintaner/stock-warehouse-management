interface AttemptWindow {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const WINDOW_MS = 15 * 60 * 1_000;
const MAX_TRACKED_KEYS = 50_000;

export class LoginRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();

  constructor(private readonly now: () => number = Date.now) {}

  check(address: string, username: string): RateLimitResult {
    const currentTime = this.now();
    this.removeExpired(currentTime);

    if (
      !this.attempts.has(`address:${address}`) &&
      this.attempts.size >= MAX_TRACKED_KEYS
    ) {
      return { allowed: false, retryAfterSeconds: Math.ceil(WINDOW_MS / 1_000) };
    }

    const addressWindow = this.attempts.get(`address:${address}`);
    const accountWindow = this.attempts.get(
      `account:${address}:${username}`,
    );
    const blockedWindows = [addressWindow, accountWindow].filter(
      (window): window is AttemptWindow =>
        window !== undefined && window.count >= 20,
    );
    const accountBlocked =
      accountWindow !== undefined && accountWindow.count >= 5;

    if (blockedWindows.length > 0 || accountBlocked) {
      const retryAfter = Math.max(
        1,
        ...blockedWindows.map((window) =>
          Math.ceil((window.resetAt - currentTime) / 1_000),
        ),
        ...(accountBlocked && accountWindow
          ? [Math.ceil((accountWindow.resetAt - currentTime) / 1_000)]
          : []),
      );
      return { allowed: false, retryAfterSeconds: retryAfter };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  recordFailure(address: string, username: string): void {
    const currentTime = this.now();
    this.removeExpired(currentTime);

    this.increment(`address:${address}`, currentTime);
    this.increment(`account:${address}:${username}`, currentTime);
  }

  clear(address: string, username: string): void {
    this.attempts.delete(`account:${address}:${username}`);
  }

  private increment(key: string, currentTime: number): void {
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= currentTime) {
      if (this.attempts.size >= MAX_TRACKED_KEYS) {
        return;
      }
      this.attempts.set(key, {
        count: 1,
        resetAt: currentTime + WINDOW_MS,
      });
      return;
    }
    current.count += 1;
  }

  private removeExpired(currentTime: number): void {
    for (const [key, window] of this.attempts) {
      if (window.resetAt <= currentTime) {
        this.attempts.delete(key);
      }
    }
  }
}
