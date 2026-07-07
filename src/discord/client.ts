import { Client, GatewayIntentBits } from 'discord.js';
import { logger } from '../lib/logger.js';
import { withRetry } from '../lib/retry.js';

/**
 * The shared Discord client. MessageContent is privileged and required to read
 * message text (transcripts + the @mention AI triggers). Cubeo is **guild-only by
 * design** — there is deliberately NO DirectMessages intent, so he never receives a
 * DM. Everything he does happens in public, monitorable channels. (The registry also
 * drops any non-guild message as a belt-and-suspenders guard.)
 */
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const userTagCache = new Map<string, string>();

/** Resolves a user's display tag, cached to avoid repeated fetches in transcripts. */
export async function getUserTag(userId: string | undefined): Promise<string> {
  if (!userId) return 'unknown';

  const cached = userTagCache.get(userId);
  if (cached) return cached;

  try {
    const user =
      client.users.cache.get(userId) ?? (await withRetry(() => client.users.fetch(userId)));
    const tag =
      user.discriminator && user.discriminator !== '0'
        ? `${user.username}#${user.discriminator}`
        : user.username;

    if (userTagCache.size >= 500) userTagCache.clear();
    userTagCache.set(userId, tag);
    return tag;
  } catch (error) {
    logger.warn(
      `Failed to fetch user tag for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'unknown';
  }
}
