import { REST, Routes } from 'discord.js';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { withRetry } from '../lib/retry.js';
import { collectCommands } from './registry.js';

/**
 * Registers every feature's slash commands with Discord. Bodies come from the
 * feature registry, so adding or removing a command is purely a feature concern —
 * this file never changes.
 */
export async function registerCommands(applicationId: string): Promise<void> {
  if (!env.guildId) {
    logger.warn('⚠️ GUILD_ID is not set; skipping slash command registration');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(env.discordToken);
  const body = collectCommands();
  try {
    await withRetry(() =>
      rest.put(Routes.applicationGuildCommands(applicationId, env.guildId as string), { body }),
    );
    logger.info(
      `✅ Registered ${body.length} commands: ${body.map((c) => `/${c.name}`).join(', ')}`,
    );
  } catch (error) {
    logger.error('Failed to register slash commands:', error);
  }
}
