import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { ID } from '../constants.js';
import type { Feature } from '../feature.js';
import { handlePostCommand, handlePostModal, postCommand } from './compose.js';
import { handleRoleClaim, handleRolesCommand, handleRolesModal, rolesCommand } from './roles.js';
import { handleUpdateCommand, handleUpdateModal, updateCommand } from './update.js';

/** command name → handler, so adding a command is one entry rather than a branch. */
const COMMAND_HANDLERS: Record<
  string,
  (interaction: ChatInputCommandInteraction) => Promise<void>
> = {
  post: handlePostCommand,
  update: handleUpdateCommand,
  roles: handleRolesCommand,
};

/** modal customId prefix → handler. Prefixes carry their target ids after a `:`. */
const MODAL_HANDLERS: ReadonlyArray<{
  prefix: string;
  handle: (interaction: Parameters<NonNullable<Feature['handleModal']>>[0]) => Promise<void>;
}> = [
  { prefix: `${ID.postModal}:`, handle: handlePostModal },
  { prefix: `${ID.updateModal}:`, handle: handleUpdateModal },
  { prefix: `${ID.rolesModal}:`, handle: handleRolesModal },
];

/**
 * Content authoring: compose a message (`/post`), correct one in place (`/update`),
 * and post the self-assign role buttons (`/roles`). Panels are created on demand —
 * there is deliberately no hardcoded content to keep in sync.
 */
export const resourcesFeature: Feature = {
  name: 'resources',
  commands: [postCommand, updateCommand, rolesCommand],
  handleCommand: async (interaction) => {
    await COMMAND_HANDLERS[interaction.commandName]?.(interaction);
  },
  handleButton: async (interaction: ButtonInteraction) => {
    // Self-assign role buttons (`claim_role:<key>`) — open to any member.
    if (!interaction.customId.startsWith(`${ID.claimRole}:`)) return false;
    await handleRoleClaim(interaction);
    return true;
  },
  handleModal: async (interaction) => {
    const entry = MODAL_HANDLERS.find((m) => interaction.customId.startsWith(m.prefix));
    if (!entry) return false;
    await entry.handle(interaction);
    return true;
  },
};
