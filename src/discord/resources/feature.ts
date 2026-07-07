import {
  type ButtonInteraction,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
} from 'discord.js';
import { ID } from '../constants.js';
import type { Feature } from '../feature.js';
import { handleResourcesCommand, handleRoleClaim } from './post.js';

/** /resources — posts the community resources panel + role-claim buttons. Mod-gated. */
const resourcesCommand = new SlashCommandBuilder()
  .setName('resources')
  .setDescription('Post the community resources panel (contacts, roles, protocol, links…).')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
  .setDMPermission(false)
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Channel to post into (defaults to the current channel).')
      .addChannelTypes(ChannelType.GuildText),
  )
  .toJSON();

export const resourcesFeature: Feature = {
  name: 'resources',
  commands: [resourcesCommand],
  handleCommand: handleResourcesCommand,
  handleButton: async (interaction: ButtonInteraction) => {
    // Self-assign role buttons (`claim_role:<key>`) — open to any member.
    if (!interaction.customId.startsWith(`${ID.claimRole}:`)) return false;
    await handleRoleClaim(interaction);
    return true;
  },
};
