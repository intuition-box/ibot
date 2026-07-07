import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Drizzle schema — the single source of truth for table shapes and row types.
 *
 * Column names/types mirror the original bot's tables exactly so an existing
 * `support.db` keeps working unchanged. Tables
 * are created at boot by an idempotent bootstrap (see db/client.ts) rather than
 * drizzle-kit migrations, which avoids a baseline step against the live DB.
 */

/** Single-row monotonic counter backing ticket numbers (id is always 0). */
export const counter = sqliteTable('counter', {
  id: integer('id').primaryKey(),
  last: integer('last').notNull(),
});

export const tickets = sqliteTable(
  'tickets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketNumber: text('ticket_number').notNull().unique(),
    channelId: text('channel_id').notNull().unique(),
    channelName: text('channel_name').notNull(),
    authorId: text('author_id').notNull(),
    authorTag: text('author_tag').notNull(),
    guildId: text('guild_id').notNull(),
    formType: text('form_type'),
    /** JSON-encoded form payload. */
    formData: text('form_data'),
    status: text('status', { enum: ['open', 'closed', 'deleted'] })
      .notNull()
      .default('open'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    firstClosedAt: text('first_closed_at'),
    lastClosedAt: text('last_closed_at'),
    closedById: text('closed_by_id'),
    closedByTag: text('closed_by_tag'),
    reopenCount: integer('reopen_count').notNull().default(0),
    messageCount: integer('message_count').notNull().default(0),
    /** Free, deterministic tags (form category + keyword matches). JSON array. */
    tags: text('tags'),
    /** Full transcript, stored inline only when it fits in a single part. */
    transcript: text('transcript'),
    transcriptParts: integer('transcript_parts').notNull().default(0),
    updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index('idx_tickets_channel_id').on(t.channelId),
    index('idx_tickets_author_id').on(t.authorId),
    index('idx_tickets_status').on(t.status),
    index('idx_tickets_created_at').on(t.createdAt),
  ],
);

/** Overflow storage for transcripts larger than one Discord upload. */
export const transcriptParts = sqliteTable(
  'transcript_parts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    partNumber: integer('part_number').notNull(),
    content: text('content').notNull(),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex('idx_transcript_parts_ticket_part').on(t.ticketId, t.partNumber),
    index('idx_transcript_parts_ticket_id').on(t.ticketId),
  ],
);

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type TicketStatus = Ticket['status'];
