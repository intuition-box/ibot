import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Message,
  ModalSubmitInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';

/**
 * A self-contained Discord capability (tickets, resources, wallet, AI…).
 *
 * Features are wired purely through {@link ./registry.ts}'s `FEATURES` array, so
 * adding or removing one is a single line there plus its own folder — no edits to
 * `index.ts`, `commands.ts`, or any sibling feature. The router fans interactions
 * and messages out to whichever feature claims them.
 */
export interface Feature {
  /** Stable identifier, used only for logging. */
  readonly name: string;

  /** Slash-command JSON bodies this feature registers with Discord. */
  readonly commands?: readonly RESTPostAPIApplicationCommandsJSONBody[];

  /** Handles one of this feature's slash commands. Routed by command name. */
  handleCommand?(interaction: ChatInputCommandInteraction): Promise<void>;

  /** Handles a button. Return `true` if this feature owns it (stops routing). */
  handleButton?(interaction: ButtonInteraction): Promise<boolean>;

  /** Handles a modal submit. Return `true` if this feature owns it (stops routing). */
  handleModal?(interaction: ModalSubmitInteraction): Promise<boolean>;

  /**
   * Inspects a message. Return `true` to "take over" it and stop the pipeline
   * (e.g. the wallet intercept); return `false` to let later features also see it
   * (e.g. a passive counter). Features run in `FEATURES` order.
   */
  handleMessage?(message: Message): Promise<boolean> | boolean;

  /** One-time setup once the client is ready (e.g. log startup stats). */
  onReady?(): void | Promise<void>;

  /** Cleanup on shutdown (e.g. close this feature's own database). */
  onShutdown?(): void | Promise<void>;

  /**
   * A channel was deleted (ticket channel or otherwise). Lets a feature free any
   * per-channel state it holds — the durable, correct moment to reclaim it.
   */
  onChannelDelete?(channelId: string): void | Promise<void>;
}
