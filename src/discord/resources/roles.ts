import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} from 'discord.js';
import { logger } from '../../lib/logger.js';
import { ID } from '../constants.js';

/**
 * Roles members can self-assign via the buttons `/roles` posts. Resolved by NAME
 * at click time, so the role must exist with this exact name in the guild and the
 * bot's own role must sit ABOVE it with the Manage Roles permission.
 */
export const CLAIMABLE_ROLES = [
  { key: 'builder', label: 'Builder', roleName: 'Builder', emoji: '🛠️' },
  { key: 'events', label: 'Events', roleName: 'Events', emoji: '📅' },
] as const;

/** /roles — posts the self-assign role buttons. Mod-gated. */
export const rolesCommand = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Post the self-assign role buttons (Builder, Events).')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
  .setDMPermission(false)
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Channel to post into (defaults to the current channel).')
      .addChannelTypes(ChannelType.GuildText),
  )
  .toJSON();

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
 * Posts the button row on its own, so any explanatory text can be written
 * separately with `/post` and this sits beneath it.
 */
export async function handleRolesCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.reply({
      content: '⛔ Only moderators can post the role buttons.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guild) {
    await interaction.editReply('⚠️ This command must be used in a server.');
    return;
  }

  const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.editReply('⚠️ Pick a server text channel to post into.');
    return;
  }

  try {
    const posted = await channel.send({
      components: [buildClaimRow()],
      allowedMentions: { parse: [] },
    });
    await interaction.editReply(`✅ Role buttons posted: ${posted.url}`);
  } catch (error) {
    logger.error('Failed to post role buttons:', error);
    await interaction.editReply(
      `⚠️ Failed to post: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
