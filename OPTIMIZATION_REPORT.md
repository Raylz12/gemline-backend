# Gemline Optimization Report

**Deployed:** gemlinecards.com  
**Commit:** feat: community posts, card trading flow, ticker fix, UI polish

---

## 1. Community Page — Real Data Feed ✅

### DB Migration
- Created `posts` table: `id SERIAL PK, user_id UUID→users, type TEXT, body TEXT, card_id UUID→cards, likes INTEGER, created_at TIMESTAMPTZ`
- Created `post_likes` table: `(user_id, post_id)` composite PK for toggle tracking
- Indexes on `posts.user_id` and `posts.created_at DESC`
- Migration script: `scripts/migrate-posts.js`

### API Endpoints (api/index.js)
- `GET /api/posts/feed?page=N` — paginated (20/page), JOINs users + cards, includes `userLiked` boolean per authenticated user
- `POST /api/posts` — create post (auth required), types: general/pull/trade/sale, max 500 chars
- `POST /api/posts/:id/like` — toggle like (auth required), returns `{ liked, likes }`

### Auto-Generated Posts
- **Pack pulls ≥ $50**: Auto-posts `"Just ripped a pack and pulled [player] ([grader grade]) worth $X! 🎉"` as type `pull`
- **Trade accepted**: Auto-posts `"Trade completed between @user1 and @user2! 🤝"` as type `trade`

### Community Page UI (app/community/page.js)
- Replaced ALL `DEMO_POSTS` with real API data
- Composer wired to `POST /api/posts` with type selector (General/Pull/Trade/Sale)
- Feed fetched from `GET /api/posts/feed` with pagination ("Load more posts" button)
- Skeleton loading (3 placeholder cards)
- Proper empty state with icon and contextual message
- Like toggle calls API, shows auth hint if not logged in
- Time-ago formatting (`2m ago`, `3h ago`, `2d ago`)
- Card attachments show thumbnail, player, grader, grade, value
- User avatar links to `/profile/[handle]`
- Mobile: `.community-layout` collapses to 1 column at ≤768px

---

## 2. Card Adding + Trading — Full End-to-End Flow ✅

### Add to Portfolio
- Already existed in `CardDetail.js` with `POST /api/portfolio/add`
- Confirmed working via `src/routes/app.js` route

### List for Sale (NEW — app/portfolio/page.js)
- Added `listingItem` + `listingPrice` state
- "Sell" button appears on each unlisted portfolio item
- Modal with price input (pre-filled with market value), validation
- Calls `POST /api/portfolio/list` with `{ portfolioItemId, price (cents) }`
- Listed items show "LISTED" badge instead of Sell button

### Propose a Trade
- `TradeProposal` component fully functional (`app/components/TradeProposal.js`)
- Used on `/user/[handle]` page with target user's cards
- Calls `POST /api/trades/propose` with offered/requested card IDs, cash offer, message

### Accept/Decline Trades
- Both `app/trades/page.js` and `app/components/TradesContent.js` have Accept/Decline/Cancel buttons
- Call `PUT /api/trades/proposals/:id` with status: accepted/declined/cancelled
- Auto-post created on acceptance
- Proper authorization checks (only recipient can accept/decline, only sender can cancel)

### Trade Lifecycle
- Full state machine: pending → accepted/declined/cancelled
- Settlement via `src/routes/settlement.js` and `src/domain/escrow.js`

---

## 3. Ticker Fix ✅ (app/components/Ticker.js + app/globals.css)

**Before:** 11.5px font, 34px height, hard to read  
**After:**
- Font size: **13px** (up from 11.5px)
- Height: **38px** (up from 34px)
- Text color: `#f0f0f0` for player names, `#e0e0e0` for price (strong contrast)
- Grader/grade labels: `rgba(255,255,255,0.45)` — visible but secondary
- Gap between items: 9px (up from 7px)
- Padding per item: 18px (up from 16px)
- Added `·` separator after each item
- Mobile: 12px minimum font at ≤480px

---

## 4. UI Polish ✅

### Button Hover/Active States
- `.btn-primary:hover` — brightness 1.12 + `translateY(-1px)` lift
- `.btn-primary:active` — brightness 0.95 + `translateY(0)` press
- `.btn-ghost:hover` — border color + subtle background
- `.btn-ghost:active` — slightly brighter background
- `.trade-cta .accept:hover` — brightness + lift
- `.trade-cta .decline:hover` — red border/text
- `.trade-cta .cancel:hover` — red background

### Skeleton Loading
- Trades page: `SkeletonList` during load (was plain text spinner)
- TradesContent: `SkeletonList` during load
- Community feed: 3 skeleton cards during initial load

### Empty States
- Community feed: icon + contextual message ("Be the first to share!")
- Trades incoming: 📬 icon + "Offers people send you will appear here..."
- Trades outgoing: 📤 icon + link to community to find traders

### Store Optimizations (src/store/pg.js)
- Connection pool: `max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000`
- SQL injection whitelist for dynamic column names
- Consistent error handling

---

## Deployment

- **Git commit:** `8a4e1e3`
- **Vercel:** ✅ Deployed to https://gemlinecards.com (production)
- **DB migration:** ✅ `posts` and `post_likes` tables created on Neon Postgres
