import type { EmbedBuilder } from 'discord.js';

/**
 * Per-channel ephemeral UI state. In-memory by design: these track transient
 * message IDs for button management and are safe to lose on restart (handlers
 * degrade gracefully when a lookup misses). Durable state lives in SQLite.
 */
export const formSummaryMap = new Map<string, { type: string; embed: EmbedBuilder }>();
export const initialButtonMessageMap = new Map<string, string>();
export const unlockMessageMap = new Map<string, string>();

/** Drops all in-memory state for a channel. Call when the channel is deleted
 * (see the support feature's onChannelDelete) — NOT on mere close, since a
 * closed ticket can still be reopened and needs its button/unlock message ids. */
export function clearChannelState(channelId: string): void {
  formSummaryMap.delete(channelId);
  initialButtonMessageMap.delete(channelId);
  unlockMessageMap.delete(channelId);
}
