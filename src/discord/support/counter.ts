import type { Message } from 'discord.js';
import { CONFIG } from '../../config.js';
import { incrementMessageCount } from '../../db/tickets.js';
import { logger } from '../../lib/logger.js';

/**
 * Tracks message volume per ticket for statistics. Non-bot messages in any
 * channel named `ticket-*` bump the ticket's counter. Passive — never "takes
 * over" the message, so the AI/wallet pipeline runs as normal.
 *
 * (The legacy second `messageCreate` handler — the broken `!cubeo_update` admin
 * command with its auth check commented out — has been dropped entirely.)
 */
export function countTicketMessage(message: Message): void {
  if (message.author.bot) return;
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return;
  const name = 'name' in message.channel ? message.channel.name : undefined;
  if (!name?.startsWith(CONFIG.TICKET_CHANNEL_PREFIX)) return;

  try {
    incrementMessageCount(message.channel.id);
  } catch (error) {
    logger.debug('Failed to increment message count:', error);
  }
}
