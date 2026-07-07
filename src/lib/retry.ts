import { CONFIG } from '../config.js';
import { logger } from './logger.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A permanent HTTP client error (4xx other than 429) will never succeed on
 * retry, so failing fast avoids wasted attempts and latency. Network errors,
 * 5xx, 429, and errors with no HTTP status are treated as transient.
 */
function isTransient(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  if (typeof status !== 'number') return true;
  if (status === 429) return true;
  return status < 400 || status >= 500;
}

/**
 * Runs `operation`, retrying transient failures with exponential backoff.
 * Permanent client errors (4xx ≠ 429) fail fast. Re-throws the last error once
 * attempts are exhausted so callers can decide how to surface the failure.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = CONFIG.MAX_RETRIES,
  baseDelay: number = CONFIG.RETRY_DELAY_BASE,
): Promise<T> {
  // Guarantee at least one attempt so `operation` always runs and we never throw
  // an undefined `lastError`.
  const attempts = Math.max(1, maxRetries);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransient(error)) break;
      const delay = baseDelay * 2 ** (attempt - 1);
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Operation failed (attempt ${attempt}/${attempts}), retrying in ${delay}ms: ${message}`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}
