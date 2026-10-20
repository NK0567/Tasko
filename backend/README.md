# Tasko — Backend (API + temps réel) — V2

API REST + Socket.IO de **Tasko**, marketplace camerounaise de petits jobs du quotidien (géolocalisation, suivi temps réel, paiement Mobile Money en séquestre).
Contrat d'API de référence : [`../docs/05-contrat-api.md`](../docs/05-contrat-api.md) — la **section 5 (V2)** est implémentée : garantie de paiement (RG-G1 à RG-G9), médiation à trois et prestataire absent (§5.9, RG-G10 à RG-G15), modes `instant` / `direct` / `tender`, offres prestataire, jalons, comptes entreprise, biens immobiliers, missions récurrentes, reçus, portefeuille prestataire, trésorerie admin, journal d'audit.

- Node.js ≥ 20 (testé avec Node 24), JavaScript ESM, Express 5
- PostgreSQL (SQL brut via `pg`, sans ORM, sans PostGIS : distance par `haversine_km`)
- zod (validation, messages en français), JWT (30 j), bcryptjs, Socket.IO, multer, helmet, cors, express-rate-limit

## Démarrage rapide

```bash
cd backend
npm install
cp .env.example .env            # déjà fait si .env existe

# Base de données — au choix :
docker compose up -d postgres   # (depuis la racine du projet) PostgreSQL 16 sur localhost:5433
npm run db:embedded             # OU, sans Docker : PostgreSQL embarqué sur 5433 (laisser tourner)

npm run migrate                 # applique db/migrations/*.sql (001_init, 002_v2)
npm run seed                    # purge + données de démo V1 + V2 (comptes : seeds/README.md)
npm run dev                     # API sur http://localhost:4300/api/v1 (rechargement auto) + planificateur
npm test                        # tests d'intégration (base tasko_test)
```

- API : `http://localhost:4300/api/v1` — émulateur Android : `http://10.0.2.2:4300/api/v1`
- Socket.IO : `http://localhost:4300` — fichiers : `http://localhost:4300/uploads/...`
- Santé : `GET /health`
- Le serveur écoute sur `0.0.0.0`. CORS ouvert en dev (`CORS_ORIGINS=*`).

> Port : **4300** (4000, 4100 et 5173 sont occupés par d'autres applications sur la machine de dev). Modifiable via `PORT`.

### Scripts

| Script | Rôle |
|---|---|
| `npm run dev` | serveur avec `node --watch` (planificateur actif) |
| `npm start` | serveur (production) |
| `npm run migrate` | migrations versionnées (table `schema_migrations`) |
| `npm run seed` | **idempotent** : purge toutes les tables puis recrée la démo (~790 missions sur 60 jours + scénarios V2) ; mots de passe stables (relus depuis `seeds/README.md`) |
| `npm run db:embedded` | PostgreSQL embarqué sur 5433, données dans `.pgdata/` |
| `npm test` | `node:test` + `supertest` + `socket.io-client` contre `tasko_test` (créée/migrée/purgée automatiquement) — 59 tests (dont 6 Campay/Monetbil avec `fetch` intercepté, aucun appel réseau) |

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `PORT` / `HOST` | `4300` / `0.0.0.0` | écoute HTTP |
| `PUBLIC_URL` | `http://localhost:4300` | URL publique (callback de paiement Notch Pay) |
| `CORS_ORIGINS` | `*` | origines autorisées, séparées par des virgules |
| `DATABASE_URL` | `postgres://tasko:tasko_dev_password@localhost:5433/tasko` | base principale |
| `TEST_DATABASE_URL` | `…/tasko_test` | base des tests (doit contenir « test » — garde-fou) |
| `JWT_SECRET` | valeur de dev | **obligatoire en production** (refus de démarrer sinon) |
| `DATA_ENCRYPTION_KEY` | vide (clé de dev dérivée) | **V2, obligatoire en production** : clé AES-256-GCM (64 hex conseillé, `openssl rand -hex 32`) qui chiffre les numéros de compte bancaire / Mobile Money de la trésorerie. Changer la clé rend illisibles les comptes déjà enregistrés (les recréer, ou relancer le seed en dev). |
| `SCHEDULER_ENABLED` | `true` (hors tests) | planificateur interne |
| `SCHEDULER_INTERVAL_MS` | `60000` | période du planificateur |
| `PAYMENT_PROVIDER` | vide | `mock` \| `notchpay` \| `campay` \| `monetbil` ; prioritaire sur le paramètre `payment_provider` en base |
| `PAYOUT_PROVIDER` | vide | idem + `same` ; prioritaire sur le paramètre `payout_provider` |
| `MOCK_PAYMENT_DELAY_MS` | `3000` | délai avant succès d'un encaissement simulé |
| `MOCK_PAYOUT_DELAY_MS` | = `MOCK_PAYMENT_DELAY_MS` | délai avant succès d'un versement simulé (payout, remboursement, retrait) |
| `NOTCHPAY_BASE_URL` / `NOTCHPAY_PUBLIC_KEY` / `NOTCHPAY_PRIVATE_KEY` / `NOTCHPAY_HASH_KEY` | | Notch Pay (configuré = les trois clés) |
| `CAMPAY_BASE_URL` | `https://demo.campay.net/api` | prod : `https://www.campay.net/api` |
| `CAMPAY_USERNAME` / `CAMPAY_PASSWORD` ou `CAMPAY_TOKEN` | | identifiants de l'application Campay (jeton 1 h, renouvelé) ou jeton permanent |
| `CAMPAY_WEBHOOK_KEY` | | « webhook key » de l'application (signature JWT des callbacks) — **requise** pour que Campay soit « configuré » |
| `CAMPAY_COLLECT_FEE_RATE` / `CAMPAY_PAYOUT_FEE_RATE` / `CAMPAY_BANK_TRANSFER_FEE` | `0.02` / `0.01` / `5000` | frais publiés (frais estimés affichés, frais des retraits admin) |
| `MONETBIL_SERVICE_KEY` / `MONETBIL_SERVICE_SECRET` | | clés du service Monetbil (configuré = les deux) |
| `MONETBIL_API_URL` / `MONETBIL_WIDGET_URL` | `https://api.monetbil.com/payment/v1` / `https://api.monetbil.com/widget/v2.1` | |
| `MONETBIL_PAYOUT_ENABLED` / `MONETBIL_PAYOUT_URL` | `false` / `https://api.monetbil.com/v1/payouts/withdrawal` | versements Monetbil (désactivés : API partiellement documentée) |
| `MONETBIL_ALLOW_TESTMODE` | `false` | accepter les paiements « mode test » (statut 7) — jamais en production |
| `MONETBIL_COLLECT_FEE_RATE` / `MONETBIL_PAYOUT_FEE_RATE` | vide | tarifs non publiés : ceux de votre contrat |

## Architecture

```
backend/
├─ db/migrations/001_init.sql, 002_v2.sql      schéma (CHECK, index, triggers : code Tasko, messages de médiation immuables)
├─ seeds/seed.js (V1), seeds/v2.js (scénarios V2), seeds/data.js, seeds/README.md (comptes de démo)
├─ src/
│  ├─ server.js, app.js, config.js, db.js
│  ├─ scheduler/       planificateur (setInterval 60 s, pg_try_advisory_lock, horloge injectable)
│  ├─ middleware/      auth (JWT), error (format du contrat, aucune fuite), upload (images + PDF, signature vérifiée)
│  ├─ modules/
│  │  ├─ auth/         OTP (3 / 10 min / numéro), register, login (verrouillage 15 min après 5 échecs)
│  │  ├─ users/        /me, mode prestataire, compte entreprise, portefeuille (/me/wallet), Pro, boost
│  │  ├─ providers/    recherche + score, fiche, avis (prestataire uniquement), lookup par code / téléphone
│  │  ├─ jobs/         service (modes, garantie, annulation, jalons), tenders (offres, attribution), receipt, repo (vue par utilisateur)
│  │  ├─ disputes/     médiation à trois, preuves, propositions amiables, décision + double validation, no-show
│  │  ├─ payments/     séquestre, libérations, remboursements, frais d'annulation, split, versements, webhook
│  │  ├─ wallet/       portefeuille prestataire, retraits, relance des versements échoués
│  │  ├─ treasury/     grand livre, comptes de versement chiffrés, retraits admin sous verrou, reversement auto
│  │  ├─ properties/   biens immobiliers + missions récurrentes
│  │  ├─ marketplace/  /tenders, /invitations
│  │  ├─ messaging/    conversations directes + salons de médiation, masquage des numéros
│  │  ├─ audit/        journal d'audit
│  │  └─ admin/, categories/, settings/, notifications/
│  ├─ payments/        fournisseurs : mock.js, notchpay.js, campay.js, monetbil.js (initiate, verifyWebhook, checkStatus, payout, balance, transferFee, meta), index.js (sélection), events.js
│  ├─ realtime/        socket.js, hub.js (émission par destinataire), location.js
│  └─ utils/           erreurs, validation, crypto (AES-256-GCM), mask (numéros), téléphone, géo
└─ tests/              auth, admin, providers, jobs, realtime, guarantee, tenders, treasury, mediation
```

## V2 — règles implémentées

### Garantie de paiement
- **RG-G1** : `en_route`/`arrived`/`in_progress` impossibles tant que la mission n'est pas `funded` (409). Par jalon : un jalon `pending` ne peut pas être soumis.
- **RG-G2** : `start_code` (4 chiffres, `crypto.randomInt`) généré au passage `funded`, envoyé au client par notification et visible **uniquement** dans sa vue du Job (null pour le prestataire, les tiers, les admins et dans `job:updated` des autres sockets). Saisie obligatoire pour `in_progress` (`require_start_code`) ; comparaison en temps constant ; après 5 codes faux, un nouveau code est généré et renvoyé au client ; blocage au-delà de 20 échecs cumulés.
- **RG-G3/G4** : `done` accepte `{proof_photos, note}` (obligatoires si `require_completion_proof`) ; `auto_release_at = done_at + auto_release_hours`. Le planificateur envoie les rappels (mi-parcours, 2 h avant) et libère (`completed_by = "auto"`).
- **RG-G5** : annulation client gratuite (`requested`/`accepted`), remboursement intégral (`funded`), `cancellation_fee` + `partial_refund` (`en_route`), **interdite** ensuite ; annulation prestataire jusqu'à `in_progress` → remboursement intégral, compteur `cancellations`.
- **RG-G6/G12–G14** : voir Médiation ci-dessous. Le litige gèle la libération (statut `disputed`, jalon `disputed`).
- **RG-G7** : `client.trust = {rating_avg, rating_count, jobs_paid, disputes_lost}` sur chaque Job ; les avis portent `target_role` (`provider`/`client`) : la note reçue en tant que client n'affecte jamais la note prestataire (bug V1 corrigé).
- **RG-G8** : `client.phone`/`provider.phone` = null tant que `payment_status ∉ {held, released}` ; numéros camerounais masqués dans les messages (lecture, `message:new`, aperçu des notifications et de `last_message`) tant qu'aucune mission entre les deux interlocuteurs n'est sécurisée. Les admins voient tout. Paramètre `mask_contacts_until_funded`.
- **RG-G9** : toutes les opérations financières dans une transaction SQL avec `SELECT … FOR UPDATE` ; index unique `(job_id, milestone_id, type)` pour `payout`/`commission`/`refund`/`partial_refund`/`cancellation_fee` **quel que soit le statut** ; résultats de paiement / versement rejoués sans effet (seule une transaction `pending` change d'état) ; planificateur en `FOR UPDATE SKIP LOCKED` + verrou consultatif.

### Médiation à trois et prestataire absent (§5.9)
- Ouvrir un litige (`/jobs/:id/dispute`, `/jobs/:id/no-show`) crée un **salon** `conversation.kind = "mediation"` (client, prestataire, tous les admins), avec messages système, `decision_due_at` (+72 h) et `respond_before`.
- Messages du salon : `sender_role` (`client`/`provider`/`admin`/`system`), admins signés « Médiateur Tasko », **immuables** (trigger PostgreSQL : UPDATE du contenu et DELETE refusés). `/disputes/:id/messages` renvoie aussi le chat direct de la mission en lecture (`job_chat`).
- **RG-G10** : aucun chemin ne permet au client de récupérer seul des fonds hors RG-G5 (vérifié par test : annulation refusée pendant un litige).
- **RG-G11** : `arrival_deadline` / `can_report_no_show` sur le Job ; no-show sans message ni proposition du prestataire avant `respond_before` (+12 h) → remboursement automatique (`resolved_by = "system"`), `no_shows` +1.
- **RG-G13** : propositions `{provider_amount, message}` (admin ou partie ; l'auteur partie est réputé l'accepter) ; une nouvelle proposition remplace la précédente ; acceptée par les deux → exécution atomique (`resolved_by = "agreement"`).
- **RG-G14** : résolution admin avec motif obligatoire, publié dans le salon ; au-delà de `four_eyes_threshold` → `pending_confirmation`, confirmation par **un autre** admin (`/admin/disputes/:id/confirm`). Alerte admin 12 h avant l'échéance.
- **RG-G15** : `disputes_lost` (client, calculé) / `disputes_lost` et `no_shows` (prestataire, compteurs) ; alerte de suspension au seuil `suspension_threshold`.

### Modes de mission
- **instant** : diffusion aux prestataires en ligne (destinataires mémorisés dans `job_broadcasts`) ; acceptation atomique (verrou + `UPDATE … WHERE status='requested' AND provider_id IS NULL`), perdants → `409 CONFLICT` « Cette mission a déjà été attribuée » et `job:closed {reason:"assigned"}`.
- **direct** : `provider_id` obligatoire, jamais diffusé (seul le prestataire ciblé reçoit `job:new`) ; les autres reçoivent 404.
- **offre prestataire** (`POST /jobs/offer`) : `origin = provider_offer`, `status = accepted` ; client inconnu → 404 `details.can_invite = true`.
- **tender** : `visibility` public (prestataires de la compétence — sous-services inclus — de la ville ou à ≤ 50 km) ou `invited` ; offres uniques par prestataire (modifiables), plafond `max_bids_per_tender`, refus après `bid_deadline` ou attribution (409) ; attribution atomique (offre `accepted`, autres `rejected`, jalons de l'offre copiés) ; à échéance le planificateur clôt (`job:closed {reason:"expired"}`) et annule si aucune offre.
- **Score des offres** (tri de `GET /jobs/:id/bids`) : `0.40·(prix min / prix) + 0.25·(note/5) + 0.15·min(missions/50,1) + 0.10·(délai min / délai) + 0.10·(jalons proposés)`.

### Jalons
Tarification par jalon (frais minimum par jalon) ; prix/frais/total de la mission = sommes. `POST /jobs/:id/pay` sans `milestone_id` paie le prochain jalon `pending`. Soumission (`in_progress` requis) → `auto_release_at` ; libération client ou automatique ; la mission passe `done` quand plus aucun jalon n'est à exécuter et `completed` quand tous sont libérés.

### Portefeuille prestataire et trésorerie
- Versements **asynchrones** : `payout` créé `pending` à la libération, exécuté après COMMIT ; mock → `success` après ~3 s (`failed` si le numéro **ou** le n° de compte se termine par `000`).
- Portefeuille (`/me/wallet`) : `available` = crédits non versés (`payout`/`cancellation_fee` en `failed`, y compris quand `auto_payout = false`) − retraits (`withdrawal` pending/success). Retrait manuel sous verrou du profil, **uniquement vers le numéro MoMo enregistré ou le numéro du compte** (anti-détournement d'un jeton volé). Le planificateur relance automatiquement (retrait auto du disponible, 1 tentative / 30 min, 5 échecs max).
- Grand livre `/admin/treasury` : `escrow_held` (missions + jalons séquestrés), `providers_available`, `revenue_total` = frais de service + commissions (y compris sur frais d'annulation et splits) + abonnements + boosts (aucune remise n'est encore appliquée), `revenue_available = total − retraits réussis − retraits en cours`. `aggregator_balance` : `null` en mock, solde Campay (`GET /balance/`) ; Notch Pay : TODO ; Monetbil : pas d'API de solde.
- Retraits admin : mot de passe re-saisi (bcrypt), `pg_advisory_xact_lock` + recalcul du disponible dans la même transaction (deux retraits simultanés ne peuvent pas dépasser le disponible — testé), transaction `revenue_withdrawal` + ligne `admin_withdrawals`, audit. Reversement automatique `auto_settlement` (`daily`/`weekly`) vers le compte par défaut au-delà de `auto_settlement_min`.
- Comptes de versement : numéros chiffrés AES-256-GCM (`v1:iv:tag:ct`), seuls les 4 derniers chiffres sont stockés en clair et renvoyés masqués (`•••• 9012`) ; suppression logique.

### Planificateur (`src/scheduler/`)
Toutes les 60 s (désactivé en test, `runSchedulerOnce({ now, only })` appelable avec une horloge simulée) sous `pg_try_advisory_lock` : libération automatique (missions `done`, jalons `submitted`), rappels, no-show non contestés, alertes d'échéance des litiges, clôture des tenders, missions récurrentes (une seule création même après interruption), relance des versements prestataires, relance des remboursements échoués (5 essais), reversement automatique admin.

## Revue de sécurité (V2) — corrections apportées au code V1
- **IDOR** : `GET /transactions/:id` permettait au client de lire le payout du prestataire (numéro MoMo) → réservé au titulaire ; `POST /conversations` acceptait n'importe quel `job_id` → la mission doit concerner les deux interlocuteurs ; ressources d'autrui renvoyées en **404** (pas de 403 qui confirme l'existence) ; biens, récurrences, litiges, reçus, salons filtrés par propriétaire / partie.
- **Courses** : double acceptation (UPDATE conditionnel + 409), double paiement (encaissement en cours réutilisé, verrou mission + jalon), double libération (index unique sans filtre de statut, verrous), webhooks rejoués, retraits concurrents (verrou consultatif).
- **Montants** : `z.coerce.number` transformait `null`/`true`/`""` en 0/1 → validateur `amount()` strict (entier, plafond 500 M) ; arithmétique entière partout, commission plafonnée au montant.
- **Validation** : schémas `strictObject` sur les endpoints sensibles (trésorerie, offres, jalons, biens, compte entreprise, PATCH /me) ; URLs de fichiers limitées à `/uploads/…` ou `https://` (avatar, photos, preuves, pièces jointes, images de chat) ; échappement des `%`/`_` dans les recherches ILIKE.
- **Brute force** : verrouillage 15 min après 5 échecs de connexion (même avec le bon mot de passe), temps de réponse homogène (bcrypt factice), OTP limité à 3 / 10 min par numéro + 10 / 15 min par IP, un seul OTP actif, essais comptés atomiquement ; mot de passe ≥ 8 caractères ; lookup prestataire et invitations limités par utilisateur.
- **Uploads** : images + PDF uniquement, **contenu vérifié par signature** (un `.png` qui n'en est pas un est refusé), SVG refusé, `nosniff`, avatar/portfolio images seulement, 50 réalisations max.
- **En-têtes** : CSP stricte, `Referrer-Policy: no-referrer`, HSTS en production, `Cache-Control: no-store` sur l'API, timeouts HTTP.
- **Erreurs** : plus aucun `err.message` renvoyé sur les 500 (même en dev), message générique pour les refus du fournisseur de paiement, route inconnue sans écho du chemin, erreurs Socket.IO internes masquées.
- **Index / N+1** : index pour libération auto, tenders ouverts, jalons, litiges par mission, messages non lus, notifications non lues, transactions par utilisateur/type ; litiges admin sérialisés en lot (une requête par type au lieu d'un `fetchJob` par litige) ; jalons et offres hydratés en lot.

## Paiements : mock, Notch Pay, Campay, Monetbil

Interface : `initiate`, `verifyWebhook` (`kind: payment|transfer`), `checkStatus(external_ref)` (re-vérification serveur à serveur), `payout({amount, phone, operator, bank?, reference})`, `balance()`, `transferFee(amount, type, {destination})`, `meta` (`supports`, `fees`, `docs_url`), `isConfigured()`.

**Choix du fournisseur.** `payment_provider` (encaissements) et `payout_provider` (`same` par défaut : versements prestataires, retraits portefeuille, retraits admin). Remboursements : fournisseur qui a encaissé s'il sait verser, sinon `payout_provider`. Chaque transaction enregistre son fournisseur ; webhooks et vérifications de statut utilisent **toujours** celui de la transaction, même si l'admin a changé le réglage entre-temps. `PUT /admin/settings` refuse un fournisseur non configuré ; `GET /admin/payment-providers` expose configuration, capacités et frais. Migration `003_payment_providers.sql` (contrainte `transactions.provider`).

**Webhooks Campay / Monetbil** (`/payments/webhook/campay`, `/payments/webhook/monetbil`, GET ou POST) : signature vérifiée (401) → transaction retrouvée et appartenant à ce fournisseur → **statut, montant et devise re-vérifiés via l'API du fournisseur** (jamais le seul corps du webhook) → montant différent : transaction `failed`, 409, alerte admin. Idempotents. Le planificateur (`provider_reconciliation`) re-vérifie les transactions `pending` depuis plus de 2 min (webhook perdu, versement Campay en attente). Fournisseur sans versement (Monetbil par défaut) : le payout échoue proprement (`PAYOUT_UNSUPPORTED`), le montant reste dans le portefeuille du prestataire et les admins sont notifiés.

### Campay — confirmé par la documentation officielle
Sources : [API (Postman officiel, lié depuis campay.net)](https://documenter.getpostman.com/view/2391374/T1LV8PVA) · [SDK Python officiel](https://github.com/CamPay/campay-python-sdk) · [tarifs (page d'accueil)](https://www.campay.net/).
- ✅ Bases `https://demo.campay.net/api` / `https://www.campay.net/api` ; `Authorization: Token <jeton>` ; `POST /token/` `{username, password}` → `{token, expires_in: 3600}`, ou jeton permanent (APP KEYS).
- ✅ `POST /collect/` `{amount, currency: "XAF", from: "2376XXXXXXXX", description, external_reference}` → `{reference, ussd_code, operator}` ; montants entiers ; numéro sans « + ».
- ✅ `GET /transaction/{reference}/` → `status` `PENDING|SUCCESSFUL|FAILED`, `amount`, `currency`, `external_reference`, `endpoint` (`collect`/`withdraw`), `reason`…
- ✅ `POST /withdraw/` `{amount, to, description, external_reference}` → `{reference, status}` (le retrait par API doit être autorisé dans les réglages de l'application ; ER301 = solde insuffisant, soldes MTN et Orange séparés).
- ✅ `GET /balance/` → `{total_balance, mtn_balance, orange_balance, currency}` → `aggregator_balance` de la trésorerie.
- ✅ Callback (URL déclarée dans l'application : `<PUBLIC_URL>/api/v1/payments/webhook/campay`, GET query ou POST JSON) avec `signature` = JWT HS256 signé avec la « webhook key ». Le JWT ne couvre pas les champs de la transaction → re-vérification systématique.
- ✅ Frais publiés : 2 % encaissement, 1 % retrait, 5 000 FCFA par virement bancaire.
- ✅ **Pas de virement bancaire par API** : un retrait admin vers une banque est refusé avec « Avec Campay, le virement bancaire se fait depuis le tableau de bord Campay ».
- ⚠️ `TODO(campay)` : champ `currency` sur `/withdraw/` (absent de l'exemple Postman, présent dans le SDK — envoyé par prudence) ; contenu exact du JWT de callback ; plafonds du bac à sable (non documentés — tester avec de petits montants).

### Monetbil — confirmé par la documentation officielle
Sources : [SDK PHP officiel](https://github.com/Monetbil/monetbil-php) (monetbil.php, notify.php) · [encaissement direct](https://monetbil.company/doc/sandbox/collection) · [widget v2.1 (PDF)](https://www.monetbil.com/docs/monetbil-payment-widget-v2.1-en.pdf) · [notification (PDF)](https://www.monetbil.com/docs/monetbil-payment-notification-en.pdf) · [versement](https://www.monetbil.company/doc/sandbox/disbursement). Les pages de monetbil.com sont derrière un CAPTCHA : certaines n'ont été lues que partiellement.
- ✅ (SDK) `POST https://api.monetbil.com/payment/v1/checkPayment` `{paymentId}` → `transaction.status` : `1` succès, `0` échec, `-1` annulé, `7/8/9` mode test (refusé sauf `MONETBIL_ALLOW_TESTMODE=true`).
- ✅ (SDK) Notification `notify_url` : `service, transaction_id (= paymentId), transaction_uuid, msisdn, amount, fee, status, currency, item_ref, payment_ref, …, sign` ; **signature** = `md5(service_secret + valeurs triées par clé)` sur tous les champs sauf `sign` (comparée en temps constant).
- ✅ (doc) `POST …/payment/v1/placePayment` `{service, phonenumber, amount, operator: CM_MTNMOBILEMONEY|CM_ORANGEMONEY, currency, country, item_ref, payment_ref, notify_url}` → `{status: "REQUEST_ACCEPTED", paymentId, channel…}` ; repli sur le widget v2.1 (`{success, payment_url}` → `checkout_url`).
- ⚠️ `TODO(monetbil)` : champs `amount`/`currency`/`payment_ref` de `checkPayment.transaction` non confirmés (à défaut, le montant **signé** de la notification est utilisé ; sans montant vérifiable, aucun crédit) ; format exact de `phonenumber` ; hôte du widget (`www.` dans le SDK, `api.` dans le PDF) ; noms des champs `channel*`.
- **Versements** : une API `POST https://api.monetbil.com/v1/payouts/withdrawal` `{service_key, service_secret, phonenumber, amount, processing_number, operator}` figure dans la documentation de versement, mais n'a pu être lue que partiellement (statuts, endpoint de vérification et notification de versement non documentés). Elle est donc **désactivée par défaut** : `payout` lève « Monetbil ne propose pas de versement automatique dans cette intégration » → payout prestataire `failed`, crédité au portefeuille, admins notifiés. Réglez `payout_provider = campay` (ou NotchPay) pour verser. `MONETBIL_PAYOUT_ENABLED=true` active l'appel après vérification (`TODO(monetbil)`). Pas d'API de solde, pas de virement bancaire, pas de tarifs publics (négociés).

⚠️ **À vérifier dans la documentation officielle Notch Pay avant production** (marqués `TODO(notchpay)`) : en-tête `X-Grant`, format des réponses de paiement, liste des événements webhook (dont `transfer.*`), endpoint et format des transferts Mobile Money, **disponibilité et format des virements bancaires** (canal, champs bénéficiaire), frais de transfert (0 par défaut), endpoint de solde, re-vérification serveur du statut et du montant avant crédit. Rien n'a été testé contre l'API réelle.

## Choix d'interprétation / écarts au contrat
- Les ressources d'autrui renvoient **404** (au lieu de 403) pour ne pas révéler leur existence ; 403 reste utilisé quand l'utilisateur est partie mais n'a pas le rôle (ex. le client qui tente un statut terrain).
- `POST /jobs` sans `mode` : `direct` si `provider_id`, sinon `instant` (compatibilité V1). `provider_id` en mode `instant`/`tender` → 400. Jalons refusés en mode `instant`.
- Tender : `price = 0` jusqu'à l'attribution ; `budget` = `budget_max`/`budget_min` si absent.
- Split / proposition : `provider_amount` est brut (commission prestataire déduite si `provider_commission_rate > 0`), `client_refund = total séquestré − provider_amount` (les frais de service sont donc remboursés au prorata du reste) ; borne `0 ≤ provider_amount ≤ total séquestré`. Accord à 0 → `refund`, au total → `release`.
- Frais d'annulation `en_route` plafonnés au prix (du 1er jalon séquestré pour une mission par jalons) ; commission Tasko éventuelle prélevée dessus (`cancellation_fees_kept`).
- `auto_payout = false` : le payout est enregistré `failed` avec `meta.wallet = "auto_payout_off"` (crédit portefeuille, non relancé automatiquement).
- Portefeuille : le retrait est limité au numéro MoMo enregistré ou au numéro du compte (sécurité ; le contrat accepte un `phone` libre).
- Reçu : numéroté à la première demande (`TSK-AAAA-NNNNNN`), champ `refunded` ajouté ; `receipt.html` exige le même jeton Bearer (pas de jeton dans l'URL).
- Champs ajoutés (extensions) : `Milestone.total/provider_payout/provider_commission`, `Bid.score`, `ProviderCard.public_code`, `Dispute.pending_decision`, `Message.sender_name`, `GET /disputes/:id/messages → job_chat`, `PUT /me/business` accepte aussi `{ "business": null }`.
- `GET /admin/disputes` trie par urgence (`decision_due_at` croissant pour les litiges actifs, puis résolus récents).
- Litige sur mission par jalons : porte sur un jalon (`milestone_id`, sinon le jalon séquestré courant) ; après résolution la mission reprend son statut précédent.

## Formes de données attendues par l'admin V2 (alignement)
- `GET /admin/users` et `GET /admin/users/:id` : chaque User porte `trust: {rating_avg, rating_count, jobs_paid, disputes_lost}` (réputation client) ; `provider` inclut `public_code`, `cancellations`, `no_shows`, `disputes_lost`.
- Job : `provider.no_shows`, `provider.disputes_lost`, `provider.public_code` et `client.trust`.
- Message : toujours `sender_role` (`client`|`provider`|`admin`|`system`) et `sender_name` (« Médiateur Tasko » pour un admin, « Tasko » pour un message système). Pour les anciens messages directs sans rôle stocké, le rôle est déduit de la mission liée (sinon du profil de l'expéditeur).
- `GET /jobs/:id/bids` : le client propriétaire **et les admins** voient toutes les offres.
- Socket.IO : un admin peut `conversation:join` un salon de médiation et reçoit `message:new`.
- Journal d'audit, clés `domaine.action` : `treasury.withdrawal`, `treasury.withdrawal_denied` (mauvais mot de passe), `treasury.auto_settlement`, `dispute.resolve`, `dispute.confirm`, `settings.update`, `payout_account.create|update|delete`, `user.update`, `category.create|update|delete|reorder`.
- Split : `0 ≤ provider_amount ≤ montant séquestré concerné` (total du job, ou montant + frais du jalon contesté) ; le reste est remboursé au client.

## Notes de sécurité
- `JWT_SECRET` et `DATA_ENCRYPTION_KEY` longs et aléatoires en prod ; HTTPS obligatoire ; restreindre `CORS_ORIGINS`.
- `otp_dev_mode` doit être **désactivé** en prod et un fournisseur SMS branché (`TODO(sms)` : OTP et `/invitations`).
- Les comptes de démo (seeds/README.md) et les comptes de versement fictifs du seed ne doivent jamais exister en production.
