-- Fournisseurs de paiement Campay et Monetbil : chaque transaction garde le fournisseur qui l'a traitée.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_provider_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_provider_check CHECK (provider IN ('mock', 'notchpay', 'campay', 'monetbil'));

-- Encaissements / versements encore en attente chez un fournisseur réel (relance de vérification de statut).
CREATE INDEX IF NOT EXISTS transactions_pending_provider_idx ON transactions (provider, created_at) WHERE status = 'pending';
