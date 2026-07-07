import { ActivityType } from 'discord.js';
import { env } from './config.js';
import { client } from './discord/client.js';
import { registerCommands } from './discord/commands.js';
import {
  handleInteraction,
  handleMessage,
  runChannelDeleteHooks,
  runReadyHooks,
  runShutdownHooks,
} from './discord/registry.js';
import { logger } from './lib/logger.js';

client.on('error', (error) => logger.error('Client error:', error));
client.on('warn', (warning) => logger.debug('Client warning:', warning));

client.once('ready', async () => {
  logger.info(`✅ Logged in as ${client.user?.tag}`);

  try {
    await client.user?.setPresence({
      activities: [{ type: ActivityType.Listening, name: '/support' }],
      status: 'online',
    });
  } catch (error) {
    logger.warn('Failed to set presence:', error);
  }

  // Per-feature startup hooks (e.g. support logs ticket stats).
  await runReadyHooks();

  if (client.user) await registerCommands(client.user.id);
  logger.info('🟢 ibot is ready.');
});

client.on('interactionCreate', (interaction) => {
  void handleInteraction(interaction);
});

client.on('messageCreate', (message) => {
  void handleMessage(message);
});

// A deleted channel (ticket or otherwise) lets features free per-channel state.
client.on('channelDelete', (channel) => {
  void runChannelDeleteHooks(channel.id);
});

// ── Process lifecycle ──────────────────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}; shutting down…`);
  try {
    await client.destroy();
  } catch (error) {
    logger.error('Error destroying client:', error);
  }
  // Per-feature DB cleanup (support → support.db) runs via the shutdown hooks.
  await runShutdownHooks();
  process.exit(code);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
  // Treat like an uncaught exception: exit non-zero so a supervisor restarts a
  // wedged process and the DB is closed cleanly, rather than limping on.
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  // Exit non-zero so a supervisor (systemd/pm2/Docker) treats a crash as failure
  // and restarts, instead of mistaking it for a clean shutdown.
  void shutdown('uncaughtException', 1);
});

try {
  await client.login(env.discordToken);
} catch (error) {
  logger.error('Login failed:', error);
  process.exit(1);
}
