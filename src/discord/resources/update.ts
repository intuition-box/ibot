import {
  ChannelType,
  type ChatInputCommandInteraction,
  FileUploadBuilder,
  LabelBuilder,
  type MessageEditOptions,
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
 * Discord rejects a Label description over 100 characters, and the builder throws
 * while assembling the modal — which would make the message uneditable rather than
 * merely ugly. Filenames are user-supplied, so both the name and the finished
 * sentence are bounded.
 */
const LABEL_DESCRIPTION_LIMIT = 100;
const FILENAME_DISPLAY_LIMIT = 32;
const ellipsize = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * `/update` — edit one of the bot's OWN posted messages in place. A bot can only
 * edit messages it authored, so this is scoped to that; it never posts a new
 * message or pings anyone.
 */
export const updateCommand = new SlashCommandBuilder()
  .setName('update')
  .setDescription("Edit one of the bot's posted messages (text and/or image) in place.")
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

  // The modal adapts to what the message actually holds: a banner message has no
  // text, so the text field must be optional and unset rather than a required
  // field pre-filled with an empty string (which cannot be submitted).
  const current = message.attachments.first();
  const text = new TextInputBuilder()
    .setCustomId('content')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(MESSAGE_CONTENT_LIMIT)
    .setRequired(false);
  if (message.content) text.setValue(message.content.slice(0, MESSAGE_CONTENT_LIMIT));

  const modal = new ModalBuilder()
    // customId carries the target so the submit handler knows what to edit.
    .setCustomId(`${ID.updateModal}:${ref.channelId}:${ref.messageId}`)
    .setTitle('Edit message')
    .addComponents(
      new LabelBuilder()
        .setLabel('Message text')
        .setDescription(
          message.content ? 'Edit the text below.' : 'This message has no text — optional.',
        )
        .setTextInputComponent(text),
      new LabelBuilder()
        .setLabel('Image')
        // Modals can't render a preview, so name the current file instead.
        .setDescription(
          ellipsize(
            current
              ? `Currently: ${ellipsize(current.name, FILENAME_DISPLAY_LIMIT)}. Upload to replace it, or leave empty to keep it.`
              : 'Optional. Upload an image to add one.',
            LABEL_DESCRIPTION_LIMIT,
          ),
        )
        .setFileUploadComponent(
          new FileUploadBuilder().setCustomId('image').setRequired(false).setMaxValues(1),
        ),
    );

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

  // Both fields are optional, so either may be missing from the submission. A throw
  // here would land after deferReply(), where the router can no longer reply — the
  // moderator would just watch "thinking…" forever.
  let raw = '';
  try {
    raw = interaction.fields.getTextInputValue('content');
  } catch {
    raw = '';
  }
  // Treat a whitespace-only box as a deliberate clear, so an edit can't leave an
  // invisible blank line under a banner.
  const content = raw.trim() ? raw : '';
  const upload = interaction.fields.getUploadedFiles('image')?.first();
  // The attachment the modal named as "Currently: …" — the one an upload replaces.
  const current = message.attachments.first();

  // Discord rejects an edit that would leave a message with nothing in it. Embeds,
  // components, polls and stickers all keep a message valid, so none of them may
  // count as "empty" — the /roles button row has no text or attachments at all.
  const keepsBody =
    upload !== undefined ||
    message.attachments.size > 0 ||
    message.embeds.length > 0 ||
    message.components.length > 0 ||
    message.stickers.size > 0;
  if (!content && !keepsBody) {
    await interaction.editReply(
      '⚠️ That would leave the message empty. Add text, or upload an image.',
    );
    return;
  }

  const payload: MessageEditOptions = { content, allowedMentions: { parse: [] } };
  if (upload) {
    // `attachments` is the KEEP list — omitting it keeps everything. discord.js
    // appends the new upload, so listing every attachment EXCEPT the one the modal
    // named replaces just that file instead of silently dropping the others.
    payload.attachments = [...message.attachments.values()]
      .filter((a) => a.id !== current?.id)
      .map((a) => ({ id: a.id }));
    // Pass the name explicitly: from a bare CDN url discord.js derives the filename
    // via basename(), which would bake the signed query string into it.
    payload.files = [{ attachment: upload.url, name: upload.name }];
  }

  try {
    await message.edit(payload);
    await interaction.editReply(`✅ Updated ${message.url}${upload ? ' (image replaced)' : ''}`);
  } catch (error) {
    logger.error('Failed to edit message:', error);
    await interaction.editReply(`⚠️ Edit failed: ${errMsg(error)}`);
  }
}
