-- Tasko V2 — garantie de paiement, gré à gré, appels d'offres, jalons, immobilier, trésorerie.
-- Ne modifie pas 001 : uniquement des ALTER / CREATE additionnels.

-- ---------------------------------------------------------------- utilisateurs / comptes entreprise
ALTER TABLE users
  ADD COLUMN account_type text NOT NULL DEFAULT 'individual' CHECK (account_type IN ('individual', 'business')),
  ADD COLUMN business     jsonb;

-- ---------------------------------------------------------------- prestataires : code public, annulations
ALTER TABLE provider_profiles
  ADD COLUMN public_code   text,
  ADD COLUMN cancellations integer NOT NULL DEFAULT 0 CHECK (cancellations >= 0);

-- Code Tasko : TSK- + 5 caractères sans ambiguïté (pas de 0/O/1/I)
CREATE OR REPLACE FUNCTION tasko_public_code() RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  s text := 'TSK-';
BEGIN
  FOR i IN 1..5 LOOP
    s := s || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION provider_profiles_set_public_code() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  IF NEW.public_code IS NULL THEN
    LOOP
      c := tasko_public_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM provider_profiles WHERE public_code = c);
    END LOOP;
    NEW.public_code := c;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE r record; c text;
BEGIN
  FOR r IN SELECT user_id FROM provider_profiles WHERE public_code IS NULL LOOP
    LOOP
      c := tasko_public_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM provider_profiles WHERE public_code = c);
    END LOOP;
    UPDATE provider_profiles SET public_code = c WHERE user_id = r.user_id;
  END LOOP;
END $$;

CREATE TRIGGER provider_profiles_public_code_trg BEFORE INSERT ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION provider_profiles_set_public_code();
CREATE UNIQUE INDEX provider_profiles_public_code_uq ON provider_profiles (public_code);

-- ---------------------------------------------------------------- biens immobiliers & missions récurrentes
CREATE TABLE properties (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('apartment', 'house', 'building', 'land', 'commercial', 'other')),
  address     text,
  lat         double precision,
  lng         double precision,
  units_count integer CHECK (units_count IS NULL OR units_count >= 0),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX properties_owner_idx ON properties (owner_id, created_at DESC);

CREATE TABLE recurring_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  category_id uuid NOT NULL REFERENCES categories(id),
  provider_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  price       integer NOT NULL CHECK (price >= 100),
  address     text,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  frequency   text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (provider_id <> client_id)
);
CREATE INDEX recurring_jobs_due_idx ON recurring_jobs (next_run_at) WHERE is_active;
CREATE INDEX recurring_jobs_client_idx ON recurring_jobs (client_id);
CREATE INDEX recurring_jobs_property_idx ON recurring_jobs (property_id) WHERE property_id IS NOT NULL;

-- ---------------------------------------------------------------- missions : modes, garantie de paiement
ALTER TABLE jobs
  ADD COLUMN mode                 text NOT NULL DEFAULT 'instant' CHECK (mode IN ('instant', 'direct', 'tender')),
  ADD COLUMN origin               text NOT NULL DEFAULT 'client' CHECK (origin IN ('client', 'provider_offer', 'recurring')),
  ADD COLUMN visibility           text CHECK (visibility IN ('public', 'invited')),
  ADD COLUMN invited_provider_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN bid_deadline         timestamptz,
  ADD COLUMN budget_min           integer CHECK (budget_min IS NULL OR budget_min >= 0),
  ADD COLUMN budget_max           integer CHECK (budget_max IS NULL OR budget_max >= 0),
  ADD COLUMN tender_closed_at     timestamptz,
  ADD COLUMN start_code           text CHECK (start_code IS NULL OR start_code ~ '^[0-9]{4}$'),
  ADD COLUMN start_code_attempts  integer NOT NULL DEFAULT 0,
  ADD COLUMN start_code_failures  integer NOT NULL DEFAULT 0,
  ADD COLUMN auto_release_at      timestamptz,
  ADD COLUMN completed_by         text CHECK (completed_by IN ('client', 'auto', 'admin')),
  ADD COLUMN proof_photos         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN completion_note      text,
  ADD COLUMN cancellation_fee     integer NOT NULL DEFAULT 0 CHECK (cancellation_fee >= 0),
  ADD COLUMN cancelled_role       text CHECK (cancelled_role IN ('client', 'provider', 'admin', 'system')),
  ADD COLUMN property_id          uuid REFERENCES properties(id) ON DELETE SET NULL,
  ADD COLUMN recurring_job_id     uuid REFERENCES recurring_jobs(id) ON DELETE SET NULL,
  ADD COLUMN reminder_mid_at      timestamptz,
  ADD COLUMN reminder_final_at    timestamptz,
  ADD COLUMN receipt_no           bigint UNIQUE,
  ADD CONSTRAINT jobs_budget_range_chk CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max),
  ADD CONSTRAINT jobs_tender_chk CHECK (mode <> 'tender' OR bid_deadline IS NOT NULL);

-- Reprise des données V1
UPDATE jobs SET mode = 'direct' WHERE status = 'requested' AND provider_id IS NOT NULL;
UPDATE jobs SET cancelled_role = CASE WHEN cancelled_by = client_id THEN 'client'
                                      WHEN cancelled_by = provider_id THEN 'provider'
                                      WHEN cancelled_by IS NOT NULL THEN 'admin' ELSE 'system' END
 WHERE status = 'cancelled';
UPDATE jobs SET completed_by = 'client' WHERE status = 'completed';
UPDATE jobs SET auto_release_at = done_at + interval '48 hours' WHERE status = 'done' AND done_at IS NOT NULL;

CREATE SEQUENCE receipt_seq;

CREATE INDEX jobs_auto_release_idx ON jobs (auto_release_at) WHERE status = 'done';
CREATE INDEX jobs_tender_open_idx ON jobs (bid_deadline) WHERE mode = 'tender' AND status = 'requested';
CREATE INDEX jobs_open_requests_idx ON jobs (category_id, created_at DESC) WHERE status = 'requested' AND provider_id IS NULL;
CREATE INDEX jobs_property_idx ON jobs (property_id) WHERE property_id IS NOT NULL;
CREATE INDEX jobs_client_payment_idx ON jobs (client_id, payment_status);
CREATE INDEX jobs_provider_payment_idx ON jobs (provider_id, payment_status) WHERE provider_id IS NOT NULL;

-- Prestataires ayant reçu `job:new` (destinataires de `job:closed`)
CREATE TABLE job_broadcasts (
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, provider_id)
);

-- ---------------------------------------------------------------- jalons
CREATE TABLE job_milestones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position            integer NOT NULL CHECK (position >= 1),
  title               text NOT NULL,
  amount              integer NOT NULL CHECK (amount > 0),
  service_fee         integer NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
  provider_commission integer NOT NULL DEFAULT 0 CHECK (provider_commission >= 0),
  provider_payout     integer NOT NULL DEFAULT 0 CHECK (provider_payout >= 0),
  total               integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'funded', 'submitted', 'released', 'refunded', 'disputed')),
  funded_at           timestamptz,
  submitted_at        timestamptz,
  auto_release_at     timestamptz,
  released_at         timestamptz,
  refunded_at         timestamptz,
  reminder_mid_at     timestamptz,
  reminder_final_at   timestamptz,
  proof_photos        text[] NOT NULL DEFAULT '{}',
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, position)
);
CREATE INDEX job_milestones_release_idx ON job_milestones (auto_release_at) WHERE status = 'submitted';
CREATE INDEX job_milestones_held_idx ON job_milestones (job_id) WHERE status IN ('funded', 'submitted', 'disputed');

-- ---------------------------------------------------------------- appels d'offres : offres (bids)
CREATE TABLE bids (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  provider_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        integer NOT NULL CHECK (amount >= 100),
  duration_days integer CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 3650),
  message       text,
  attachments   text[] NOT NULL DEFAULT '{}',
  milestones    jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, provider_id)
);
CREATE INDEX bids_provider_idx ON bids (provider_id, created_at DESC);
-- Une seule offre acceptée par appel d'offres
CREATE UNIQUE INDEX bids_one_accepted_uq ON bids (job_id) WHERE status = 'accepted';

-- ---------------------------------------------------------------- litiges : split, preuves, jalons
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_resolution_check;
ALTER TABLE disputes ADD CONSTRAINT disputes_resolution_check CHECK (resolution IN ('release', 'refund', 'split'));
ALTER TABLE disputes
  ADD COLUMN milestone_id    uuid REFERENCES job_milestones(id) ON DELETE SET NULL,
  ADD COLUMN provider_amount integer CHECK (provider_amount IS NULL OR provider_amount >= 0),
  ADD COLUMN respond_before  timestamptz,
  ADD COLUMN photos          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN prev_job_status text;
UPDATE disputes SET respond_before = created_at + interval '48 hours' WHERE respond_before IS NULL;
CREATE INDEX disputes_job_idx ON disputes (job_id);

CREATE TABLE dispute_evidence (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message    text NOT NULL,
  photos     text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispute_evidence_dispute_idx ON dispute_evidence (dispute_id, created_at);

-- ---------------------------------------------------------------- avis : distinguer note prestataire / note client
ALTER TABLE reviews ADD COLUMN target_role text NOT NULL DEFAULT 'provider' CHECK (target_role IN ('provider', 'client'));
UPDATE reviews r SET target_role = 'client' FROM jobs j WHERE j.id = r.job_id AND r.target_id = j.client_id;
DROP INDEX IF EXISTS reviews_target_idx;
CREATE INDEX reviews_target_idx ON reviews (target_id, target_role, created_at DESC);

-- ---------------------------------------------------------------- transactions : nouveaux types, jalons, idempotence
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check CHECK (type IN (
  'escrow_in', 'payout', 'commission', 'refund', 'subscription', 'boost',
  'cancellation_fee', 'partial_refund', 'withdrawal', 'revenue_withdrawal'));
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_method_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_method_check CHECK (method IN ('mtn_momo', 'orange_money', 'card', 'bank'));
ALTER TABLE transactions ALTER COLUMN user_id DROP NOT NULL; -- retraits automatiques admin (système)
ALTER TABLE transactions ADD COLUMN milestone_id uuid REFERENCES job_milestones(id) ON DELETE SET NULL;

-- RG-G9 : un seul payout / commission / remboursement / frais d'annulation par cible (mission ou jalon), quel que soit le statut.
-- Les relances modifient la ligne existante (remboursements) ou passent par une transaction `withdrawal` (prestataires).
DROP INDEX IF EXISTS transactions_job_settlement_uq;
CREATE UNIQUE INDEX transactions_settlement_uq
  ON transactions (job_id, coalesce(milestone_id, '00000000-0000-0000-0000-000000000000'::uuid), type)
  WHERE job_id IS NOT NULL AND type IN ('payout', 'commission', 'refund', 'partial_refund', 'cancellation_fee');
CREATE INDEX transactions_user_type_idx ON transactions (user_id, type, status);
CREATE INDEX transactions_job_type_idx ON transactions (job_id, type);
CREATE INDEX transactions_milestone_idx ON transactions (milestone_id) WHERE milestone_id IS NOT NULL;

-- ---------------------------------------------------------------- trésorerie admin
CREATE TABLE payout_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  text NOT NULL CHECK (type IN ('bank', 'mtn_momo', 'orange_money')),
  label                 text NOT NULL,
  bank_name             text,
  account_holder        text,
  account_number_enc    text,   -- AES-256-GCM (DATA_ENCRYPTION_KEY)
  account_number_last4  text,
  phone_enc             text,   -- AES-256-GCM
  phone_last4           text,
  is_default            boolean NOT NULL DEFAULT false,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'bank' AND account_number_enc IS NOT NULL) OR (type <> 'bank' AND phone_enc IS NOT NULL))
);
CREATE UNIQUE INDEX payout_accounts_one_default_uq ON payout_accounts ((true)) WHERE is_default AND deleted_at IS NULL;

CREATE TABLE admin_withdrawals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount            integer NOT NULL CHECK (amount > 0),
  fee               integer NOT NULL DEFAULT 0 CHECK (fee >= 0),
  payout_account_id uuid NOT NULL REFERENCES payout_accounts(id),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  external_ref      text,
  requested_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  is_auto           boolean NOT NULL DEFAULT false,
  transaction_id    uuid UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,
  failure_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);
CREATE INDEX admin_withdrawals_created_idx ON admin_withdrawals (created_at DESC);
CREATE INDEX admin_withdrawals_status_idx ON admin_withdrawals (status);

CREATE TABLE audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);

-- ---------------------------------------------------------------- anti brute-force (connexion)
CREATE TABLE login_attempts (
  phone        text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- index manquants (revue)
CREATE INDEX messages_unread_idx ON messages (conversation_id, sender_id) WHERE read_at IS NULL;
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX conversations_job_idx ON conversations (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX favorites_provider_idx ON favorites (provider_id);
CREATE INDEX job_declines_provider_idx ON job_declines (provider_id);
CREATE INDEX otp_codes_created_idx ON otp_codes (created_at);

-- ---------------------------------------------------------------- §5.9 Médiation à trois, prestataire absent (RG-G10..G15)
ALTER TABLE provider_profiles
  ADD COLUMN no_shows      integer NOT NULL DEFAULT 0 CHECK (no_shows >= 0),
  ADD COLUMN disputes_lost integer NOT NULL DEFAULT 0 CHECK (disputes_lost >= 0);

ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_status_check;
ALTER TABLE disputes ADD CONSTRAINT disputes_status_check CHECK (status IN ('open', 'pending_confirmation', 'resolved'));
ALTER TABLE disputes
  ADD COLUMN kind                     text NOT NULL DEFAULT 'quality' CHECK (kind IN ('quality', 'no_show', 'not_validated', 'other')),
  ADD COLUMN opened_role              text CHECK (opened_role IN ('client', 'provider', 'admin')),
  ADD COLUMN decision_due_at          timestamptz,
  ADD COLUMN decision_alert_at        timestamptz,
  ADD COLUMN resolved_via             text CHECK (resolved_via IN ('admin', 'agreement', 'system')),
  ADD COLUMN decided_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN decided_at               timestamptz,
  ADD COLUMN confirmed_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN pending_resolution       text CHECK (pending_resolution IN ('release', 'refund', 'split')),
  ADD COLUMN pending_provider_amount  integer CHECK (pending_provider_amount IS NULL OR pending_provider_amount >= 0),
  ADD COLUMN pending_note             text;
UPDATE disputes SET decision_due_at = created_at + interval '72 hours' WHERE decision_due_at IS NULL;
UPDATE disputes SET resolved_via = 'admin', decided_by = resolved_by WHERE status = 'resolved';
UPDATE disputes d SET opened_role = CASE WHEN d.opened_by = j.client_id THEN 'client' WHEN d.opened_by = j.provider_id THEN 'provider' ELSE 'admin' END
  FROM jobs j WHERE j.id = d.job_id;
DROP INDEX IF EXISTS disputes_one_open_per_job;
CREATE UNIQUE INDEX disputes_one_active_per_job ON disputes (job_id) WHERE status <> 'resolved';
CREATE INDEX disputes_due_idx ON disputes (decision_due_at) WHERE status <> 'resolved';

CREATE TABLE dispute_proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id        uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role       text NOT NULL CHECK (author_role IN ('client', 'provider', 'admin')),
  provider_amount   integer NOT NULL CHECK (provider_amount >= 0),
  client_refund     integer NOT NULL CHECK (client_refund >= 0),
  message           text,
  client_accepted   boolean,
  provider_accepted boolean,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispute_proposals_dispute_idx ON dispute_proposals (dispute_id, created_at DESC);
CREATE UNIQUE INDEX dispute_proposals_one_pending_uq ON dispute_proposals (dispute_id) WHERE status = 'pending';

-- Conversations : salon de médiation lié au litige (en plus des conversations directes 1-1)
ALTER TABLE conversations
  ADD COLUMN kind       text NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'mediation')),
  ADD COLUMN dispute_id uuid UNIQUE REFERENCES disputes(id) ON DELETE CASCADE;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_user_a_user_b_key;
CREATE UNIQUE INDEX conversations_direct_pair_uq ON conversations (user_a, user_b) WHERE kind = 'direct';
ALTER TABLE disputes ADD COLUMN conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;

-- Messages : signés par rôle, messages système et propositions ; jamais modifiables ni supprimables
ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('text', 'location', 'image', 'system', 'proposal'));
ALTER TABLE messages ADD COLUMN sender_role text CHECK (sender_role IN ('client', 'provider', 'admin', 'system'));

CREATE OR REPLACE FUNCTION mediation_messages_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM conversations c WHERE c.id = OLD.conversation_id AND c.kind = 'mediation') THEN
    IF TG_OP = 'DELETE' THEN
      -- seule la suppression en cascade de la conversation (purge) est tolérée
      IF EXISTS (SELECT 1 FROM conversations c WHERE c.id = OLD.conversation_id) THEN
        RAISE EXCEPTION 'Les messages de médiation ne peuvent pas être supprimés';
      END IF;
      RETURN OLD;
    END IF;
    IF NEW.body IS DISTINCT FROM OLD.body OR NEW.type IS DISTINCT FROM OLD.type OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Les messages de médiation ne peuvent pas être modifiés';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER messages_mediation_immutable BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION mediation_messages_immutable();
