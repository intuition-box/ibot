import { cleanContent, type Message, type TextChannel } from 'discord.js';
import { CONFIG } from '../../config.js';
import type { Ticket } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { withRetry } from '../../lib/retry.js';
import { client, getUserTag } from '../client.js';
import { UNLOCK_MESSAGE } from '../constants.js';
import { initialButtonMessageMap, unlockMessageMap } from './state.js';

// Transcripts are stored in the SQLite DB only — never uploaded to a Discord
// channel. A compromised Discord account must not be able to read ticket
// history, so the DB is the single, trusted store (read it via the future
// access-controlled viewer).

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fetches the full message history of a channel, oldest-first, with backoff. */
export async function fetchFullHistory(channel: TextChannel): Promise<Message[]> {
  const all: Message[] = [];
  let before: string | undefined;
  let consecutiveErrors = 0;
  const maxErrors = 5;

  while (true) {
    try {
      const batch = await withRetry(() => channel.messages.fetch({ limit: 100, before }));
      if (batch.size === 0) break;
      all.push(...batch.values());
      before = batch.last()?.id;
      consecutiveErrors = 0;
      await sleep(CONFIG.FETCH_DELAY);
    } catch (error) {
      consecutiveErrors++;
      const code = (error as { code?: number }).code;
      if (code === 429) {
        const wait = (error as { retry_after?: number }).retry_after ?? 1000;
        logger.warn(`Rate limited, waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (consecutiveErrors >= maxErrors) {
        logger.error(`Too many consecutive errors (${maxErrors}); stopping message fetch:`, error);
        break;
      }
      await sleep(2000 * consecutiveErrors);
    }
  }

  logger.info(`Fetched ${all.length} messages from #${channel.name}`);
  return all.reverse();
}

function makeHeader(name: string, closerTag: string, timestamp: string, ticket?: Ticket): string {
  const reopen =
    ticket && ticket.reopenCount > 0
      ? ` (reopened ${ticket.reopenCount} time${ticket.reopenCount > 1 ? 's' : ''})`
      : '';
  return `Transcript of #${name} (closed by ${closerTag} at ${timestamp})${reopen}`;
}

/** Renders the chronological text transcript, skipping the bot's UI scaffolding. */
export async function buildTranscript(
  messages: Message[],
  channel: TextChannel,
  closerId: string,
  ticket?: Ticket,
): Promise<{ header: string; body: string }> {
  const welcomeId = initialButtonMessageMap.get(channel.id);
  const unlockId = unlockMessageMap.get(channel.id);

  const filtered = messages.filter((m) => {
    if (m.id === welcomeId || m.id === unlockId) return false;
    const isBot = m.author?.id === client.user?.id;
    if (isBot && (m.components?.length ?? 0) > 0) return false;
    // The unlock message carries no components, so the check above misses it; after
    // a restart its id is unknown, so fall back to matching its known content.
    if (isBot && m.content === UNLOCK_MESSAGE) return false;
    return true;
  });

  const closerTag = await getUserTag(closerId);
  const header = makeHeader(channel.name, closerTag, new Date().toISOString(), ticket);

  let body = '';
  for (const msg of filtered) {
    try {
      const ts = new Date(msg.createdTimestamp).toISOString().replace('T', ' ').split('.')[0];
      let line: string;

      if (msg.content?.trim()) {
        line = cleanContent(msg.content, channel);
      } else if (msg.embeds.length) {
        const parts: string[] = [];
        for (const e of msg.embeds) {
          if (e.title) parts.push(cleanContent(e.title, channel));
          if (e.description) parts.push(cleanContent(e.description, channel));
          for (const f of e.fields) {
            parts.push(`${f.name}: ${cleanContent(f.value, channel)}`);
          }
        }
        line = parts.join('\n');
      } else {
        line = '[No text content]';
      }

      const authorTag = await getUserTag(msg.author?.id);
      body += `[${ts}] <${authorTag}>: ${line}\n`;

      for (const att of msg.attachments.values()) {
        body += `    [Attachment: ${att.name ?? 'unknown'} | ${att.url}]\n`;
      }
    } catch (error) {
      logger.warn(`Error processing message ${msg.id}:`, error);
      body += '[Error processing a message]\n';
    }
  }
  body += '\n<End of transcript>\n';

  return { header, body };
}
