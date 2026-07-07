import { PermissionsBitField, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import { closeDb } from '../../db/client.js';
import { getStats } from '../../db/tickets.js';
import { logger } from '../../lib/logger.js';
import { ID } from '../constants.js';
import type { Feature } from '../feature.js';
import { countTicketMessage } from './counter.js';
import { handleModalSubmit, handleSupportButton, handleSupportCommand } from './handlers.js';
import { clearChannelState } from './state.js';

/** /support — posts the ticket-creation panel. Mod-gated (ManageGuild). */
const supportCommand: RESTPostAPIApplicationCommandsJSONBody = {
  name: 'support',
  description: 'Post the button that lets members open support tickets.',
  default_member_permissions: PermissionsBitField.Flags.ManageGuild.toString(),
  dm_permission: false,
};

/** The buttons Cubeo's ticket flow owns (everything in `handleSupportButton`). */
const SUPPORT_BUTTON_IDS: ReadonlySet<string> = new Set([
  ID.createTicket,
  ID.formClose,
  ID.formMissions,
  ID.formGrants,
  ID.formPartnership,
  ID.formGeneral,
  ID.confirmCloseYes,
  ID.confirmCloseNo,
  ID.deleteTicket,
  ID.confirmDeleteYes,
  ID.confirmDeleteNo,
  ID.reopenTicket,
  ID.confirmReopenYes,
  ID.confirmReopenNo,
  ID.confirmFormYes,
  ID.confirmFormNo,
]);

/** The ticket-form modals. */
const SUPPORT_MODAL_IDS: ReadonlySet<string> = new Set([
  ID.modalMissions,
  ID.modalGrants,
  ID.modalPartnership,
  ID.modalGeneral,
]);

export const supportFeature: Feature = {
  name: 'support',
  commands: [supportCommand],
  handleCommand: handleSupportCommand,
  handleButton: async (interaction) => {
    if (!SUPPORT_BUTTON_IDS.has(interaction.customId)) return false;
    await handleSupportButton(interaction);
    return true;
  },
  handleModal: async (interaction) => {
    if (!SUPPORT_MODAL_IDS.has(interaction.customId)) return false;
    await handleModalSubmit(interaction);
    return true;
  },
  handleMessage: (message) => {
    countTicketMessage(message);
    return false; // passive counter — never takes over the message
  },
  onReady: () => {
    const stats = getStats();
    if (stats) {
      logger.info(
        `📊 ${stats.total_tickets} tickets — ${stats.open_tickets} open, ${stats.closed_tickets} closed, ${stats.deleted_tickets} deleted · ${stats.avg_messages.toFixed(1)} avg msgs/ticket, ${stats.total_reopens} reopens`,
      );
    }
  },
  onShutdown: () => closeDb(),
  // Free a ticket channel's in-memory UI state once the channel itself is gone
  // (bot-initiated delete or a manual one). No-op for non-ticket channels.
  onChannelDelete: (channelId) => clearChannelState(channelId),
};
