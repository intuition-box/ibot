import {
  type Interaction,
  type Message,
  MessageFlags,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import { logger } from '../lib/logger.js';
import type { Feature } from './feature.js';
import { isOwner } from './permissions.js';
import { resourcesFeature } from './resources/feature.js';
import { supportFeature } from './support/feature.js';

/**
 * ibot's feature set — tickets + the resources panel. These are deterministic,
 * hardcoded utility features (the deliberate opposite of Cubeo, the sentient bot,
 * who has none of this). To remove one, delete its folder and its line here; to add
 * one, drop in a folder exporting a {@link Feature} and add it to this list.
 */
export const FEATURES: readonly Feature[] = [supportFeature, resourcesFeature];

/** command name → owning feature, built once at load. */
const commandOwners = new Map<string, Feature>();
for (const feature of FEATURES) {
  for (const command of feature.commands ?? []) commandOwners.set(command.name, feature);
}

/** Every slash-command body to register with Discord, gathered from all features. */
export function collectCommands(): RESTPostAPIApplicationCommandsJSONBody[] {
  return FEATURES.flatMap((f) => [...(f.commands ?? [])]);
}

/** Runs each feature's `onReady` hook once the client is up. */
export async function runReadyHooks(): Promise<void> {
  for (const feature of FEATURES) {
    try {
      await feature.onReady?.();
    } catch (error) {
      logger.warn(`[${feature.name}] onReady failed:`, error);
    }
  }
}

/** Runs each feature's `onShutdown` hook (e.g. closing the support database). */
export async function runShutdownHooks(): Promise<void> {
  for (const feature of FEATURES) {
    try {
      await feature.onShutdown?.();
    } catch (error) {
      logger.warn(`[${feature.name}] onShutdown failed:`, error);
    }
  }
}

/** Notifies each feature that a channel was deleted, so it can free per-channel state. */
export async function runChannelDeleteHooks(channelId: string): Promise<void> {
  for (const feature of FEATURES) {
    try {
      await feature.onChannelDelete?.(channelId);
    } catch (error) {
      logger.warn(`[${feature.name}] onChannelDelete failed:`, error);
    }
  }
}

/**
 * Central interaction router. Slash commands dispatch by name (behind the owner
 * allowlist); buttons and modals are offered to each feature until one claims them.
 */
export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      // Owner allowlist: if OWNER_IDS is set and this user isn't on it, ignore the
      // command entirely — no reply, no defer.
      if (!isOwner(interaction.user.id)) {
        logger.debug(
          `[cmd] ignoring /${interaction.commandName} from non-owner ${interaction.user.tag}`,
        );
        return;
      }
      await commandOwners.get(interaction.commandName)?.handleCommand?.(interaction);
    } else if (interaction.isModalSubmit()) {
      for (const feature of FEATURES) {
        if (await feature.handleModal?.(interaction)) return;
      }
    } else if (interaction.isButton()) {
      for (const feature of FEATURES) {
        if (await feature.handleButton?.(interaction)) return;
      }
    }
  } catch (error) {
    logger.error('Error in interaction handler:', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: '⚠️ An unexpected error occurred.', flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
    }
  }
}

/**
 * Message pipeline: each feature sees the message in `FEATURES` order until one
 * returns `true` to take it over (the ticket counter is passive and never does). A
 * feature that throws is logged and skipped so one bad handler can't silence the rest.
 */
export async function handleMessage(message: Message): Promise<void> {
  // Guild-only: never act on a DM.
  if (!message.inGuild()) return;
  for (const feature of FEATURES) {
    try {
      if (await feature.handleMessage?.(message)) return;
    } catch (error) {
      logger.error(`[${feature.name}] message handler failed:`, error);
    }
  }
}
