import {
  ActionRowBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
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

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Discord's per-message content ceiling; the modal input is capped to match. */
const MESSAGE_CONTENT_LIMIT = 2000;

/**
 * `/update` — edit one of the bot's OWN posted messages (e.g. a `/resources` page)
 * in place. A bot can only edit messages it authored, so this is scoped to that;
 * it never posts a new message or pings anyone.
 */
export const updateCommand = new SlashCommandBuilder()
  .setName('update')
  .setDescription("Edit one of the bot's posted messages (e.g. a resources page) in place.")
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
  .setDMPermission(false)
  .addStringOption((o) =>
    o
      .setName('message')
      .setDescription('Message ID or link of the message to edit.')
      .setRequired(true),
  )
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Channel the message is in (defaults to the current channel).')
      .addChannelTypes(ChannelType.GuildText),
  )
  .toJSON();

/** Accepts a raw message ID or a full message link; resolves channel + message ids. */
function parseMessageRef(
  input: string,
  fallbackChannelId: string,
): { channelId: string; messageId: string } | null {
  const trimmed = input.trim();
  // https://discord.com/channels/<guild>/<channel>/<message>
  const link = trimmed.match(/channels\/\d+\/(\d+)\/(\d+)/);
  if (link) return { channelId: link[1], messageId: link[2] };
  if (/^\d{17,20}$/.test(trimmed)) return { channelId: fallbackChannelId, messageId: trimmed };
  return null;
}

export async function handleUpdateCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // Owner allowlist is enforced upstream; re-check ManageGuild for defense-in-depth.
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.reply({
      content: '⛔ Only moderators can edit posted messages.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!interaction.guild) {
    await interaction.reply({ content: '⚠️ Use this in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const ref = parseMessageRef(
    interaction.options.getString('message', true),
    interaction.options.getChannel('channel')?.id ?? interaction.channelId,
  );
  if (!ref) {
    await interaction.reply({
      content: '⚠️ Give a message **ID** or a message **link**.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = await interaction.guild.channels.fetch(ref.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.reply({
      content: '⚠️ Could not find that text channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const message = await channel.messages.fetch(ref.messageId).catch(() => null);
  if (!message) {
    await interaction.reply({
      content: '⚠️ Could not find that message in the channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (message.author.id !== interaction.client.user?.id) {
    await interaction.reply({
      content: '⚠️ I can only edit messages **I** posted myself.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Pre-fill the modal with the current content so the editor just tweaks it
  // (e.g. appends a link) rather than retyping the whole page.
  const input = new TextInputBuilder()
    .setCustomId('content')
    .setLabel('Message content')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(MESSAGE_CONTENT_LIMIT)
    .setRequired(true)
    .setValue(message.content.slice(0, MESSAGE_CONTENT_LIMIT));

  const modal = new ModalBuilder()
    // customId carries the target so the submit handler knows what to edit.
    .setCustomId(`${ID.updateModal}:${ref.channelId}:${ref.messageId}`)
    .setTitle('Edit message')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

  await interaction.showModal(modal);
}

export async function handleUpdateModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [, channelId, messageId] = interaction.customId.split(':');
  if (!channelId || !messageId || !interaction.guild) {
    await interaction.editReply('⚠️ Malformed edit request.');
    return;
  }

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  const message = channel?.isTextBased()
    ? await channel.messages.fetch(messageId).catch(() => null)
    : null;
  if (!message) {
    await interaction.editReply('⚠️ That message no longer exists.');
    return;
  }
  if (message.author.id !== interaction.client.user?.id) {
    await interaction.editReply('⚠️ I can only edit my own messages.');
    return;
  }

  const content = interaction.fields.getTextInputValue('content');
  try {
    await message.edit({ content, allowedMentions: { parse: [] } });
    await interaction.editReply(`✅ Updated ${message.url}`);
  } catch (error) {
    logger.error('Failed to edit message:', error);
    await interaction.editReply(`⚠️ Edit failed: ${errMsg(error)}`);
  }
}
