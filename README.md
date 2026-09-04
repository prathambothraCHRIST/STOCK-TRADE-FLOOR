# STOCK-TRADE-FLOOR

A multiplayer trading-floor simulation built with React + Vite + Supabase.

## Included
- Headmaster/master controls
- Shared live market prices for every player
- Slower 3-second market ticks with speed controls
- Company-by-company live graphs
- Company directory with sectors, risk profile and base prices
- Buy/sell order ticket and private browser portfolio
- Holdings count and position values for every company
- Market news and headmaster random events
- Market, sector and company event targeting
- Pause/resume and market reset controls

## Run locally
1. Create a Supabase project.
2. Run `supabase_setup.sql` in the Supabase SQL Editor.
3. Create `.env` from `.env.example` and add your Supabase URL + anon key.
4. Run `npm install`.
5. Run `npm run dev`.

## Deploy
This repo can be connected to Vercel or Netlify. Add the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables in the hosting dashboard.

### Headmaster
The demo master key in the UI is `MASTER`. Change this before using the game publicly; the current setup is intentionally a simple educational simulation and does not provide secure authentication.

## Database security
The included SQL uses public RLS policies so players can share a game without accounts. For a real production event, add authenticated users and restrict writes to the master/controller and each player's private portfolio.
