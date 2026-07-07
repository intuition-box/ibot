import 'dotenv/config';
import path from 'node:path';

/**
 * Reads a required environment variable, or exits the process if it is missing.
 * Fail-fast at boot beats a half-configured bot mutating Discord state.
 */
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ ${key} is not set. Exiting.`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

/** Validated environment for ibot — tickets + the resources panel, nothing else. */
export const env = {
  discordToken: requireEnv('DISCORD_TOKEN'),
  guildId: optionalEnv('GUILD_ID'),
  openTicketsCategoryId: optionalEnv('OPEN_TICKETS_CATEGORY_ID'),
  /** Discord user IDs allowed to run slash commands. Empty = fall back to ManageGuild. */
  ownerIds: (process.env.OWNER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  debug: process.env.DEBUG === 'true',
} as const;

/** Tunables that are not secrets and rarely change. */
export const CONFIG = {
  /** Discord's single-file upload ceiling (8 MiB); transcripts are split past this. */
  MAX_TRANSCRIPT_SIZE: 8 * 1024 * 1024,
  /** Delay between message-history fetch pages, ms. */
  FETCH_DELAY: 50,
  /** Retry attempts for transient Discord/API failures. */
  MAX_RETRIES: 3,
  /** Base delay for exponential backoff, ms. */
  RETRY_DELAY_BASE: 1000,
  /** Prefix that marks a channel as a ticket channel. */
  TICKET_CHANNEL_PREFIX: 'ticket-',
} as const;

// `||` (not `??`) so an empty `DB_DIR=` falls back to the default instead of dumping
// the database into the project root.
const dbDir = process.env.DB_DIR?.trim() || path.join('data', 'db');
export const paths = {
  dbDir,
  /** The ticket store — tickets, transcripts, the counter. Runtime state, gitignored. */
  supportDb: path.join(dbDir, 'support.db'),
} as const;
