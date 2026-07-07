import fs from 'node:fs';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionsBitField,
} from 'discord.js';
import { logger } from '../../lib/logger.js';
import { ID } from '../constants.js';
import { CLAIMABLE_ROLES, RESOURCE_SECTIONS } from './content.js';

const BANNER_DIR = path.join('data', 'images', 'banners');

/** Buttons that let any member self-assign the claimable roles. */
function buildClaimRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    CLAIMABLE_ROLES.map((r) =>
      new ButtonBuilder()
        .setCustomId(`${ID.claimRole}:${r.key}`)
        .setLabel(r.label)
        .setEmoji(r.emoji)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

/**
 * `/resources` — posts the community resources panel (banner + text per section,
 * plus the role-claim buttons) into the chosen channel. Owner-gated upstream in
 * handleInteraction; re-checks ManageGuild here for defense-in-depth.
 */
export async function handleResourcesCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.reply({
      content: '⛔ Only moderators can post the resources panel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guild) {
    await interaction.editReply('⚠️ This command must be used in a server.');
    return;
  }

  const picked = interaction.options.getChannel('channel');
  const channelId = picked?.id ?? interaction.channelId;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.editReply('⚠️ Pick a server text channel to post into.');
    return;
  }

  try {
    for (const section of RESOURCE_SECTIONS) {
      const bannerPath = section.banner ? path.join(BANNER_DIR, section.banner) : null;
      const hasBanner = bannerPath !== null && fs.existsSync(bannerPath);
      if (hasBanner && bannerPath) await channel.send({ files: [bannerPath] });
      // When a banner is present it serves as the header, so skip the text title.
      const header = hasBanner ? '' : `**${section.title}**\n`;
      await channel.send({ content: `${header}${section.body}`, allowedMentions: { parse: [] } });
      if (section.claimButtons) {
        await channel.send({ components: [buildClaimRow()], allowedMentions: { parse: [] } });
      }
    }
  } catch (error) {
    logger.error('Failed to post resources panel:', error);
    await interaction.editReply(
      `⚠️ Posted partially — a message failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  await interaction.editReply(`✅ Resources panel posted to <#${channel.id}>.`);
}

/**
 * Toggles a claimable role on the clicking member. Open to any member (role
 * buttons are not behind the owner gate). Resolves the role by name.
 */
export async function handleRoleClaim(interaction: ButtonInteraction): Promise<void> {
  const key = interaction.customId.slice(`${ID.claimRole}:`.length);
  const spec = CLAIMABLE_ROLES.find((r) => r.key === key);
  if (!spec) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guild) {
    await interaction.editReply('⚠️ Roles can only be claimed in a server.');
    return;
  }

  const role = interaction.guild.roles.cache.find((r) => r.name === spec.roleName);
  if (!role) {
    await interaction.editReply(
      `⚠️ The **${spec.roleName}** role doesn't exist yet — ask a moderator to create it.`,
    );
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.editReply('⚠️ Could not resolve your server membership.');
    return;
  }

  try {
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      await interaction.editReply(`➖ Removed the **${role.name}** role.`);
    } else {
      await member.roles.add(role);
      await interaction.editReply(`➕ You now have the **${role.name}** role.`);
    }
  } catch (error) {
    logger.warn('Role claim failed:', error);
    await interaction.editReply(
      `⚠️ I couldn't change that role — I may lack **Manage Roles**, or my role sits below **${role.name}**. Ask a moderator.`,
    );
  }
}
