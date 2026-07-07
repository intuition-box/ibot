import {
  type Guild,
  type GuildMember,
  type OverwriteResolvable,
  PermissionsBitField,
} from 'discord.js';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { MODERATOR_ROLES } from './constants.js';

/**
 * Owner allowlist gate for slash commands. If OWNER_IDS is configured, only those
 * users pass (everyone else is silently ignored); if it's empty, everyone passes
 * here and the command's own ManageGuild permission governs instead.
 */
export function isOwner(userId: string): boolean {
  return env.ownerIds.length === 0 || env.ownerIds.includes(userId);
}

/**
 * Authorization guard for moderator-only ticket actions (close/reopen/delete).
 * Gates on either the ManageChannels permission or membership in a moderator role.
 */
export function isModerator(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return true;
  return member.roles.cache.some((role) =>
    (MODERATOR_ROLES as readonly string[]).includes(role.name),
  );
}

/**
 * Builds channel permission overwrites granting each configured moderator role
 * view + send access to a new ticket channel.
 */
export function buildRoleOverwrites(guild: Guild): OverwriteResolvable[] {
  if (!guild?.roles) {
    logger.warn('Invalid guild provided to buildRoleOverwrites');
    return [];
  }
  return MODERATOR_ROLES.map((name) => guild.roles.cache.find((r) => r.name === name))
    .filter((role): role is NonNullable<typeof role> => Boolean(role))
    .map((role) => ({
      id: role.id,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
    }));
}
