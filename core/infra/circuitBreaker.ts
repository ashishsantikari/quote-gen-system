import { Logger } from "../telemetry/logger";
import { CircuitBreakerOpenError } from "../errors";

const log = new Logger({ component: "circuit-breaker" });

export class CircuitBreaker {
  private failures: number[] = [];
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private openedAt: number = 0;
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly openTimeoutMs: number;
  private readonly name: string;

  constructor(options?: {
    name?: string;
    failureThreshold?: number;
    windowMs?: number;
    openTimeoutMs?: number;
  }) {
    this.name = options?.name || "default";
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.windowMs = options?.windowMs ?? 120_000;
    this.openTimeoutMs = options?.openTimeoutMs ?? 30_000;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt >= this.openTimeoutMs) {
        this.transitionTo("HALF_OPEN");
      } else {
        const remaining = this.openTimeoutMs - (Date.now() - this.openedAt);
        log.warn("circuit open, fast-failing", {
          name: this.name,
          remainingMs: remaining,
          failureCount: this.failures.length,
        });
        throw new CircuitBreakerOpenError(
          this.name,
          remaining,
          this.failures.length,
        );
      }
    }
    try {
      const result = await fn();
      if (this.state === "HALF_OPEN") {
        this.transitionTo("CLOSED");
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private transitionTo(state: "CLOSED" | "OPEN" | "HALF_OPEN"): void {
    const from = this.state;
    this.state = state;
    if (state === "OPEN") this.openedAt = Date.now();
    if (state === "CLOSED") this.failures = [];
    log.warn("state change", {
      from,
      to: state,
      failureCount: this.failures.length,
    });
  }

  private recordFailure(): void {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.failureThreshold) {
      this.transitionTo("OPEN");
    }
  }

  getState(): string {
    return this.state;
  }
}
