import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { ID } from '../constants.js';

/** Initial category-selection row shown in a fresh ticket. Close stays enabled. */
export function createFormButtonRow(disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ID.formMissions)
      .setLabel('Missions')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(ID.formGrants)
      .setLabel('Grants')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(ID.formPartnership)
      .setLabel('Partnership')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(ID.formGeneral)
      .setLabel('General Help')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(ID.formClose)
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger),
  );
}

export function createConfirmationRow(
  yesId: string,
  noId: string,
  yesLabel = 'Yes',
  noLabel = 'Cancel',
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(yesId).setLabel(yesLabel).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(noId).setLabel(noLabel).setStyle(ButtonStyle.Secondary),
  );
}

/** Delete + Reopen row posted after a ticket is closed (moderator actions). */
export function createPostCloseRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ID.deleteTicket)
      .setLabel('Delete Ticket')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(ID.reopenTicket)
      .setLabel('Reopen Ticket')
      .setStyle(ButtonStyle.Success),
  );
}

const shortInput = (customId: string, label: string, required: boolean, maxLength: number) =>
  new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(required)
      .setMaxLength(maxLength),
  );

const paragraphInput = (customId: string, label: string, required: boolean, maxLength: number) =>
  new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(required)
      .setMaxLength(maxLength),
  );

export function buildMissionsModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ID.modalMissions)
    .setTitle('Mission Submission')
    .addComponents(
      shortInput('mission', 'Mission (name or number)', true, 100),
      paragraphInput('description', 'What did you do / propose?', true, 1000),
      shortInput('link', 'Link or proof (optional)', false, 300),
      shortInput('wallet', 'Wallet address for rewards (optional)', false, 200),
      paragraphInput('additional_info', 'Additional information (optional)', false, 1000),
    );
}

export function buildGrantsModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ID.modalGrants)
    .setTitle('Grant Application')
    .addComponents(
      shortInput('project', 'Project name', true, 100),
      paragraphInput('description', 'What are you building?', true, 1000),
      shortInput('amount', 'Requested amount / budget (optional)', false, 100),
      shortInput('links', 'Links — site, repo, deck (optional)', false, 300),
      paragraphInput('additional_info', 'Additional information (optional)', false, 1000),
    );
}

export function buildPartnershipModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ID.modalPartnership)
    .setTitle('Partnership')
    .addComponents(
      shortInput('name', 'Name', true, 100),
      shortInput('company', 'Entity or Company', false, 200),
      shortInput('website', 'Website', false, 200),
      shortInput('contact', 'Point of Contact', true, 200),
      paragraphInput('additional_info', 'Additional Information', false, 1000),
    );
}

export function buildGeneralModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ID.modalGeneral)
    .setTitle('General Help')
    .addComponents(paragraphInput('description', 'Describe your issue', true, 2000));
}
