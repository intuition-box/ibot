import { eq, sql } from 'drizzle-orm';
import { CONFIG } from '../config.js';
import { logger } from '../lib/logger.js';
import { db, rawDb } from './client.js';
import { counter, type Ticket, tickets, transcriptParts } from './schema.js';

/**
 * Atomically increments and returns the next ticket number as a zero-padded
 * 4-digit string. The increment + read run in a single transaction; with the
 * synchronous better-sqlite3 driver this is race-free within the process.
 */
export function getNextTicketNumber(): string {
  const row = db.transaction((tx) => {
    tx.update(counter)
      .set({ last: sql`${counter.last} + 1` })
      .where(eq(counter.id, 0))
      .run();
    return tx.select({ last: counter.last }).from(counter).where(eq(counter.id, 0)).get();
  });
  const last = row?.last ?? 0;
  return String(last).padStart(4, '0');
}

export interface NewTicketInput {
  ticketNumber: string;
  channelId: string;
  channelName: string;
  authorId: string;
  authorTag: string;
  guildId: string;
}

/** Inserts a ticket row. Returns the row id, or null on failure. */
export function createTicket(input: NewTicketInput): number | null {
  try {
    const result = db.insert(tickets).values(input).run();
    logger.info(`✅ Created ticket #${input.ticketNumber} (row ${result.lastInsertRowid})`);
    return Number(result.lastInsertRowid);
  } catch (error) {
    logger.error('Failed to create ticket record:', error);
    return null;
  }
}

export function getTicketByChannel(channelId: string): Ticket | undefined {
  return db.select().from(tickets).where(eq(tickets.channelId, channelId)).get();
}

export function getTicketById(id: number): Ticket | undefined {
  return db.select().from(tickets).where(eq(tickets.id, id)).get();
}

/** Persists submitted form data against the ticket. */
export function updateForm(channelId: string, formType: string, formData: unknown): boolean {
  try {
    const result = db
      .update(tickets)
      .set({ formType, formData: JSON.stringify(formData), updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tickets.channelId, channelId))
      .run();
    return result.changes > 0;
  } catch (error) {
    logger.error('Failed to update form data:', error);
    return false;
  }
}

/** Splits a single oversized string into ≤maxBytes pieces on character boundaries. */
function hardSplitByBytes(text: string, maxBytes: number): string[] {
  const pieces: string[] = [];
  let buf = '';
  let bytes = 0;
  for (const ch of text) {
    const len = Buffer.byteLength(ch, 'utf8');
    if (bytes + len > maxBytes && buf) {
      pieces.push(buf);
      buf = '';
      bytes = 0;
    }
    buf += ch;
    bytes += len;
  }
  if (buf) pieces.push(buf);
  return pieces;
}

/** Splits a transcript into byte-bounded parts for Discord's upload limit. */
function splitTranscript(transcript: string): string[] {
  const max = CONFIG.MAX_TRANSCRIPT_SIZE;
  if (Buffer.byteLength(transcript, 'utf8') <= max) return [transcript];

  const parts: string[] = [];
  let current = '';
  let size = 0;
  const flush = () => {
    if (current) {
      parts.push(current);
      current = '';
      size = 0;
    }
  };

  for (const line of transcript.split('\n')) {
    const chunk = `${line}\n`;
    const len = Buffer.byteLength(chunk, 'utf8');
    // A single line longer than the ceiling can neither share nor fit a part;
    // flush the accumulator and hard-split it so no part can exceed max bytes.
    if (len > max) {
      flush();
      for (const piece of hardSplitByBytes(chunk, max)) parts.push(piece);
      continue;
    }
    if (size + len > max) flush();
    current += chunk;
    size += len;
  }
  flush();
  return parts;
}

export interface CloseTicketInput {
  channelId: string;
  closerId: string;
  closerTag: string;
  messageCount: number;
  tags: string[];
  transcript: string;
}

/**
 * Marks a ticket closed and persists its transcript inside one transaction.
 * Small transcripts are stored inline; larger ones spill into transcript_parts.
 */
export function closeTicket(input: CloseTicketInput): boolean {
  try {
    return db.transaction((tx) => {
      const ticket = tx.select().from(tickets).where(eq(tickets.channelId, input.channelId)).get();
      if (!ticket) throw new Error(`Ticket not found for channel ${input.channelId}`);

      const parts = splitTranscript(input.transcript);
      const result = tx
        .update(tickets)
        .set({
          status: 'closed',
          firstClosedAt: sql`COALESCE(${tickets.firstClosedAt}, CURRENT_TIMESTAMP)`,
          lastClosedAt: sql`CURRENT_TIMESTAMP`,
          closedById: input.closerId,
          closedByTag: input.closerTag,
          messageCount: input.messageCount,
          tags: JSON.stringify(input.tags),
          transcript: parts.length === 1 ? input.transcript : null,
          transcriptParts: parts.length,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(tickets.channelId, input.channelId))
        .run();
      if (result.changes === 0) throw new Error(`Failed to update ticket ${input.channelId}`);

      // Always clear prior overflow rows first, so a re-close that shrinks the
      // transcript from multi-part back to inline doesn't orphan stale parts.
      tx.delete(transcriptParts).where(eq(transcriptParts.ticketId, ticket.id)).run();
      if (parts.length > 1) {
        parts.forEach((content, i) => {
          tx.insert(transcriptParts)
            .values({ ticketId: ticket.id, partNumber: i + 1, content })
            .run();
        });
      }

      logger.info(`✅ Closed ticket #${ticket.ticketNumber} (${parts.length} transcript part(s))`);
      return true;
    });
  } catch (error) {
    logger.error('Failed to close ticket:', error);
    return false;
  }
}

/** Reopens a closed ticket and bumps its reopen counter. */
export function reopenTicket(channelId: string): boolean {
  try {
    const result = db
      .update(tickets)
      .set({
        status: 'open',
        reopenCount: sql`${tickets.reopenCount} + 1`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(tickets.channelId, channelId))
      .run();
    if (result.changes > 0) {
      const ticket = getTicketByChannel(channelId);
      // Read AFTER the update, so reopenCount is already the new value (the
      // original logged `count + 1` on a post-update read — an off-by-one).
      logger.info(
        `✅ Reopened ticket #${ticket?.ticketNumber} (reopen count: ${ticket?.reopenCount})`,
      );
    }
    return result.changes > 0;
  } catch (error) {
    logger.error('Failed to reopen ticket:', error);
    return false;
  }
}

/** Soft-deletes a ticket (status='deleted'); the row and transcript are retained. */
export function markTicketDeleted(channelId: string): boolean {
  try {
    const result = db
      .update(tickets)
      .set({ status: 'deleted', updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tickets.channelId, channelId))
      .run();
    if (result.changes > 0) {
      const ticket = getTicketByChannel(channelId);
      logger.info(`✅ Marked ticket #${ticket?.ticketNumber} as deleted`);
    }
    return result.changes > 0;
  } catch (error) {
    logger.error('Failed to delete ticket:', error);
    return false;
  }
}

export function incrementMessageCount(channelId: string): boolean {
  try {
    const result = db
      .update(tickets)
      .set({ messageCount: sql`${tickets.messageCount} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tickets.channelId, channelId))
      .run();
    return result.changes > 0;
  } catch (error) {
    logger.warn('Failed to increment message count:', error);
    return false;
  }
}

/** Returns the full transcript, reassembling parts when stored out-of-line. */
export function getFullTranscript(ticketId: number): string | null {
  try {
    const ticket = getTicketById(ticketId);
    if (!ticket) return null;
    if (ticket.transcript) return ticket.transcript;
    const parts = db
      .select({ content: transcriptParts.content })
      .from(transcriptParts)
      .where(eq(transcriptParts.ticketId, ticketId))
      .orderBy(transcriptParts.partNumber)
      .all();
    return parts.map((p) => p.content).join('');
  } catch (error) {
    logger.error('Failed to get full transcript:', error);
    return null;
  }
}

export interface TicketStats {
  total_tickets: number;
  open_tickets: number;
  closed_tickets: number;
  deleted_tickets: number;
  /** Mean message_count across all tickets (0 when there are none). */
  avg_messages: number;
  /** Sum of reopen_count across all tickets. */
  total_reopens: number;
}

export function getStats(): TicketStats | null {
  try {
    return rawDb
      .prepare(
        `SELECT
           COUNT(*) AS total_tickets,
           COUNT(CASE WHEN status = 'open' THEN 1 END) AS open_tickets,
           COUNT(CASE WHEN status = 'closed' THEN 1 END) AS closed_tickets,
           COUNT(CASE WHEN status = 'deleted' THEN 1 END) AS deleted_tickets,
           COALESCE(AVG(message_count), 0) AS avg_messages,
           COALESCE(SUM(reopen_count), 0) AS total_reopens
         FROM tickets`,
      )
      .get() as TicketStats;
  } catch (error) {
    logger.error('Failed to get stats:', error);
    return null;
  }
}
