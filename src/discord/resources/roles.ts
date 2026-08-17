import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionsBitField,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { logger } from '../../lib/logger.js';
import { ID } from '../constants.js';

/** Discord's per-message content ceiling; the modal input is capped to match. */
const MESSAGE_CONTENT_LIMIT = 2000;

/** Pre-filled in the form so the box is never blank; edit or clear it freely. */
const DEFAULT_INTRO = [
  '​',
  '> Toggle to claim/remove a role with the buttons below.',
  '> **Builder** — you’re actively building on Intuition.',
  '> **Events** — get notified about community events, calls, and activities.',
].join('\n');

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
 * Opens a form for the explanatory text that sits above the buttons. Text and
 * buttons go out as ONE message — the content renders above the action row — so
 * they can never drift apart, and `/update` can reword the text later without
 * disturbing the buttons.
 */
export async function handleRolesCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.reply({
      content: '⛔ Only moderators can post the role buttons.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!interaction.guild) {
    await interaction.reply({
      content: '⚠️ This command must be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;

  const modal = new ModalBuilder()
    .setCustomId(`${ID.rolesModal}:${channelId}`)
    .setTitle('Post role buttons')
    .addComponents(
      new LabelBuilder()
        .setLabel('Intro text')
        .setDescription('Shown above the buttons. Optional, but gives members context.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('content')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(MESSAGE_CONTENT_LIMIT)
            .setRequired(false)
            .setValue(DEFAULT_INTRO),
        ),
    );

  await interaction.showModal(modal);
}

export async function handleRolesModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [, channelId] = interaction.customId.split(':');
  if (!channelId || !interaction.guild) {
    await interaction.editReply('⚠️ Malformed request.');
    return;
  }

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.editReply('⚠️ Pick a server text channel to post into.');
    return;
  }

  // A throw here would land after deferReply(), where the router can no longer reply.
  let raw = '';
  try {
    raw = interaction.fields.getTextInputValue('content');
  } catch {
    raw = '';
  }
  const content = raw.trim() ? raw : undefined;

  try {
    const posted = await channel.send({
      // Buttons alone are a valid message, so empty text simply omits the line.
      ...(content ? { content } : {}),
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
