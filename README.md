# ibot

The **Intuition** community's utility bot — deterministic, hardcoded helpers.

## What it does

- **Support tickets** — `/support` posts the ticket panel; members open category
  tickets (Missions / Grants / Partnership / General), moderators close / reopen /
  delete. Transcripts are stored in `support.db` (DB-only, no Discord archive), with
  free deterministic tagging on close.
- **Resources panel** — `/resources` posts the community resource sections (banners +
  links) and self-assign Builder / Events role buttons.

## Run

1. `npm install`
2. Copy `.env.example` → `.env` and fill in:
   - `DISCORD_TOKEN` — ibot's **own** Discord application (separate bot from Cubeo)
   - `GUILD_ID`, `OWNER_IDS`, `OPEN_TICKETS_CATEGORY_ID`
3. `npm run build && npm start` (or `npm run dev`).

On the server it runs as its own pm2 process. The bot needs
**ManageChannels** (ticket channels), **ManageRoles** (role buttons), and a role
positioned above the roles it assigns.

## Stack

TypeScript (strict, ESM) · discord.js v14 · better-sqlite3 + Drizzle · Biome.
