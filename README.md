# GEMLINE Arbitrage Backend

Turns the GEMLINE demo into a real arbitrage terminal. It merges three data
sources into one cross-platform spread feed and serves it to the GEMLINE
frontend as clean JSON.

```
                 ┌─────────────────────────────────────────┐
   Card Hedge ──▶│  /v1/agent/cards/*  (spine: cards, FMV,  │
   (the spine)   │   multi-marketplace prices, comps)       │
                 └──────────────┬──────────────────────────┘
                                │  enrich top N cards
   eBay Browse ─────────────────┤  with live asks
   (active asks)                │
                                │
   Apify / Whatnot ─────────────┤
   (scraped asks)               │
                                ▼
                        spread engine  ──▶  GET /feed  ──▶  GEMLINE frontend
                     (lo / hi / edge %)                     (live Arbitrage Engine)
```

Card Hedge is the spine because it already aggregates canonical card identity,
fair-market value, and prices across marketplaces. eBay and Whatnot layer on
*live asks* so the spread reflects what you can actually buy at right now.

## Run it

```bash
cd gemline-backend
cp .env.example .env        # fill in whatever keys you have
npm install
npm start                   # → http://localhost:8787
```

With no keys it boots in **demo mode** (`/feed` returns an empty live set and
GEMLINE keeps its built-in sample data). Add keys to light up live data.

Check what's wired: `curl http://localhost:8787/health`

## Getting each source

**Card Hedge** (api.cardhedger.com) — the one to start with.
- Keyed tier: get an API key at ai.cardhedger.com/api-services, set
  `CARDHEDGE_AUTH=apikey` and `CARDHEDGE_API_KEY=...`
- Pay-per-call: set `CARDHEDGE_AUTH=x402` (no key, but you must wire a Base/USDC
  signer in `payChallenge()` inside `src/adapters/cardhedge.js`). Endpoints run
  ~$0.01–0.02 each; the manifest is public at `/v1/agent/pricing`.
- The free `set-search` endpoint works with `CARDHEDGE_AUTH=free` for testing.

**eBay Browse API** — active listings (current asks), fully supported.
- Register an app at developer.ebay.com, grab Client ID + Secret.
- Set `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`. The adapter handles OAuth.
- Note: this gives current asks, **not** sold comps. eBay's sold-comp API
  (Marketplace Insights) is gated to approved partners and is not generally
  available to independent developers right now — so sold history comes from
  Card Hedge's comps instead.

**Apify / Whatnot** — scraped public listings.
- Token from console.apify.com → Integrations. Set `APIFY_TOKEN`.
- Default actor is a public Whatnot scraper; change `APIFY_WHATNOT_ACTOR` to
  whichever actor you prefer (input keys may differ — see the adapter).

## Connect GEMLINE to it

Open `gemline.html`. By default it calls `http://localhost:8787`. To point at a
deployed backend, load it with a query param:

```
gemline.html?api=https://your-backend.example.com
```

When the backend returns live data the **DEMO DATA** pill in the header flips to
**LIVE DATA** and the whole Arbitrage Engine, grid, and ticker repopulate with
real spreads. Click the pill any time to retry the connection. If the backend
is down, GEMLINE silently keeps its demo data — nothing breaks.

## A note on the scraping side

The eBay Browse path and the Card Hedge path are clean, supported APIs. The
Apify/Whatnot path scrapes publicly visible listings for market research, which
sits in Whatnot's Terms-of-Service gray area: there is no public Whatnot sales
API, so scraping is the only route, but the data shape can change without
warning and aggressive polling can get you blocked. The backend caches the
whole feed (default 5 min) and only enriches the top N cards to keep request
volume low. Use it for analysis, cache hard, and don't redistribute the raw
scraped data. If you want fully compliant sold-comp coverage at scale, the
real answer is a licensed data vendor or eBay partner access.

## Settlement engine (orders, trades, escrow, vault)

This is the backbone that moves assets and guarantees deals. Money is held in
escrow and never exposed to the seller until the asset is confirmed; high-value
items route through authentication; vaulted items settle as an ownership record
change with no shipping at all.

It runs **in-memory by default** (no database needed) and is fully tested:

```bash
npm test        # runs test/lifecycle.test.js — 30 assertions across every path
npm start       # mounts the engine at /api/* alongside /feed
```

To persist with Postgres, set `DATABASE_URL` and migrate:

```bash
npm run migrate # psql "$DATABASE_URL" -f db/schema.sql
```

**How it's structured**
- `db/schema.sql` — the full Postgres schema (enums, tables, indexes, audit log).
- `src/domain/states.js` — every state and the legal transitions between them.
- `src/domain/machine.js` — the only thing that changes a status; rejects illegal
  moves and writes an audit event for every accepted one.
- `src/domain/{orders,trades,vault,escrow,ledger}.js` — the lifecycle services.
- `src/store/{memory,pg}.js` + `repo.js` — swappable storage; Stripe stub lives here.
- `src/routes/settlement.js` — the HTTP surface (below).

**Order lifecycle** — `created → escrow_held →` then by fulfillment method:
- `direct`: seller ships straight to buyer → `delivered → inspection → settled`
- `authenticated`: seller ships `to hub → authenticating →` pass forwards to buyer,
  fail refunds the buyer (counterfeit/altered caught before it ever reaches them)
- `vault`: ownership transfers and it `settled`s instantly, no shipping
A dispute during inspection routes to refund or release.

**Trade settlement** — on accept, the engine picks the mode automatically:
- `vault_instant`: every item is vaulted → atomic ownership swap, settles instantly
- `escrow_ship`: something must be mailed → both parties ship to the hub and
  nothing releases until **both** sides arrive and clear. Cash boot is escrowed.

**Escrow ↔ Stripe Connect** — `hold` = PaymentIntent (manual capture);
`release` = capture + Transfer to the seller's connected account (minus platform
fee); `refund` = cancel/refund. The included stub simulates these so the engine
runs without keys; drop in the real `stripe` SDK in `src/store/repo.js`.

**API** (all under `/api`): `POST /orders`, `/orders/:id/ship`,
`/orders/:id/authenticate`, `/orders/:id/delivered`, `/orders/:id/settle`,
`/orders/:id/dispute`, `/orders/:id/resolve`; `POST /trades`, `/trades/:id/accept`,
`/trades/:id/received`; `POST /vault/intake`, `/vault/:id/authenticate`,
`/vault/:id/withdraw`; `POST /credits/purchase`, `/boosts`,
`GET /credits/:userId/balance`; and `GET /events/:type/:id` for the full audit trail.

## Where to extend

- `src/adapters/` — add a source by exporting a function that returns
  `{ source, price, url, kind }` offers; the spread engine does the rest.
- `src/engine/spread.js` — the edge math and the GEMLINE card shape live here.
- `ENRICH_LIMIT` / `CACHE_TTL` in `.env` — trade freshness against cost.
- Next obvious build: grading-arbitrage (raw → graded EV) using Card Hedge
  `prices-by-card` across grades, and a WebSocket push so the ticker moves on
  real updates instead of a poll.
