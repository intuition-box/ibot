/**
 * Editable content for the `/resources` command. Cubeo posts each section — an
 * optional banner image from data/images/banners/ followed by a text block into the
 * target channel.
 *
 * EDIT FREELY: change the `body` strings, reorder/add/remove sections, and drop a
 * matching `<banner>.png` into data/images/banners/ to give a section a header image
 * (a section whose banner file is absent simply posts text-only). Bodies use
 * Discord markdown; `>` renders a quoted block. Mentions never ping (the command
 * sends with mentions disabled), so listing people/roles is safe.
 */

export interface ResourceSection {
  /** Heading shown as bold text when the section has no banner image. */
  title: string;
  /** Banner filename under data/images/banners/. Skipped if the file doesn't exist. */
  banner?: string;
  /** Markdown body. Lines beginning with `>` render as a quoted block. */
  body: string;
  /** When true, the claimable-role buttons are posted right after this section. */
  claimButtons?: boolean;
}

/** Zero-width space — used for vertical spacing, as the legacy bot did. */
const SP = '​';

export const RESOURCE_SECTIONS: ResourceSection[] = [
  {
    title: '📇 Intuition Box',
    banner: 'ib.png',
    body: [
      SP,
      '> **Website**: https://intuition.box',
      '> **Github**: https://github.com/intuition-box',
      '> **X**: https://x.com/intuition_box',
      SP,
      '> Toogle to claim/remove a role with the buttons below.',
      '> **Builder** — you’re actively building on Intuition.',
      '> **Events** — get notified about community events, calls, and activities.',
    ].join('\n'),
    claimButtons: true,
  },
  {
    title: '👁️ Protocol',
    banner: 'protocol.png',
    body: [
      SP,
      '> **Website**: https://intuition.systems',
      '> **Docs**: https://docs.intuition.systems',
      '> **Whitepaper**: https://docs.intuition.systems/whitepapers',
      '> **GitHub**: https://github.com/0xIntuition',
      '> **X**: https://x.com/0xintuition',
      '> **Explorer**: https://explorer.intuition.systems',
      '> **Portal**: https://portal.intuition.systems',
      '> **System Status**: https://status.intuition.systems',
      SP,
    ].join('\n'),
  },
  {
    title: '🌐 Ecosystem',
    banner: 'ecosystem.png',
    body: [
      SP,
      '> **Atlas**: https://atlas.box',
      '> **Ontology**: https://ontology.intuition.box',
      '> **Intuition Fee Proxy**: https://proxy.intuition.box',
      '> **Ourglass**: https://ourglass.intuition.box/',
      SP,
    ].join('\n'),
  },
  {
    title: '💱 Exchanges',
    banner: 'exchanges.png',
    body: [
      SP,
      '> **CoinGecko**: https://www.coingecko.com/en/coins/intuition',
      '> **Coinbase**: https://www.coinbase.com/price/intuition',
      '> **Kraken**: https://www.kraken.com/prices/intuition',
      '> **Aerodrome**: https://aerodrome.finance/swap',
      SP,
    ].join('\n'),
  },
  {
    title: '📜 Tokens',
    banner: 'tokens.png',
    body: [
      SP,
      '> **Base Mainnet**',
      '> **Ticker**: `TRUST`',
      '> **Chain ID**: `8453`',
      '> **RPC**: `https://mainnet.base.org`',
      '> **Explorer**: https://basescan.org',
      '> **Contract**: `0x6cd905dF2Ed214b22e0d48FF17CD4200C1C6d8A3`',
      SP,
      '> **Intuition Mainnet**',
      '> **Ticker**: `TRUST`',
      '> **Chain ID**: `1155`',
      '> **RPC**: `https://rpc.intuition.systems`',
      '> **Explorer**: https://explorer.intuition.systems',
      '> **Contract**: `native token, has no contract`',
      SP,
      '> **Intuition Testnet**',
      '> **Ticker**: `tTRUST`',
      '> **Chain ID**: `13579`',
      '> **RPC**: `https://testnet.rpc.intuition.systems`',
      '> **Explorer**: https://testnet.explorer.intuition.systems',
      '> **Contract**: `native token, has no contract`',
    ].join('\n'),
  },
];

/**
 * Roles members can self-assign via the buttons in the Roles section. Resolved by
 * NAME at click time, so the role must exist with this exact name in the guild and
 * Cubeo's own role must sit ABOVE it with the Manage Roles permission.
 */
export const CLAIMABLE_ROLES = [
  { key: 'builder', label: 'Builder', roleName: 'Builder', emoji: '🛠️' },
  { key: 'events', label: 'Events', roleName: 'Events', emoji: '📅' },
] as const;
