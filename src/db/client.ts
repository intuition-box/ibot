import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { paths } from '../config.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema.js';

const DB_PATH = path.resolve(paths.supportDb);
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
// WAL improves read concurrency; foreign_keys is OFF by default in SQLite and
// MUST be enabled per-connection for transcript_parts' ON DELETE CASCADE to fire
// (the original bot never did this, so its declared cascade was inert).
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
// Wait up to 5s for a lock instead of failing instantly with SQLITE_BUSY (e.g. a
// checkpoint or a second writer briefly holding the write lock on slow SD-card I/O).
sqlite.pragma('busy_timeout = 5000');

/**
 * Idempotent schema bootstrap. Safe to run against both a fresh DB and the
 * existing production `support.db` — every statement uses IF NOT EXISTS, and the
 * counter seed uses INSERT OR IGNORE so a running counter is never reset.
 */
function ensureSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS counter (
      id    INTEGER PRIMARY KEY CHECK (id = 0),
      last  INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO counter (id, last) VALUES (0, 0);

    CREATE TABLE IF NOT EXISTS tickets (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number    TEXT    NOT NULL UNIQUE,
      channel_id       TEXT    NOT NULL UNIQUE,
      channel_name     TEXT    NOT NULL,
      author_id        TEXT    NOT NULL,
      author_tag       TEXT    NOT NULL,
      guild_id         TEXT    NOT NULL,
      form_type        TEXT,
      form_data        TEXT,
      status           TEXT    NOT NULL DEFAULT 'open',
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      first_closed_at  DATETIME,
      last_closed_at   DATETIME,
      closed_by_id     TEXT,
      closed_by_tag    TEXT,
      reopen_count     INTEGER NOT NULL DEFAULT 0,
      message_count    INTEGER NOT NULL DEFAULT 0,
      tags             TEXT,
      transcript       TEXT,
      transcript_parts INTEGER NOT NULL DEFAULT 0,
      updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transcript_parts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id   INTEGER NOT NULL,
      part_number INTEGER NOT NULL,
      content     TEXT    NOT NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      UNIQUE (ticket_id, part_number)
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_channel_id ON tickets(channel_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_author_id ON tickets(author_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
    CREATE INDEX IF NOT EXISTS idx_transcript_parts_ticket_id ON transcript_parts(ticket_id);
  `);
}

/**
 * Idempotent column migrations for already-existing DBs (CREATE TABLE IF NOT
 * EXISTS won't add a column to a table that already exists). Safe every boot.
 */
function runMigrations(): void {
  const cols = sqlite.prepare('PRAGMA table_info(tickets)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'tags')) {
    sqlite.exec('ALTER TABLE tickets ADD COLUMN tags TEXT');
    logger.info('🗄️  Migrated: added tickets.tags');
  }
}

ensureSchema();
runMigrations();
logger.info('🗄️  Database ready (WAL, foreign_keys ON)');

/** Type-safe query interface. Use this for all reads/writes. */
export const db = drizzle(sqlite, { schema });

/** Raw connection — escape hatch for pragmas, backups, and the sqlite-vec RAG store. */
export const rawDb = sqlite;

/** Flush WAL and close the connection. Called on graceful shutdown. */
export function closeDb(): void {
  try {
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    sqlite.close();
    logger.info('🗄️  Database closed cleanly');
  } catch (error) {
    logger.error('Failed to close database:', error);
  }
}
