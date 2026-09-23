-- ============================================================
--  JUST TRIBES — PostgreSQL schema (Aiven compatible)
-- ============================================================

CREATE TABLE IF NOT EXISTS tribes (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  cave_wall      TEXT NOT NULL DEFAULT 'Hunt as one. Feast as one. Rise as one.',
  level          INT  NOT NULL DEFAULT 1,
  hearth_pool    BIGINT NOT NULL DEFAULT 0,        -- total Loyalty in the Hearth
  member_limit   INT  NOT NULL DEFAULT 25,
  settlement     INT  NOT NULL DEFAULT 0,          -- 0..4 = Village..Kingdom
  created_by     BIGINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  telegram_id    BIGINT UNIQUE,                    -- null for dev users
  username       TEXT,
  name           TEXT NOT NULL,
  photo_url      TEXT,
  role           TEXT NOT NULL DEFAULT 'Toddler',  -- Toddler|Kin|Hunter|Elder|Head|Chief
  ember          BIGINT NOT NULL DEFAULT 0,        -- personal currency (never spent)
  loyalty        BIGINT NOT NULL DEFAULT 0,        -- personal loyalty earned (feeds hearth avg)
  stars          BIGINT NOT NULL DEFAULT 0,        -- hard currency
  streak         INT NOT NULL DEFAULT 0,
  last_checkin   DATE,
  tribe_id       BIGINT REFERENCES tribes(id) ON DELETE SET NULL,
  wallet_address TEXT,
  ref_code       TEXT UNIQUE,
  referred_by    BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- airdrop claim timestamp (set once the user claims to their TON wallet)
ALTER TABLE users ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS claimed_amount BIGINT;

-- Telegram Stars purchases of in-app Star packs (idempotent audit trail)
CREATE TABLE IF NOT EXISTS payments (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack               TEXT NOT NULL,
  stars_paid         INT  NOT NULL,                  -- Telegram Stars (XTR) paid
  stars_credited     INT  NOT NULL,                  -- in-app Stars granted
  telegram_charge_id TEXT UNIQUE,                     -- idempotency key
  provider_charge_id TEXT,
  status             TEXT NOT NULL DEFAULT 'pending', -- pending|paid|refunded
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

-- ledger of every currency change (audit / airdrop transparency)
CREATE TABLE IF NOT EXISTS transactions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency   TEXT NOT NULL,                        -- ember|loyalty|stars
  amount     BIGINT NOT NULL,                      -- +/-
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- owned relics / store items / applied upgrades
CREATE TABLE IF NOT EXISTS inventory (
  id        BIGSERIAL PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key  TEXT NOT NULL,
  item_type TEXT NOT NULL,                          -- relic|store|upgrade
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_key)
);

CREATE TABLE IF NOT EXISTS quests_done (
  id        BIGSERIAL PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_key TEXT NOT NULL,
  day       DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (user_id, quest_key, day)
);

CREATE TABLE IF NOT EXISTS notifications (
  id        BIGSERIAL PRIMARY KEY,
  user_id   BIGINT REFERENCES users(id) ON DELETE CASCADE,  -- null = tribe/global
  tribe_id  BIGINT REFERENCES tribes(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  body      TEXT NOT NULL DEFAULT '',
  read      BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- editable game configuration (admin-controlled): branding, rules,
-- store, relics, upgrades, quests, star packs, economy tuning
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- record of Telegram Stars purchases (in-app Stars top-ups)
CREATE TABLE IF NOT EXISTS payments (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack               TEXT NOT NULL,
  stars_paid         BIGINT NOT NULL,          -- Telegram Stars (XTR) charged
  stars_credited     BIGINT NOT NULL,          -- in-app Stars granted
  telegram_charge_id TEXT UNIQUE,              -- idempotency key for webhook retries
  provider_charge_id TEXT,
  status             TEXT NOT NULL DEFAULT 'paid',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- admin action audit log
CREATE TABLE IF NOT EXISTS admin_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_tribe   ON users(tribe_id);
CREATE INDEX IF NOT EXISTS idx_tx_user       ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user    ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_pay_user      ON payments(user_id);

-- View: tribe standings by AVERAGE loyalty per member (the core ranking rule)
CREATE OR REPLACE VIEW tribe_standings AS
SELECT t.id, t.name, t.level, t.settlement, t.cave_wall, t.member_limit,
       COUNT(u.id)                                        AS members,
       COALESCE(ROUND(AVG(u.loyalty))::BIGINT, 0)         AS avg_loyalty,
       COALESCE(SUM(u.loyalty), 0)                        AS total_loyalty
FROM tribes t
LEFT JOIN users u ON u.tribe_id = t.id
GROUP BY t.id;
