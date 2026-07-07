import { env } from '../config.js';

/**
 * Minimal leveled logger. Centralizes the bot's console output so `debug`
 * lines can be gated behind DEBUG=true without scattering the check everywhere.
 */
export const logger = {
  info(...args: unknown[]): void {
    console.log(...args);
  },
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
  error(...args: unknown[]): void {
    console.error(...args);
  },
  debug(...args: unknown[]): void {
    if (env.debug) console.log('[DEBUG]', ...args);
  },
};
