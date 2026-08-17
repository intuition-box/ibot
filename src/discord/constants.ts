import path from 'node:path';

/** Roles (by name) treated as moderators for ticket actions. */
export const MODERATOR_ROLES = ['Admin', 'Moderator'] as const;

/** Brand accent used across ticket embeds. */
export const EMBED_COLOR = 0x5865f2;

/** Discord embed field `value` hard limit. Long inputs are truncated to this. */
export const EMBED_FIELD_LIMIT = 1024;

/** Banner posted by /support — a static asset under data/images/. */
export const SUPPORT_BANNER_PATH = path.join('data', 'images', 'banners', 'support.png');

/**
 * Info message posted after a form is confirmed, unlocking the ticket for its
 * author. Kept as a shared constant so the transcript builder can filter it out
 * by content even after a restart — it carries no components, so the generic
 * bot-UI filter can't catch it, and its message id lives only in memory.
 */
export const UNLOCK_MESSAGE =
  'This support ticket is now unlocked, and you may leave comments. Please wait for a moderator — they will review your details and help you as soon as possible.';

/** Stable component/modal identifiers, centralized to avoid stringly-typed drift. */
export const ID = {
  createTicket: 'support_create_ticket',
  deleteTicket: 'support_delete_ticket',
  reopenTicket: 'support_reopen_ticket',
  formMissions: 'form_missions',
  formGrants: 'form_grants',
  formPartnership: 'form_partnership',
  formGeneral: 'form_general',
  formClose: 'form_close',
  confirmCloseYes: 'confirm_close_yes',
  confirmCloseNo: 'confirm_close_no',
  confirmReopenYes: 'confirm_reopen_yes',
  confirmReopenNo: 'confirm_reopen_no',
  confirmDeleteYes: 'confirm_delete_yes',
  confirmDeleteNo: 'confirm_delete_no',
  confirmFormYes: 'confirm_yes',
  confirmFormNo: 'confirm_no',
  modalMissions: 'modal_missions',
  modalGrants: 'modal_grants',
  modalPartnership: 'modal_partnership',
  modalGeneral: 'modal_general',
  /** Prefix for self-assign role buttons; full id is `claim_role:<key>`. */
  claimRole: 'claim_role',
  /** Prefix for the /update edit modal; full id is `update_modal:<channelId>:<messageId>`. */
  updateModal: 'update_modal',
  /** Prefix for the /post compose modal; full id is `post_modal:<channelId>`. */
  postModal: 'post_modal',
  /** Prefix for the /roles compose modal; full id is `roles_modal:<channelId>`. */
  rolesModal: 'roles_modal',
} as const;
