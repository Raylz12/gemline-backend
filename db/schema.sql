-- GEMLINE settlement schema (PostgreSQL 13+).
-- The backbone for moving assets and guaranteeing deals: escrow, orders,
-- trades, shipments, a vault, authentication, a credits ledger, and an
-- append-only audit log. Run: psql "$DATABASE_URL" -f db/schema.sql

-- gen_random_uuid() is in core on PG13+. Keep pgcrypto for older installs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────── enums (state vocab) ───────────────────────────
CREATE TYPE user_role          AS ENUM ('buyer','seller','admin','authenticator','member');
CREATE TYPE listing_kind       AS ENUM ('buy_now','auction');
CREATE TYPE listing_status     AS ENUM ('active','sold','cancelled');
CREATE TYPE fulfillment_method AS ENUM ('direct','authenticated','vault');
CREATE TYPE order_status       AS ENUM (
  'created','pending_payment','escrow_held','awaiting_shipment','at_auth_hub','authenticating',
  'auth_passed','auth_failed','shipped','delivered','inspection','settled',
  'disputed','refunded','cancelled');
CREATE TYPE escrow_status      AS ENUM ('held','released','refunded','partial','void');
CREATE TYPE shipment_direction AS ENUM ('seller_to_buyer','to_hub','hub_to_buyer','withdrawal');
CREATE TYPE shipment_status    AS ENUM ('label_created','in_transit','delivered','exception','returned');
CREATE TYPE trade_status       AS ENUM (
  'proposed','countered','accepted','settling','settled',
  'declined','cancelled','expired','disputed');
CREATE TYPE settlement_mode    AS ENUM ('vault_instant','escrow_ship');
CREATE TYPE trade_side         AS ENUM ('proposer','counterparty');
CREATE TYPE vault_status       AS ENUM (
  'intake_requested','inbound_shipped','received','authenticating',
  'vaulted','listed','rejected','withdrawal_requested','outbound_shipped','withdrawn');
CREATE TYPE auth_result        AS ENUM ('pending','passed','failed');
CREATE TYPE boost_tier         AS ENUM ('bump','spotlight','frontline');
CREATE TYPE boost_status       AS ENUM ('active','expired','cancelled');
CREATE TYPE dispute_status     AS ENUM ('open','evidence','resolved_refund','resolved_release','resolved_partial');

-- ─────────────────────────── core entities ───────────────────────────
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle            text UNIQUE NOT NULL,
  email             text UNIQUE NOT NULL,
  password_hash     text,
  role              user_role NOT NULL DEFAULT 'member',
  stripe_account_id text,                       -- Stripe Connect connected acct
  rating            numeric(3,2) DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Canonical card catalog. card_id is the spine everything else references.
CREATE TABLE cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player        text NOT NULL,
  year          text,
  card_set      text,
  variant       text,
  number        text,
  sport         text,
  grader        text,                           -- PSA / BGS / SGC / RAW
  grade         text,
  cert_number   text,                           -- grading certificate
  image_url     text,
  external_id   text,                           -- e.g. Card Hedge card_id
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cards_player ON cards (player);
CREATE INDEX idx_cards_cert   ON cards (cert_number);

CREATE TABLE listings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id       uuid NOT NULL REFERENCES cards(id),
  seller_id     uuid NOT NULL REFERENCES users(id),
  vault_item_id uuid,                           -- set if selling a vaulted slab
  kind          listing_kind NOT NULL DEFAULT 'buy_now',
  price         numeric(12,2) NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'USD',
  status        listing_status NOT NULL DEFAULT 'active',
  boost_rank    int NOT NULL DEFAULT 0,         -- /feed sorts by this desc
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_listings_status ON listings (status, boost_rank DESC);

CREATE TABLE bids (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES listings(id),
  bidder_id   uuid NOT NULL REFERENCES users(id),
  amount      numeric(12,2) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bids_listing ON bids (listing_id, amount DESC);

-- ─────────────────────────── escrow (the guarantee) ───────────────────────────
-- One hold per order or trade cash leg. Money lives here, not with the seller,
-- until the asset is confirmed. Maps to a Stripe PaymentIntent (manual capture).
CREATE TABLE escrow_holds (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 uuid,
  trade_id                 uuid,
  payer_id                 uuid NOT NULL REFERENCES users(id),
  payee_id                 uuid REFERENCES users(id),
  amount                   numeric(12,2) NOT NULL,
  platform_fee             numeric(12,2) NOT NULL DEFAULT 0,
  currency                 char(3) NOT NULL DEFAULT 'USD',
  status                   escrow_status NOT NULL DEFAULT 'held',
  stripe_payment_intent_id text,
  stripe_transfer_id       text,                -- transfer to seller on release
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (order_id IS NOT NULL OR trade_id IS NOT NULL)
);
CREATE INDEX idx_escrow_order ON escrow_holds (order_id);
CREATE INDEX idx_escrow_trade ON escrow_holds (trade_id);

-- ─────────────────────────── orders (single-item sale) ───────────────────────────
CREATE TABLE orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         uuid REFERENCES listings(id),
  card_id            uuid NOT NULL REFERENCES cards(id),
  buyer_id           uuid NOT NULL REFERENCES users(id),
  seller_id          uuid NOT NULL REFERENCES users(id),
  amount             numeric(12,2) NOT NULL,
  platform_fee       numeric(12,2) NOT NULL DEFAULT 0,
  currency           char(3) NOT NULL DEFAULT 'USD',
  fulfillment_method fulfillment_method NOT NULL,
  status             order_status NOT NULL DEFAULT 'created',
  escrow_id          uuid REFERENCES escrow_holds(id),
  inspection_ends_at timestamptz,               -- auto-settle deadline
  payment_due_at     timestamptz,               -- pending_payment expiry (buyer must confirm PI by then)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_buyer  ON orders (buyer_id);
CREATE INDEX idx_orders_seller ON orders (seller_id);
CREATE INDEX idx_orders_status ON orders (status);

-- ─────────────────────────── trades (peer to peer) ───────────────────────────
CREATE TABLE trades (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_id            uuid NOT NULL REFERENCES users(id),
  counterparty_id        uuid NOT NULL REFERENCES users(id),
  status                 trade_status NOT NULL DEFAULT 'proposed',
  settlement_mode        settlement_mode,       -- resolved on accept
  cash_from_proposer     numeric(12,2) NOT NULL DEFAULT 0,
  cash_from_counterparty numeric(12,2) NOT NULL DEFAULT 0,
  expires_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trade_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id      uuid NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  side          trade_side NOT NULL,
  card_id       uuid NOT NULL REFERENCES cards(id),
  vault_item_id uuid,                            -- null = must be shipped in
  listing_id    uuid,
  received      boolean NOT NULL DEFAULT false   -- escrow_ship: arrived at hub
);
CREATE INDEX idx_trade_items_trade ON trade_items (trade_id);

-- ─────────────────────────── vault ───────────────────────────
CREATE TABLE vault_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id            uuid NOT NULL REFERENCES cards(id),
  owner_id           uuid NOT NULL REFERENCES users(id),
  status             vault_status NOT NULL DEFAULT 'intake_requested',
  cert_verified      boolean NOT NULL DEFAULT false,
  authenticated_at   timestamptz,
  location           text,                        -- bin / vault location code
  intake_shipment_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vault_owner ON vault_items (owner_id, status);

-- ─────────────────────────── shipments ───────────────────────────
CREATE TABLE shipments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid REFERENCES orders(id),
  trade_id           uuid REFERENCES trades(id),
  vault_item_id      uuid REFERENCES vault_items(id),
  direction          shipment_direction NOT NULL,
  carrier            text,
  tracking_number    text,
  label_url          text,
  insured_value      numeric(12,2),
  signature_required boolean NOT NULL DEFAULT false,
  status             shipment_status NOT NULL DEFAULT 'label_created',
  shipped_at         timestamptz,
  delivered_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ship_tracking ON shipments (tracking_number);
CREATE INDEX idx_ship_order    ON shipments (order_id);
CREATE INDEX idx_ship_trade    ON shipments (trade_id);

-- ─────────────────────────── authentication ───────────────────────────
CREATE TABLE authentications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_item_id uuid REFERENCES vault_items(id),
  order_id      uuid REFERENCES orders(id),
  result        auth_result NOT NULL DEFAULT 'pending',
  cert_lookup   jsonb,                           -- PSA/BGS/SGC API response
  photos        jsonb,                           -- intake scan URLs
  notes         text,
  authenticator uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────── credits + boosts ───────────────────────────
-- Append-only ledger. Balance = sum(delta). Credits are promotional and
-- non-redeemable (boosts only) to stay clear of stored-value regulation.
CREATE TABLE credit_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  delta         int NOT NULL,                    -- +purchase / -spend
  balance_after int NOT NULL,
  reason        text NOT NULL,
  ref_type      text,                            -- 'purchase' | 'boost'
  ref_id        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_user ON credit_ledger (user_id, created_at DESC);

CREATE TABLE boosts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listings(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  tier          boost_tier NOT NULL,
  credits_spent int NOT NULL,
  rank          int NOT NULL,
  starts_at     timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz NOT NULL,
  status        boost_status NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_boosts_active ON boosts (status, ends_at);

-- ─────────────────────────── disputes ───────────────────────────
CREATE TABLE disputes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id),
  opener_id   uuid NOT NULL REFERENCES users(id),
  reason      text NOT NULL,
  status      dispute_status NOT NULL DEFAULT 'open',
  resolution  text,
  evidence    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- ─────────────────────────── audit log ───────────────────────────
-- Every state transition lands here. This is what makes the guarantee
-- defensible: a complete, ordered history of who moved what, when.
CREATE TABLE events (
  id          bigserial PRIMARY KEY,
  entity_type text NOT NULL,                     -- 'order' | 'trade' | 'vault' | ...
  entity_id   uuid NOT NULL,
  from_state  text,
  to_state    text NOT NULL,
  actor_id    uuid,
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_entity ON events (entity_type, entity_id, created_at);

-- FKs deferred above (declared as plain columns) to avoid creation-order cycles:
ALTER TABLE listings   ADD CONSTRAINT fk_listing_vault   FOREIGN KEY (vault_item_id) REFERENCES vault_items(id);
ALTER TABLE escrow_holds ADD CONSTRAINT fk_escrow_order  FOREIGN KEY (order_id) REFERENCES orders(id);
ALTER TABLE escrow_holds ADD CONSTRAINT fk_escrow_trade  FOREIGN KEY (trade_id) REFERENCES trades(id);
ALTER TABLE vault_items ADD CONSTRAINT fk_vault_shipment FOREIGN KEY (intake_shipment_id) REFERENCES shipments(id);

-- ─────────────────────────── portfolios ───────────────────────────
-- A user's personal card collection. Cards they physically own (or have
-- in transit). Each item can be listed on the marketplace or offered in trades.
CREATE TABLE IF NOT EXISTS portfolios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id        uuid NOT NULL REFERENCES cards(id),
  purchase_price numeric(12,2),
  cert_number    text,
  notes          text,
  is_listed      boolean NOT NULL DEFAULT false,
  listing_id     uuid,
  -- Verification (anti-scam): selling requires 'verified' (scan/cert/grandfathered)
  verification_status text NOT NULL DEFAULT 'unverified',  -- unverified | pending | verified
  verification_method text,                                -- scan | cert | grandfathered
  verified_at    timestamptz,
  acquired_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────── rate limits ───────────────────────
-- Cross-instance fixed-window counters (atomic upsert); see src/middleware/rateLimit.js
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       text NOT NULL,
  identifier   text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 1,
  last_hit     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, identifier, window_start)
);
CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolios (user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_card ON portfolios (card_id);

-- ─────────────────────── shipping addresses ───────────────────────
-- Saved buyer/seller addresses. Orders snapshot the chosen address into
-- orders.shipping_address (jsonb) at checkout so later edits never mutate
-- historical orders.
CREATE TABLE IF NOT EXISTS user_addresses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  street1    text NOT NULL,
  street2    text,
  city       text NOT NULL,
  state      text NOT NULL,
  zip        text NOT NULL,
  country    text NOT NULL DEFAULT 'US',
  phone      text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user ON user_addresses(user_id);
-- ALTER TABLE orders ADD COLUMN shipping_address jsonb;  (applied 2026-07-02)

-- ── Watchlist (added 2026-07-03) ─────────────────────────────────────────
-- Server-backed card watches. Alerts: new family listing (instant, in listing
-- POST) + price move ≥ alert_pct (daily sweep piggybacked on refresh-mv cron).
CREATE TABLE IF NOT EXISTS watchlist (
  id            BIGSERIAL PRIMARY KEY,
  user_id       uuid NOT NULL,
  card_id       uuid NOT NULL,
  ref_price     numeric,           -- price when the watch was set (Δ display)
  last_price    numeric,           -- baseline for the next price alert
  alert_pct     numeric NOT NULL DEFAULT 5,
  last_alert_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, card_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_card ON watchlist (card_id);

-- ── Order messages + counteroffers + cancel requests (added 2026-07-03) ────
CREATE TABLE IF NOT EXISTS order_messages (
  id         BIGSERIAL PRIMARY KEY,
  order_id   uuid NOT NULL,
  sender_id  uuid NOT NULL,
  body       text NOT NULL,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_omsg_order ON order_messages (order_id, created_at);
-- listing_offers gains: counter_amount NUMERIC, countered_at TIMESTAMPTZ (lazy ALTER)
-- orders gains: cancel_requested_by uuid, cancel_requested_at timestamptz, cancel_reason text (lazy ALTER)
