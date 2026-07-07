/**
 * Free, deterministic ticket tagging — no AI, no cost. A tag is the form
 * category plus any topical tags whose trigger words appear in the transcript.
 * Curate TAG_RULES freely; a trigger matches at the START of a word.
 */
const TAG_RULES: Record<string, string[]> = {
  transaction: ['tx', 'transaction', 'bridge', 'wallet', 'hash', 'gas', 'swap', 'transfer'],
  funding: ['grant', 'funding', 'budget', 'allocation', 'payment', 'fund', 'tokens'],
  bug: ['bug', 'error', 'broken', 'fail', 'crash', 'stuck', "doesn't work", 'not working'],
  access: ['login', 'access', 'role', 'verify', 'permission', 'banned', 'kyc'],
  partnership: ['partner', 'collab', 'integration', 'listing', 'amba'],
  docs: ['docs', 'documentation', 'guide', 'tutorial', 'how to', 'whitepaper'],
  staking: ['stake', 'staking', 'validator', 'delegate', 'bonding'],
  governance: ['vote', 'governance', 'proposal', 'dao'],
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Each trigger is anchored to a word-boundary START, so short stems still catch
 * their inflections ("stake" → "staking", "amba" → "ambassador") but no longer
 * fire inside unrelated words ("stake" in "mistake", "bug" in "debugging").
 * Compiled once at load rather than per close.
 */
const COMPILED_RULES: ReadonlyArray<{ tag: string; patterns: RegExp[] }> = Object.entries(
  TAG_RULES,
).map(([tag, triggers]) => ({
  tag,
  patterns: triggers.map((t) => new RegExp(`\\b${escapeRegExp(t)}`, 'i')),
}));

/** Slugifies a form category into a tag (e.g. "General Help" → "general-help"). */
function categoryTag(formType: string | null | undefined): string | null {
  if (!formType) return null;
  return formType.toLowerCase().trim().replace(/\s+/g, '-');
}

/** Returns a deduped tag list for a closed ticket. */
export function generateTags(formType: string | null | undefined, transcript: string): string[] {
  const tags = new Set<string>();

  const category = categoryTag(formType);
  if (category) tags.add(category);

  for (const { tag, patterns } of COMPILED_RULES) {
    if (patterns.some((re) => re.test(transcript))) tags.add(tag);
  }

  return [...tags];
}
