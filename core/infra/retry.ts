export interface RetryOptions {
  maxAttempts?: number;
  baseMs?: number;
  shouldSkip?: () => Promise<boolean>;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, baseMs = 1000, shouldSkip } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (shouldSkip) {
        const skip = await shouldSkip();
        if (skip) throw Object.assign(new Error("SKIP_ALREADY_PROCESSED"), { code: "SKIP" });
      }
      return await fn();
    } catch (error: any) {
      if (error.code === "SKIP") throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts - 1) {
        const delay = baseMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError!;
}
