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
  type Role,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { logger } from '../../lib/logger.js';
import { ID } from '../constants.js';

/** Discord's per-message content ceiling; the modal input is capped to match. */
const MESSAGE_CONTENT_LIMIT = 2000;
/** Discord's button label ceiling — role names may exceed it. */
const BUTTON_LABEL_LIMIT = 80;
/** One action row holds at most five buttons, so at most five roles per post. */
const MAX_ROLES = 5;

const ellipsize = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** /roles — posts self-assign buttons for whichever roles are chosen. Mod-gated. */
export const rolesCommand = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Post self-assign role buttons for roles you choose.')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
  .setDMPermission(false)
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Channel to post into (defaults to the current channel).')
      .addChannelTypes(ChannelType.GuildText),
  )
  .toJSON();

/** A claim button per chosen role. The role id travels in the custom id, so nothing
 * about the guild's roles is baked into the source. */
function buildClaimRow(roles: readonly Role[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    roles.map((role) =>
      new ButtonBuilder()
        .setCustomId(`${ID.claimRole}:${role.id}`)
        .setLabel(ellipsize(role.name, BUTTON_LABEL_LIMIT))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

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
        .setLabel('Roles')
        .setDescription(`Pick up to ${MAX_ROLES} — one button each.`)
        .setRoleSelectMenuComponent(
          new RoleSelectMenuBuilder()
            .setCustomId('roles')
            .setPlaceholder('Choose the roles members can claim')
            .setMinValues(1)
            .setMaxValues(MAX_ROLES),
        ),
      new LabelBuilder()
        .setLabel('Intro text')
        .setDescription('Shown above the buttons. Optional.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('content')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(MESSAGE_CONTENT_LIMIT)
            .setRequired(false),
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

  // The select resolves to raw API roles; re-resolve each id against the guild so we
  // hold real Role objects (needed for the hierarchy check and for assignment).
  await interaction.guild.roles.fetch().catch(() => null);
  const selected = interaction.fields.getSelectedRoles('roles');
  const roles = [...(selected?.keys() ?? [])]
    .map((id) => interaction.guild?.roles.cache.get(id))
    .filter((r): r is Role => r !== undefined);
  if (roles.length === 0) {
    await interaction.editReply('⚠️ Pick at least one role.');
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

  // Surface an unassignable role now rather than letting members discover it by
  // clicking: the bot needs Manage Roles and its own role must outrank the target.
  const me = await interaction.guild.members.fetchMe().catch(() => null);
  const canManage = me?.permissions.has(PermissionsBitField.Flags.ManageRoles) ?? false;
  const tooHigh = me
    ? roles.filter((r) => me.roles.highest.comparePositionTo(r) <= 0).map((r) => r.name)
    : [];

  try {
    const posted = await channel.send({
      // Buttons alone are a valid message, so empty text simply omits the line.
      ...(content ? { content } : {}),
      components: [buildClaimRow(roles)],
      allowedMentions: { parse: [] },
    });
    const warnings = [
      canManage ? '' : "⚠️ I lack **Manage Roles**, so clicks won't work until that's granted.",
      tooHigh.length
        ? `⚠️ My role sits below ${tooHigh.map((n) => `**${n}**`).join(', ')} — move my role above them.`
        : '',
    ].filter(Boolean);
    await interaction.editReply([`✅ Role buttons posted: ${posted.url}`, ...warnings].join('\n'));
  } catch (error) {
    logger.error('Failed to post role buttons:', error);
    await interaction.editReply(
      `⚠️ Failed to post: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Toggles the clicked role on the clicking member. Open to any member (role buttons
 * are not behind the owner gate). The role is resolved by id from the custom id.
 */
export async function handleRoleClaim(interaction: ButtonInteraction): Promise<void> {
  const roleId = interaction.customId.slice(`${ID.claimRole}:`.length);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guild) {
    await interaction.editReply('⚠️ Roles can only be claimed in a server.');
    return;
  }
  // Buttons from an older panel carried a name key rather than a role id.
  if (!/^\d{17,20}$/.test(roleId)) {
    await interaction.editReply(
      '⚠️ This button is from an older panel and no longer works — ask a moderator to re-post it with `/roles`.',
    );
    return;
  }

  const role =
    interaction.guild.roles.cache.get(roleId) ??
    (await interaction.guild.roles.fetch(roleId).catch(() => null));
  if (!role) {
    await interaction.editReply('⚠️ That role no longer exists — ask a moderator to re-post this.');
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
