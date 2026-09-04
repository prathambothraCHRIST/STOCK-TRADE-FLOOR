# STOCKEX Trading Floor

A live multiplayer stock-market simulation built with React, Vite, Supabase and Vercel.

## Game rules preserved

This version keeps the market rules from the supplied STOCKEX game:

- ₹1,00,000 virtual starting cash per participant.
- 12 companies across Insurance, Banking and Consulting.
- Market ticks every 3 seconds at normal speed.
- Normal price movement uses each company's volatility, bias and recovery profile.
- Ordinary movement is capped per tick and prices stay inside the original ±15% market band (with the same small slack used by the game).
- Blue-chip and high-risk profiles retain their different drift/recovery behavior.
- Optional wild swings can create 5–25% jolts while respecting the same price band.
- Headmaster events can target the whole market, a sector or one company.
- Positive events spike first and then decay sharply over five ticks; negative events remain down and recover slowly.
- Headmaster can pause/resume the market, reset it, change tick speed and broadcast headlines.
- Participants can buy/sell virtual shares, track average cost, holdings, P&L and trade history.
- Everyone sees the same live market state and leaderboard through Supabase.

The work in this update is primarily presentation, usability and hosting: a more polished trading-terminal UI, company search/directory, sector pulse cards, responsive layout and clearer portfolio/leaderboard views. **The simulation rules above were not changed.**

## Stack

- React + Vite
- Recharts for live company graphs
- Lucide React icons
- Supabase Postgres via `storage_kv`
- Vercel for hosting

## Supabase setup

1. Create/open your Supabase project.
2. Run `supabase_setup.sql` in the SQL Editor if `storage_kv` has not already been created.
3. Copy `.env.example` to `.env` locally.
4. Set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

The browser uses the public Supabase anon key. The supplied SQL intentionally allows shared reads/writes so an educational event can run without participant accounts. For a high-stakes or long-lived deployment, replace these public policies with authenticated/RLS rules.

## Local run

```bash
npm install
npm run dev
```

## Vercel deployment

Import this GitHub repository into Vercel and add the same two environment variables under the project environment settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Vercel will use the included `vercel.json` and build with `npm run build`.

## How the event works

1. Open the live site.
2. The organiser chooses **Headmaster** and creates the control-room passcode the first time.
3. The Headmaster opens the control room and shares the generated invite link/QR code.
4. Participants join with their name and receive ₹1,00,000 virtual cash.
5. The Headmaster controls the live market while all participants trade against the same prices.
6. The leaderboard updates from each participant's published portfolio snapshot.

## Important

This is an educational simulation using virtual money. It is not a real brokerage, exchange or investment product.
