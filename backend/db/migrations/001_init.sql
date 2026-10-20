-- Tasko — schéma initial
-- Pas de PostGIS : distances calculées par la fonction haversine_km.

CREATE OR REPLACE FUNCTION haversine_km(lat1 double precision, lng1 double precision,
                                        lat2 double precision, lng2 double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$$;

-- ---------------------------------------------------------------- utilisateurs
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name          text NOT NULL,
  phone              text NOT NULL UNIQUE,
  email              text,
  password_hash      text NOT NULL,
  avatar_url         text,
  city               text,
  is_provider        boolean NOT NULL DEFAULT false,
  is_admin           boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  verification_level smallint NOT NULL DEFAULT 1 CHECK (verification_level BETWEEN 1 AND 5),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_created_at_idx ON users (created_at);

CREATE TABLE provider_profiles (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline            text,
  bio                 text,
  provider_type       text NOT NULL DEFAULT 'freelancer'
                      CHECK (provider_type IN ('artisan', 'student', 'professional', 'freelancer', 'company')),
  years_experience    integer NOT NULL DEFAULT 0 CHECK (years_experience >= 0),
  is_online           boolean NOT NULL DEFAULT false,
  lat                 double precision,
  lng                 double precision,
  location_updated_at timestamptz,
  rating_avg          numeric(3, 2) NOT NULL DEFAULT 0,
  rating_count        integer NOT NULL DEFAULT 0,
  missions_completed  integer NOT NULL DEFAULT 0,
  completion_rate     integer NOT NULL DEFAULT 100 CHECK (completion_rate BETWEEN 0 AND 100),
  momo_number         text,
  momo_operator       text CHECK (momo_operator IN ('mtn', 'orange')),
  plan                text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  pro_until           timestamptz,
  featured_until      timestamptz,
  available_days      smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_profiles_latlng_idx ON provider_profiles (lat, lng);
CREATE INDEX provider_profiles_online_idx ON provider_profiles (is_online);
CREATE INDEX provider_profiles_created_at_idx ON provider_profiles (created_at);

-- ---------------------------------------------------------------- catalogue
CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   uuid REFERENCES categories(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  description text,
  icon        text NOT NULL DEFAULT 'more_horiz',
  color       text NOT NULL DEFAULT '#607D8B' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  position    integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX categories_parent_idx ON categories (parent_id, position);

CREATE TABLE provider_skills (
  provider_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  base_price  integer NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, category_id)
);
CREATE INDEX provider_skills_category_idx ON provider_skills (category_id);

CREATE TABLE portfolio_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text,
  image_url   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portfolio_items_provider_idx ON portfolio_items (provider_id);

CREATE TABLE cities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- missions
CREATE TABLE jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES users(id),
  provider_id         uuid REFERENCES users(id),
  category_id         uuid NOT NULL REFERENCES categories(id),
  title               text NOT NULL,
  description         text,
  photo_url           text,
  address             text,
  city                text,
  lat                 double precision NOT NULL,
  lng                 double precision NOT NULL,
  urgency             text NOT NULL DEFAULT 'now' CHECK (urgency IN ('now', 'today', 'scheduled')),
  scheduled_at        timestamptz,
  budget              integer NOT NULL CHECK (budget >= 0),
  price               integer NOT NULL CHECK (price >= 0),
  service_fee         integer NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
  total               integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  provider_commission integer NOT NULL DEFAULT 0 CHECK (provider_commission >= 0),
  provider_payout     integer NOT NULL DEFAULT 0 CHECK (provider_payout >= 0),
  status              text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'accepted', 'funded', 'en_route', 'arrived',
                                        'in_progress', 'done', 'completed', 'cancelled', 'disputed')),
  payment_status      text NOT NULL DEFAULT 'unpaid'
                      CHECK (payment_status IN ('unpaid', 'pending', 'held', 'released', 'refunded')),
  cancel_reason       text,
  cancelled_by        uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  accepted_at         timestamptz,
  funded_at           timestamptz,
  started_at          timestamptz,
  done_at             timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_status_idx ON jobs (status);
CREATE INDEX jobs_created_at_idx ON jobs (created_at);
CREATE INDEX jobs_completed_at_idx ON jobs (completed_at);
CREATE INDEX jobs_client_idx ON jobs (client_id, created_at DESC);
CREATE INDEX jobs_provider_idx ON jobs (provider_id, created_at DESC);
CREATE INDEX jobs_category_idx ON jobs (category_id);

CREATE TABLE job_declines (
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, provider_id)
);

CREATE TABLE transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid REFERENCES jobs(id) ON DELETE SET NULL,
  user_id      uuid NOT NULL REFERENCES users(id),
  type         text NOT NULL CHECK (type IN ('escrow_in', 'payout', 'commission', 'refund', 'subscription', 'boost')),
  amount       integer NOT NULL CHECK (amount >= 0),
  method       text CHECK (method IN ('mtn_momo', 'orange_money', 'card')),
  phone        text,
  provider     text NOT NULL DEFAULT 'mock' CHECK (provider IN ('mock', 'notchpay')),
  external_ref text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transactions_job_idx ON transactions (job_id);
CREATE INDEX transactions_user_idx ON transactions (user_id, created_at DESC);
CREATE INDEX transactions_created_at_idx ON transactions (created_at);
CREATE INDEX transactions_type_status_idx ON transactions (type, status);
CREATE UNIQUE INDEX transactions_external_ref_uq ON transactions (provider, external_ref) WHERE external_ref IS NOT NULL;
-- Idempotence : un seul payout / commission / remboursement non échoué par mission
CREATE UNIQUE INDEX transactions_job_settlement_uq ON transactions (job_id, type)
  WHERE type IN ('payout', 'commission', 'refund') AND status <> 'failed' AND job_id IS NOT NULL;

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  punctuality smallint CHECK (punctuality BETWEEN 1 AND 5),
  quality     smallint CHECK (quality BETWEEN 1 AND 5),
  behavior    smallint CHECK (behavior BETWEEN 1 AND 5),
  value       smallint CHECK (value BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, author_id)
);
CREATE INDEX reviews_target_idx ON reviews (target_id, created_at DESC);

CREATE TABLE disputes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  opened_by   uuid NOT NULL REFERENCES users(id),
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution  text CHECK (resolution IN ('release', 'refund')),
  note        text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX disputes_status_idx ON disputes (status, created_at DESC);
CREATE UNIQUE INDEX disputes_one_open_per_job ON disputes (job_id) WHERE status = 'open';

-- ---------------------------------------------------------------- messagerie
CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id     uuid REFERENCES jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b)
);
CREATE INDEX conversations_user_b_idx ON conversations (user_b);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            text NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'location', 'image')),
  body            text,
  lat             double precision,
  lng             double precision,
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC);

-- ---------------------------------------------------------------- divers
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('job', 'payment', 'message', 'system')),
  title      text NOT NULL,
  body       text,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE favorites (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider_id)
);

CREATE TABLE promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  description      text,
  discount_percent integer NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  max_uses         integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count       integer NOT NULL DEFAULT 0,
  expires_at       timestamptz,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  platform   text NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC);

CREATE TABLE category_suggestions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  job_id     uuid REFERENCES jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX category_suggestions_label_idx ON category_suggestions (lower(label));
