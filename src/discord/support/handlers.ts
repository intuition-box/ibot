import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  type GuildMember,
  type Interaction,
  MessageFlags,
  type ModalBuilder,
  type ModalSubmitInteraction,
  PermissionsBitField,
  type TextChannel,
} from 'discord.js';
import { CONFIG, env } from '../../config.js';
import {
  closeTicket,
  createTicket,
  getNextTicketNumber,
  getTicketByChannel,
  markTicketDeleted,
  reopenTicket,
  updateForm,
} from '../../db/tickets.js';
import { logger } from '../../lib/logger.js';
import { client, getUserTag } from '../client.js';
import {
  EMBED_COLOR,
  EMBED_FIELD_LIMIT,
  ID,
  SUPPORT_BANNER_PATH,
  UNLOCK_MESSAGE,
} from '../constants.js';
import { buildRoleOverwrites, isModerator } from '../permissions.js';
import {
  buildGeneralModal,
  buildGrantsModal,
  buildMissionsModal,
  buildPartnershipModal,
  createConfirmationRow,
  createFormButtonRow,
  createPostCloseRow,
} from './components.js';
import {
  clearChannelState,
  formSummaryMap,
  initialButtonMessageMap,
  unlockMessageMap,
} from './state.js';
import { generateTags } from './tags.js';
import { buildTranscript, fetchFullHistory } from './transcript.js';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function sanitizeInput(input: string | undefined, maxLength = 1000): string {
  if (typeof input !== 'string') return '';
  // Bound the length only. We deliberately do NOT strip `@`/`<`/`>` — that
  // corrupted legitimate contacts (emails, @handles). The form data is only ever
  // rendered inside embeds, which never trigger mentions, so there's no ping risk.
  return input.trim().slice(0, maxLength);
}

/** Builds a length-safe embed field (Discord caps `value` at 1024 chars). */
const field = (name: string, value: string) => ({
  name,
  value: (value || 'Not provided').slice(0, EMBED_FIELD_LIMIT),
});

function asTextChannel(interaction: { channel: Interaction['channel'] }): TextChannel | null {
  const ch = interaction.channel;
  return ch?.type === ChannelType.GuildText ? ch : null;
}

async function ephemeral(
  interaction: ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction,
  content: string,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    logger.debug('Ephemeral reply failed:', error);
  }
}

async function resolveMember(interaction: ButtonInteraction): Promise<GuildMember | null> {
  if (!interaction.guild) return null;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

/** Authorization gate for moderator-only actions (delete, reopen). */
async function ensureModerator(interaction: ButtonInteraction): Promise<boolean> {
  if (isModerator(await resolveMember(interaction))) return true;
  await ephemeral(interaction, '⛔ Only moderators can do that.');
  return false;
}

/** Close is allowed for the ticket owner or any moderator. */
async function ensureCanClose(interaction: ButtonInteraction): Promise<boolean> {
  const channel = asTextChannel(interaction);
  const ticket = channel ? getTicketByChannel(channel.id) : undefined;
  const member = await resolveMember(interaction);
  if (isModerator(member) || (ticket && interaction.user.id === ticket.authorId)) return true;
  await ephemeral(interaction, '⛔ Only the ticket owner or a moderator can close this ticket.');
  return false;
}

async function disableInitialButtons(channel: TextChannel): Promise<void> {
  const initMsgId = initialButtonMessageMap.get(channel.id);
  if (!initMsgId) return;
  const initMsg = await channel.messages.fetch(initMsgId).catch(() => null);
  // createFormButtonRow(true) disables the category buttons; Close stays enabled.
  await initMsg?.edit({ components: [createFormButtonRow(true)] }).catch(() => undefined);
}

async function enableInitialButtons(channel: TextChannel): Promise<void> {
  const initMsgId = initialButtonMessageMap.get(channel.id);
  if (!initMsgId) return;
  const initMsg = await channel.messages.fetch(initMsgId).catch(() => null);
  await initMsg?.edit({ components: [createFormButtonRow(false)] }).catch(() => undefined);
}

// ── Ticket button router ─────────────────────────────────────────────────────

/** Routes Cubeo's ticket buttons. The registry only calls this for ids it owns. */
export async function handleSupportButton(interaction: ButtonInteraction): Promise<void> {
  switch (interaction.customId) {
    case ID.createTicket:
      return handleCreateTicket(interaction);
    case ID.formClose:
      return handleCloseRequest(interaction);
    case ID.formMissions:
      return showModalSafe(interaction, buildMissionsModal());
    case ID.formGrants:
      return showModalSafe(interaction, buildGrantsModal());
    case ID.formPartnership:
      return showModalSafe(interaction, buildPartnershipModal());
    case ID.formGeneral:
      return showModalSafe(interaction, buildGeneralModal());
    case ID.confirmCloseYes:
      return handleCloseConfirm(interaction);
    case ID.deleteTicket:
      return handleDeleteRequest(interaction);
    case ID.confirmDeleteYes:
      return handleDeleteConfirm(interaction);
    case ID.reopenTicket:
      return handleReopenRequest(interaction);
    case ID.confirmReopenYes:
      return handleReopenConfirm(interaction);
    case ID.confirmFormYes:
      return handleFormConfirmYes(interaction);
    case ID.confirmCloseNo:
    case ID.confirmDeleteNo:
    case ID.confirmReopenNo:
    case ID.confirmFormNo:
      return handleFormConfirmNoOrCancel(interaction);
    default:
      return;
  }
}

// ── /support ─────────────────────────────────────────────────────────────────

export async function handleSupportCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // default_member_permissions gates this at Discord; re-check (admins can override it).
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await ephemeral(interaction, '⛔ Only moderators can post the support panel.');
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = asTextChannel(interaction);
  if (!channel) {
    await interaction.editReply('⚠️ This command must be used in a server text channel.');
    return;
  }

  try {
    await channel.send({ files: [SUPPORT_BANNER_PATH] });
  } catch (error) {
    await interaction.editReply(`⚠️ Failed to send support banner: ${errMsg(error)}`);
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ID.createTicket)
      .setLabel('Create Support Ticket')
      .setStyle(ButtonStyle.Primary),
  );
  try {
    await channel.send({
      content: '​\n> Interact with the button below to create your support ticket.\n​',
      components: [row],
    });
  } catch (error) {
    await interaction.editReply(`⚠️ Failed to send ticket button: ${errMsg(error)}`);
    return;
  }

  await interaction.editReply('✅ Ticket creation button posted!');
}

// ── Create ticket ──────────────────────────────────────────────────────────────

async function handleCreateTicket(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  if (!guild || !client.user) {
    await interaction.editReply('⚠️ This can only be used in a server.');
    return;
  }

  const ticketNumber = getNextTicketNumber();
  const name = `${CONFIG.TICKET_CHANNEL_PREFIX}${ticketNumber}`;

  // Warm the role cache first: buildRoleOverwrites reads guild.roles.cache, and on a
  // cold start that cache can miss a moderator role, silently omitting its overwrite
  // (making the new ticket invisible to mods). Fetch fails soft — fall back to cache.
  await guild.roles.fetch().catch((e) => logger.warn('Could not fetch guild roles:', e));

  let channel: TextChannel;
  try {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: env.openTicketsCategoryId,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel],
          deny: [PermissionsBitField.Flags.SendMessages],
        },
        {
          id: client.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        },
        ...buildRoleOverwrites(guild),
      ],
    });
  } catch (error) {
    await interaction.editReply(`⚠️ Failed to create ticket channel: ${errMsg(error)}`);
    return;
  }

  const authorTag = await getUserTag(interaction.user.id);
  const ticketRow = createTicket({
    ticketNumber,
    channelId: channel.id,
    channelName: channel.name,
    authorId: interaction.user.id,
    authorTag,
    guildId: guild.id,
  });
  if (ticketRow === null) {
    // No DB row means the ticket can't be archived on close (unrecoverable data
    // loss). Tear the channel back down instead of leaving an orphan.
    logger.error(`[createTicket] insert failed for #${name}; removing orphan channel`);
    await channel.delete('Ticket DB insert failed').catch(() => undefined);
    await interaction.editReply('⚠️ Couldn’t create your ticket (server error). Please try again.');
    return;
  }

  try {
    const initMsg = await channel.send({
      content: `Welcome, <@${interaction.user.id}>.\n\nI'm here to help with your support ticket. You can close it anytime with the "Close Ticket" button.\n\nPlease choose a category to start.\n​`,
      components: [createFormButtonRow(false)],
    });
    initialButtonMessageMap.set(channel.id, initMsg.id);
  } catch (error) {
    await interaction.editReply(`⚠️ Failed to send the initial ticket message: ${errMsg(error)}`);
    return;
  }

  await interaction.editReply(`Your ticket has been created: <#${channel.id}>`);
}

// ── Form modals ────────────────────────────────────────────────────────────────

async function showModalSafe(interaction: ButtonInteraction, modal: ModalBuilder): Promise<void> {
  try {
    await interaction.showModal(modal);
  } catch (error) {
    await ephemeral(interaction, `⚠️ Could not open the form: ${errMsg(error)}`);
  }
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const channel = asTextChannel(interaction);
  let formType: string;
  let embed: EmbedBuilder;
  let formData: Record<string, string>;

  try {
    switch (interaction.customId) {
      case ID.modalMissions: {
        const mission = sanitizeInput(interaction.fields.getTextInputValue('mission'));
        const description = sanitizeInput(
          interaction.fields.getTextInputValue('description'),
          1000,
        );
        const link = sanitizeInput(interaction.fields.getTextInputValue('link'), 300);
        const wallet = sanitizeInput(interaction.fields.getTextInputValue('wallet'));
        const additionalInfo = sanitizeInput(
          interaction.fields.getTextInputValue('additional_info'),
          1000,
        );
        formType = 'Missions';
        formData = { mission, description, link, wallet, additionalInfo };
        embed = new EmbedBuilder()
          .setTitle('🎯 Mission Submission')
          .setColor(EMBED_COLOR)
          .addFields(
            field('Mission', mission),
            field('Details', description),
            ...(link ? [field('Link / proof', link)] : []),
            ...(wallet ? [field('Wallet', wallet)] : []),
            ...(additionalInfo ? [field('Additional Info', additionalInfo)] : []),
          );
        break;
      }
      case ID.modalGrants: {
        const project = sanitizeInput(interaction.fields.getTextInputValue('project'));
        const description = sanitizeInput(
          interaction.fields.getTextInputValue('description'),
          1000,
        );
        const amount = sanitizeInput(interaction.fields.getTextInputValue('amount'), 100);
        const links = sanitizeInput(interaction.fields.getTextInputValue('links'), 300);
        const additionalInfo = sanitizeInput(
          interaction.fields.getTextInputValue('additional_info'),
          1000,
        );
        formType = 'Grants';
        formData = { project, description, amount, links, additionalInfo };
        embed = new EmbedBuilder()
          .setTitle('💰 Grant Application')
          .setColor(EMBED_COLOR)
          .addFields(
            field('Project', project),
            field('Description', description),
            ...(amount ? [field('Requested amount', amount)] : []),
            ...(links ? [field('Links', links)] : []),
            ...(additionalInfo ? [field('Additional Info', additionalInfo)] : []),
          );
        break;
      }
      case ID.modalPartnership: {
        const name = sanitizeInput(interaction.fields.getTextInputValue('name'));
        const company = sanitizeInput(interaction.fields.getTextInputValue('company'));
        const website = sanitizeInput(interaction.fields.getTextInputValue('website'));
        const contact = sanitizeInput(interaction.fields.getTextInputValue('contact'));
        const additionalInfo = sanitizeInput(
          interaction.fields.getTextInputValue('additional_info'),
          1000,
        );
        formType = 'Partnership';
        formData = { name, company, website, contact, additionalInfo };
        embed = new EmbedBuilder()
          .setTitle('🤝 Partnership')
          .setColor(EMBED_COLOR)
          .addFields(
            field('Name', name),
            ...(company ? [field('Company', company)] : []),
            ...(website ? [field('Website', website)] : []),
            field('Contact', contact),
            ...(additionalInfo ? [field('Additional Info', additionalInfo)] : []),
          );
        break;
      }
      case ID.modalGeneral: {
        const description = sanitizeInput(
          interaction.fields.getTextInputValue('description'),
          2000,
        );
        formType = 'General Help';
        formData = { description };
        embed = new EmbedBuilder()
          .setTitle('❔ General Help')
          .setColor(EMBED_COLOR)
          .addFields(field('Description', description));
        break;
      }
      default:
        return;
    }
  } catch (error) {
    logger.error('Error processing modal submission:', error);
    await ephemeral(interaction, '⚠️ There was an error processing your form submission.');
    return;
  }

  if (channel) updateForm(channel.id, formType, formData);
  if (channel) formSummaryMap.set(channel.id, { type: formType, embed });

  const preview = new EmbedBuilder()
    .setTitle('📋 Ticket Details')
    .setColor(EMBED_COLOR)
    .addFields({ name: 'Type', value: formType }, ...(embed.data.fields ?? []));

  await interaction.reply({
    content: 'Please confirm the details below:',
    embeds: [preview],
    components: [
      createConfirmationRow(ID.confirmFormYes, ID.confirmFormNo, 'Yes, correct', 'No, edit'),
    ],
    flags: MessageFlags.Ephemeral,
  });

  if (channel) await disableInitialButtons(channel);
}

// ── Form confirmation ──────────────────────────────────────────────────────────

async function handleFormConfirmYes(interaction: ButtonInteraction): Promise<void> {
  const channel = asTextChannel(interaction);
  await interaction.deferUpdate().catch(() => undefined);
  if (!channel) return;

  await channel.permissionOverwrites
    .edit(interaction.user.id, { SendMessages: true })
    .catch((e) => logger.warn('Could not unlock channel for user:', e));

  const unlockMsg = await channel.send(UNLOCK_MESSAGE).catch(() => null);
  if (unlockMsg) unlockMessageMap.set(channel.id, unlockMsg.id);

  const stored = formSummaryMap.get(channel.id);
  if (stored) {
    const details = new EmbedBuilder()
      .setTitle('📋 Ticket Details')
      .setColor(EMBED_COLOR)
      .addFields({ name: 'Type', value: stored.type }, ...(stored.embed.data.fields ?? []));
    await channel
      .send({ embeds: [details] })
      .catch((e) => logger.warn('Could not send ticket details:', e));
    formSummaryMap.delete(channel.id);
  }

  await disableInitialButtons(channel);
  await interaction.deleteReply().catch(() => undefined);
}

/** Handles all "No"/"Cancel" confirmation buttons: re-enable the form, dismiss. */
async function handleFormConfirmNoOrCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate().catch(() => undefined);
  if (interaction.customId === ID.confirmFormNo) {
    const channel = asTextChannel(interaction);
    if (channel) await enableInitialButtons(channel);
  }
  await interaction.deleteReply().catch(() => undefined);
}

// ── Close ────────────────────────────────────────────────────────────────────

async function handleCloseRequest(interaction: ButtonInteraction): Promise<void> {
  if (!(await ensureCanClose(interaction))) return;
  await interaction.reply({
    content: 'Are you sure you want to close this ticket?',
    components: [
      createConfirmationRow(ID.confirmCloseYes, ID.confirmCloseNo, 'Yes, close ticket', 'Cancel'),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleCloseConfirm(interaction: ButtonInteraction): Promise<void> {
  if (!(await ensureCanClose(interaction))) return;
  const channel = asTextChannel(interaction);
  if (!channel) return;

  await interaction.deferUpdate().catch(() => undefined);
  await interaction.deleteReply().catch(() => undefined);

  const saved = await handleClose(interaction, channel);
  if (!saved) {
    // Archiving the transcript failed — leave the ticket open (don't revoke
    // access or expose Delete) so the conversation can't be silently lost.
    await ephemeral(
      interaction,
      '⚠️ I couldn’t archive this ticket, so I left it open to avoid losing the conversation. Please try again, or contact an admin.',
    );
    return;
  }

  // Revoke access from the ticket AUTHOR, not whoever clicked Close — a moderator
  // may close someone else's ticket. Mirrors the reopen path (getTicketByChannel → authorId).
  const closedTicket = getTicketByChannel(channel.id);
  const authorId = closedTicket?.authorId;
  if (authorId) {
    await channel.permissionOverwrites
      .edit(authorId, { ViewChannel: false, SendMessages: false })
      .catch((e) => logger.warn('Could not revoke permissions on close:', e));
  }

  await channel
    .send({
      content: `Ticket closed by ${interaction.user.tag}. Moderators can now delete or reopen this ticket.\n​`,
      components: [createPostCloseRow()],
    })
    .catch((e) => logger.warn('Could not send close confirmation:', e));

  await disableInitialButtons(channel);
}

/**
 * Fetches history, builds and persists the transcript for a closing ticket.
 * Returns whether the transcript was durably saved — the caller MUST NOT reveal
 * the Delete button or revoke access when this is false (the DB is the only copy).
 */
async function handleClose(interaction: ButtonInteraction, channel: TextChannel): Promise<boolean> {
  logger.info(`[handleClose] Closing #${channel.name} by ${interaction.user.tag}`);
  try {
    const ticket = getTicketByChannel(channel.id);
    const messages = await fetchFullHistory(channel);
    const { header, body } = await buildTranscript(messages, channel, interaction.user.id, ticket);
    const fullTranscript = `${header}\n\n${body}`;

    const tags = generateTags(ticket?.formType, fullTranscript);
    const closerTag = await getUserTag(interaction.user.id);

    const saved = closeTicket({
      channelId: channel.id,
      closerId: interaction.user.id,
      closerTag,
      messageCount: messages.length,
      tags,
      transcript: fullTranscript,
    });
    if (!saved) logger.error(`[handleClose] DB close failed for #${channel.name}`);
    // Transcript lives in the DB only — no Discord channel archive (see transcript.ts).
    return saved;
  } catch (error) {
    logger.error('Error in handleClose:', error);
    return false;
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

async function handleDeleteRequest(interaction: ButtonInteraction): Promise<void> {
  if (!(await ensureModerator(interaction))) return;
  await interaction.reply({
    content: 'Are you sure you want to **delete** this ticket? This action is irreversible.',
    components: [
      createConfirmationRow(ID.confirmDeleteYes, ID.confirmDeleteNo, 'Yes, delete', 'Cancel'),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDeleteConfirm(interaction: ButtonInteraction): Promise<void> {
  if (!(await ensureModerator(interaction))) return;
  const channel = asTextChannel(interaction);
  if (!channel) return;

  await interaction.deferUpdate().catch(() => undefined);
  try {
    await channel.delete();
  } catch (error) {
    logger.error('Failed to delete ticket channel:', error);
    await ephemeral(interaction, '⚠️ Failed to delete the ticket channel.');
    return;
  }
  // Only record the terminal state once the channel is actually gone, so a failed
  // delete can't leave a live channel with a 'deleted' DB row. (channelDelete also
  // fires clearChannelState; this explicit call frees the state immediately.)
  markTicketDeleted(channel.id);
  clearChannelState(channel.id);
}

// ── Reopen ─────────────────────────────────────────────────────────────────────

async function handleReopenRequest(interaction: ButtonInteraction): Promise<void> {
  if (!(await ensureModerator(interaction))) return;
  await interaction.reply({
    content: 'Are you sure you want to **reopen** this ticket?',
    components: [
      createConfirmationRow(ID.confirmReopenYes, ID.confirmReopenNo, 'Yes, reopen', 'Cancel'),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReopenConfirm(interaction: ButtonInteraction): Promise<void> {
  if (!(await ensureModerator(interaction))) return;
  const channel = asTextChannel(interaction);
  if (!channel) return;

  await interaction.deferUpdate().catch(() => undefined);
  await interaction.deleteReply().catch(() => undefined);

  reopenTicket(channel.id);
  const ticket = getTicketByChannel(channel.id);
  const authorId = ticket?.authorId;

  if (authorId) {
    await channel.permissionOverwrites
      .edit(authorId, { ViewChannel: true, SendMessages: true })
      .catch((e) => logger.warn('Could not restore permissions on reopen:', e));
  }

  if (!formSummaryMap.has(channel.id)) await enableInitialButtons(channel);

  // Remove the old Delete/Reopen action message(s) left from the close.
  try {
    const recent = await channel.messages.fetch({ limit: 10 });
    for (const msg of recent.values()) {
      const hasActionButtons = msg.components?.some((row) => {
        if (row.type !== ComponentType.ActionRow) return false;
        return row.components.some((c) => {
          const cid = (c as { customId?: string | null }).customId;
          return cid === ID.deleteTicket || cid === ID.reopenTicket;
        });
      });
      if (hasActionButtons) await msg.delete().catch(() => undefined);
    }
  } catch (error) {
    logger.debug('Could not clean up old action buttons:', error);
  }

  const content = authorId
    ? `<@${authorId}>, this ticket has been reopened by the moderators. You may continue commenting.`
    : 'This ticket has been reopened. You may continue commenting.';
  await channel
    .send({ content })
    .catch((e) => logger.warn('Could not send reopen notification:', e));
}
