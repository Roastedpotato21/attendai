/**
 * Bounded retry utility for safe, idempotent read operations.
 *
 * Rules:
 * - Max 2 retries (3 total attempts)
 * - Only retries ConnectionError (transient/network failures)
 * - Never retries: RLS denial, constraint violation, auth failure, not-found
 * - Exponential back-off: 200ms, 400ms
 */

import { TransientDatabaseError, ConnectionError, DatabaseError } from "./errors";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a read-only repository call with bounded retry on transient failures.
 *
 * ```ts
 * const data = await withRetry("student list", () => supabase.from(...));
 * ```
 */
export async function withRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      // Only retry transient connection errors
      const isRetryable = err instanceof ConnectionError || (err instanceof DatabaseError && err.isRetryable);

      if (!isRetryable || attempt === MAX_RETRIES) {
        throw err;
      }

      const backoff = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[Retry] ${operation}: attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (retrying in ${backoff}ms)`,
        err instanceof Error ? err.message : err,
      );
      await delay(backoff);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}
