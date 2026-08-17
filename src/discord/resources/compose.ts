import {
  ChannelType,
  type ChatInputCommandInteraction,
  ComponentType,
  FileUploadBuilder,
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

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Discord's per-message content ceiling; the modal input is capped to match. */
const MESSAGE_CONTENT_LIMIT = 2000;

/**
 * `/post` — compose a page from a modal: an optional banner image plus a markdown
 * body, posted as a banner message with the text beneath it. The reply hands back
 * the text message's link, which `/update` edits in place afterwards.
 */
export const postCommand = new SlashCommandBuilder()
  .setName('post')
  .setDescription('Compose a new message (optional image + text) via a form.')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
  .setDMPermission(false)
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Channel to post into (defaults to the current channel).')
      .addChannelTypes(ChannelType.GuildText),
  )
  .toJSON();

export async function handlePostCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // Owner allowlist is enforced upstream; re-check ManageGuild for defense-in-depth.
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.reply({
      content: '⛔ Only moderators can post messages.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!interaction.guild) {
    await interaction.reply({ content: '⚠️ Use this in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;

  const modal = new ModalBuilder()
    // customId carries the destination so the submit handler knows where to post.
    .setCustomId(`${ID.postModal}:${targetId}`)
    .setTitle('New post')
    .addComponents(
      new LabelBuilder()
        .setLabel('Banner image')
        .setDescription('Optional. Posted as its own message above the text.')
        .setFileUploadComponent(
          new FileUploadBuilder().setCustomId('image').setRequired(false).setMaxValues(1),
        ),
      new LabelBuilder()
        .setLabel('Message text')
        .setDescription('Discord markdown. Lines starting with > render as a quote block.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('content')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(MESSAGE_CONTENT_LIMIT)
            .setRequired(true),
        ),
    );

  await interaction.showModal(modal);
}

export async function handlePostModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [, channelId] = interaction.customId.split(':');
  if (!channelId || !interaction.guild) {
    await interaction.editReply('⚠️ Malformed post request.');
    return;
  }

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.editReply('⚠️ Could not find that text channel.');
    return;
  }

  const content = interaction.fields.getTextInputValue('content');
  // The file field is optional, so it may be absent entirely — never throw on a miss.
  let imageUrl: string | undefined;
  try {
    imageUrl = interaction.fields
      .getField('image', ComponentType.FileUpload)
      .attachments.first()?.url;
  } catch {
    imageUrl = undefined;
  }

  try {
    // Banner first as its own message, matching the /resources panel layout.
    if (imageUrl) await channel.send({ files: [imageUrl] });
    const posted = await channel.send({ content, allowedMentions: { parse: [] } });
    // Hand back the text message's link — that's the id `/update` edits later.
    await interaction.editReply(`✅ Posted: ${posted.url}\nEdit it later with \`/update\`.`);
  } catch (error) {
    logger.error('Failed to post message:', error);
    await interaction.editReply(`⚠️ Post failed: ${errMsg(error)}`);
  }
}
