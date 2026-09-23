# JUST TRIBES — full-stack Telegram mini app

A gamified Web3 community/airdrop mini app themed on the dawn of humanity.
Earn allocation through **loyalty and consistency**, not wealth or headcount.

- **Frontend:** static HTML + Tailwind (CDN) + one custom `styles.css` for the
  neo-brutalism glows, ember particles and animations. All illustrations
  (campfire, settlement stages, star field) are drawn in **code (SVG)** — no images.
- **Backend:** Node.js + Express REST API.
- **Database:** PostgreSQL (built for **Aiven PostgreSQL**; any Postgres works).
- **Auth:** Telegram Web App `initData` HMAC verification → JWT sessions.
  A dev-login fallback is enabled when no bot token is set.

```
just-tribes-fullstack/          # flat repo — deploy the whole thing as one Node app
  public/            # frontend (served by the API in production)
    index.html  styles.css  app.js
    admin/           # env-protected admin panel (index.html  app.js)
  src/
    index.js         # express app + static serving
    db.js            # pg pool (SSL for Aiven)
    auth.js          # telegram initData verify + JWT
    migrate.js       # apply schema.sql (+ --seed demo data)
    routes/          # auth, me, tribes, game, leaderboard
  schema.sql  .env.example  package.json  render.yaml
```

---

## 1. Run locally

```bash
# a) configure the server (use your own Postgres or Aiven)
cp .env.example .env
# edit .env:
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/justtribes
#   PGSSLMODE=disable
#   TELEGRAM_BOT_TOKEN=        # leave EMPTY for dev login

# b) install, migrate + seed demo data, run
npm install
npm run seed        # applies schema.sql and seeds demo tribes/users
npm start           # http://localhost:8080
```

Open http://localhost:8080 — the API also serves the frontend from `public/`.
With no `TELEGRAM_BOT_TOKEN`, the app auto-logs-in a dev user (Ben Daniel).

> There is **no demo mode**. Outside Telegram the app authenticates via the
> dev-login route (when no bot token is set). If the API is unreachable it
> shows a connection screen with a **Retry** button instead of fake data.

---

## 2. Connect Aiven PostgreSQL (production DB)

1. In the Aiven console create a **PostgreSQL** service.
2. Copy the **Service URI** from the service overview. It looks like:
   `postgres://avnadmin:PASSWORD@HOST.aivencloud.com:PORT/defaultdb?sslmode=require`
3. Put it in `.env` as `DATABASE_URL`, and set `PGSSLMODE=require`.
4. Run migrations against Aiven:
   ```bash
   npm run migrate      # add --seed for demo data
   ```

> Aiven only exposes managed **data services** (PostgreSQL, MySQL, Kafka, …).
> It does **not** host the web app itself — use it for the database, and host
> the Node server on a container/VM platform (below).

---

## 3. Deploy the server (which also serves the frontend)

Any Node host works — Render, Railway, Fly.io, a VM, or a container:

```bash
npm install --omit=dev && npm start
```

> **Render (recommended):** the repo is flat, so just zip the whole folder and
> upload it, or point Render at the repo. The included `render.yaml` sets
> `buildCommand: npm install` and `startCommand: node src/index.js` with
> `healthCheckPath: /api/health`. No Docker or `rootDir` needed.

Set these environment variables on the host:

| Var | Value |
|-----|-------|
| `DATABASE_URL` | your Aiven Service URI |
| `PGSSLMODE` | `require` |
| `JWT_SECRET` | a long random string |
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `CORS_ORIGIN` | your public URL (or `*`) |
| `PORT` | provided by the host |

The host must serve over **HTTPS** (required by Telegram).

> **Database auto-setup:** on startup the server automatically creates any
> missing tables and default config (safe/idempotent — it never deletes data),
> so a fresh deploy works with no shell access. Just set `DATABASE_URL` +
> `PGSSLMODE=require` and deploy. Set `MIGRATE_ON_BOOT=false` to turn this off.
> To also load demo data, run `npm run seed` once against a fresh DB.

### Split hosting (optional)
You can instead host `public/` on a static/edge host (Cloudflare Pages,
Netlify, Vercel) and run only the API on a Node host. Then set `CORS_ORIGIN`
to the static site's URL. The frontend calls the API on its own origin by
default — if you split them, change `const API = ...` at the top of
`public/app.js` to your API base URL.

---

## 4. Register the Telegram mini app

1. Talk to **@BotFather** → create a bot → copy the token into
   `TELEGRAM_BOT_TOKEN`.
2. `/newapp` (or Bot Settings → Menu Button / Web App) and set the URL to your
   deployed **HTTPS** link.
3. Open the bot in Telegram → the mini app loads and logs in via verified
   `initData`.

---

## 5. TON wallet + Telegram Stars payments

### TON Connect (real wallet, airdrop claim)
- The frontend uses **TON Connect UI** (loaded from CDN) with a manifest served
  dynamically at `GET /tonconnect-manifest.json` (its `url` matches your host;
  set `PUBLIC_URL` in prod so it's stable). The manifest icon is served at
  `/tonconnect-icon.png`.
- “Connect TON Wallet” opens the TON Connect modal (Tonkeeper, TON Space,
  MyTonWallet, Wallet-in-Telegram, …). On connect the address is saved via
  `POST /api/me/wallet`; `POST /api/me/wallet/disconnect` clears it.
- “Claim” calls `POST /api/me/claim`, which records `claimed_at` /
  `claimed_amount` (idempotent) and logs an `airdrop` ledger row. Actual
  on-chain token distribution is done off-app by your token/airdrop contract
  using the recorded `(wallet_address, claimed_amount)` pairs.
- **Production hardening:** verify the `ton_proof` from TON Connect against the
  official proof spec before trusting wallet ownership (the reference build
  stores the address but does not cryptographically verify the proof).

### Telegram Stars (buy in-app Star packs)
In-app **Stars** are bought with real **Telegram Stars** (currency `XTR`, no
provider token needed). Flow:
1. Frontend → `POST /api/payments/invoice { pack }` → server calls Bot API
   `createInvoiceLink` (XTR) and returns a `link`.
2. Frontend opens it with `Telegram.WebApp.openInvoice(link, cb)`.
3. Telegram → `pre_checkout_query` → `POST /api/telegram/webhook` answers
   `answerPreCheckoutQuery(ok=true)` within 10s.
4. On payment, Telegram → `successful_payment` → the webhook credits the pack
   (idempotent on `telegram_payment_charge_id`), logs a `stars` ledger row and a
   notification.

Setup:
```bash
# set TELEGRAM_BOT_TOKEN and a random TELEGRAM_WEBHOOK_SECRET in .env, then:
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url="$PUBLIC_URL/api/telegram/webhook" \
  -d secret_token="$TELEGRAM_WEBHOOK_SECRET" \
  -d 'allowed_updates=["message","pre_checkout_query"]'
```
With **no** bot token (local dev) the client falls back to
`POST /api/payments/dev-credit` which credits packs directly for testing
(also enable in prod with `ALLOW_DEV_PAYMENTS=1` if you must).

---

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/telegram` | login via verified Telegram `initData` |
| POST | `/api/auth/dev` | dev login (only when no bot token) |
| GET | `/api/me` | profile + currencies + inventory + tribe |
| GET/POST | `/api/me/notifications` | list / mark read |
| POST | `/api/me/wallet` · `/wallet/disconnect` | save / clear connected TON wallet |
| GET/POST | `/api/me/claim` | estimate / claim airdrop allocation to TON wallet |
| GET | `/api/payments/packs` | list Star packs + provider (telegram_stars/dev) |
| POST | `/api/payments/invoice` | create a Telegram Stars invoice link |
| POST | `/api/payments/dev-credit` | credit a Star pack directly (dev only) |
| POST | `/api/telegram/webhook` | Telegram Stars checkout (public, secret-token) |
| GET | `/tonconnect-manifest.json` | TON Connect manifest (dynamic host) |
| POST | `/api/game/checkin` | daily check-in (streak, Ember, Loyalty tithe) |
| GET/POST | `/api/game/quests[/:key]` | quests |
| POST | `/api/game/store/:key` | buy store item with Stars |
| POST | `/api/game/relics/:key` | buy relic with Stars |
| POST | `/api/game/upgrades/:key` | spend Loyalty/Stars |
| POST | `/api/game/settlement/upgrade` | grow the settlement (Hearth pool) |
| POST | `/api/game/land` | +5 member limit for 150 Stars |
| GET | `/api/tribes/:id` | tribe view (figures, contributors, roster) |
| POST | `/api/tribes` | found a new band |
| POST | `/api/tribes/:id/join` · `/leave` | membership |
| PUT | `/api/tribes/:id/cavewall` | edit slogan (Chief/Head) |
| POST | `/api/tribes/:id/warcry` | notify all members |
| GET | `/api/leaderboard/tribes` | world ranking by **avg loyalty/member** |
| GET | `/api/leaderboard/kin` | members by Ember |

All prices/rewards are **server-authoritative** and every currency change is
recorded in the `transactions` ledger for airdrop transparency.

## Economy
- **Ember** — personal, earned by your actions, never spent; drives your
  airdrop share.
- **Loyalty** — a tithe of your Ember flows into the tribal **Hearth**; tribes
  rank by **average loyalty per member**, so ghosts drag the average down.
- **Stars** — hard currency for the Store, relics and Land expansion. Bought
  with **real Telegram Stars** (`XTR`) via `createInvoiceLink` +
  `WebApp.openInvoice`, credited by the bot webhook on `successful_payment`.

## Security notes
- Telegram `initData` is verified with HMAC-SHA256 per the official spec.
- All game/tribe/leaderboard routes require a valid JWT (`Authorization: Bearer`).
- Purchases validate balances and ownership inside DB transactions with
  `SELECT ... FOR UPDATE` to avoid double-spend races.
- Set a strong `JWT_SECRET` and never commit `.env`.
- The Telegram webhook is public but gated by `TELEGRAM_WEBHOOK_SECRET` (checked
  against the `X-Telegram-Bot-Api-Secret-Token` header); Star credits are
  idempotent on `telegram_payment_charge_id` so retries never double-credit.
