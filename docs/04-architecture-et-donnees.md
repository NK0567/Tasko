# Tasko — Architecture et modèle de données

![Maquette des 16 écrans](maquettes/tasko-16-ecrans.webp)

> Ce document décrit l'architecture cible et le modèle de données. Les noms d'objets, statuts, événements temps réel et formules sont alignés sur le [contrat d'API](05-contrat-api.md), qui fait foi en cas de divergence.

---

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Composants](#2-composants)
3. [Flux de paiement en séquestre](#3-flux-de-paiement-en-séquestre)
4. [Machine à états d'une mission](#4-machine-à-états-dune-mission)
5. [Modèle de données](#5-modèle-de-données)
6. [Algorithme de matching](#6-algorithme-de-matching)
7. [Stratégie temps réel](#7-stratégie-temps-réel)
8. [Sécurité](#8-sécurité)
9. [Déploiement](#9-déploiement)
10. [Évolution data & IA](#10-évolution-data--ia)
11. [V2 — Garantie de paiement, jalons, appels d'offres, planificateur et grand livre](#11-v2--garantie-de-paiement-jalons-appels-doffres-planificateur-et-grand-livre)

> **V2** : la machine à états, les règles d'annulation et le modèle de données sont complétés par la [section 11](#11-v2--garantie-de-paiement-jalons-appels-doffres-planificateur-et-grand-livre), qui prévaut sur les sections 3 à 5 en cas de divergence (contrat d'API § 5).

---

## 1. Vue d'ensemble

```mermaid
flowchart LR
    subgraph Clients
        M[App mobile Flutter<br/>Android · iOS · Web<br/>client + Mode Prestataire]
        A[Back-office React<br/>admin · port 5180 en dev]
    end

    subgraph Serveur["Serveur Tasko (Docker)"]
        API[API REST Node.js / Express<br/>/api/v1 · port 4300]
        WS[Socket.IO<br/>rooms user:/job:/conversation:]
        UP[(Stockage fichiers<br/>/uploads)]
        DB[(PostgreSQL)]
    end

    subgraph Externes["Services externes"]
        PAY[Agrégateur de paiement<br/>NotchPay · mock en dev]
        MOMO[MTN MoMo / Orange Money]
        OSM[OpenStreetMap<br/>tuiles cartographiques]
        FCM[Firebase Cloud Messaging]
        SMS[Fournisseur SMS OTP]
    end

    M -- HTTPS JSON + JWT --> API
    A -- HTTPS JSON + JWT admin --> API
    M <-- WebSocket --> WS
    A <-. WebSocket optionnel .-> WS
    API --- WS
    API --> DB
    API --> UP
    API -- initie paiement / payout --> PAY
    PAY -- webhook signé HMAC --> API
    PAY --- MOMO
    M -- tuiles --> OSM
    A -- tuiles --> OSM
    API --> FCM --> M
    API --> SMS
```

Principes :
- **Une seule API** pour l'app et l'admin ; l'admin est un client privilégié (rôle `is_admin`).
- **API sans état** (JWT) → réplicable ; l'état temps réel transite par Socket.IO (adaptateur Redis à l'échelle).
- **Paiement découplé** : un adaptateur `PaymentProvider` avec quatre implémentations (`mock`, `notchpay`, `campay`, `monetbil`), sélectionnée par le paramètre `payment_provider` (encaissements) et `payout_provider` (versements, `same` par défaut) ; chaque transaction garde son fournisseur.
- **Catalogue piloté par les données** : catégories, tarifs, villes et paramètres en base, jamais dans le code client.

---

## 2. Composants

| Composant | Technologie | Responsabilités |
|---|---|---|
| **App mobile** | Flutter (Dart) | Parcours client et prestataire, carte (`flutter_map` + OSM), géolocalisation, Socket.IO client, cache local, FR/EN |
| **Back-office** | React (Vite) | Tableau de bord, CRUD catégories/villes/promotions, utilisateurs, missions, transactions, litiges, avis, paramètres |
| **API** | Node.js / Express | Authentification JWT, OTP, règles métier, machine à états, tarification, matching, paiement, webhooks, statistiques |
| **Temps réel** | Socket.IO (même processus que l'API) | Diffusion des nouvelles demandes, statuts, positions, messages, notifications |
| **Base de données** | PostgreSQL | Données transactionnelles ; index géographiques (calcul de distance Haversine, PostGIS envisageable) |
| **Fichiers** | Disque local `/uploads` (dev) → stockage objet compatible S3 (prod) | Avatars, portfolio, photos de missions, pièces KYC (chiffrées) |
| **Paiement** | NotchPay (alternatives : Campay, Monetbil) | Encaissement Mobile Money, notification webhook, versements |
| **Notifications** | FCM + notifications en base | Push hors application, centre de notifications |
| **SMS** | Fournisseur SMS | Codes OTP |

---

## 3. Flux de paiement en séquestre

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant App as App Tasko
    participant API as API Tasko
    participant DB as PostgreSQL
    participant AG as Agrégateur (NotchPay / mock)
    participant MM as Opérateur Mobile Money
    actor P as Prestataire

    C->>App: « Payer maintenant » (MoMo, +2376…)
    App->>API: POST /jobs/:id/pay {method, phone}
    API->>API: Vérifie statut = accepted, recalcule total (5 250)
    API->>DB: INSERT transaction escrow_in (pending)
    API->>AG: Initie paiement 5 250 FCFA (référence interne)
    AG->>MM: Demande de débit
    MM-->>C: Demande de confirmation (code PIN sur le téléphone)
    API-->>App: {transaction, checkout_url}
    App->>API: GET /transactions/:id (polling) + écoute job:updated
    C->>MM: Confirme avec son code PIN
    MM-->>AG: Débit réussi
    AG->>API: Webhook signé (x-notch-signature)
    API->>API: Vérifie HMAC + idempotence
    API->>DB: transaction → success · job → funded · payment_status → held
    API-->>App: job:updated (funded) / notification
    API-->>P: job:updated + notification « Paiement sécurisé, vous pouvez partir »

    Note over P,API: Mission : en_route → arrived → in_progress → done

    C->>App: « Valider » + note
    App->>API: POST /jobs/:id/complete {rating, comment}
    API->>DB: job → completed · payment_status → released
    API->>DB: INSERT payout 5 000 (prestataire) + commission 250 (Tasko)
    API->>AG: Ordre de versement 5 000 FCFA vers MoMo du prestataire
    AG->>MM: Crédit du compte prestataire
    API-->>P: notification « Vous avez reçu 5 000 FCFA »
```

Variantes :
- **Échec** (refus, solde insuffisant ; en `mock`, numéro finissant par `000`) : transaction `failed`, mission reste `accepted`, erreur `PAYMENT_FAILED`.
- **Annulation client** en `funded`/`en_route` : transaction `refund`, `payment_status = refunded`, mission `cancelled`.
- **Litige** : fonds maintenus en `held` jusqu'à `POST /admin/disputes/:id/resolve` (`release` ou `refund`).

> ⚠️ En production, les fonds en séquestre doivent être détenus **par le partenaire agréé** (agrégateur / établissement de paiement / banque), Tasko n'enregistrant que l'état logique (`held`). Voir [02 — Risques](02-modele-economique.md#9-risques-et-conditions-de-succès).

---

## 4. Machine à états d'une mission

```mermaid
stateDiagram-v2
    [*] --> requested : POST /jobs (client)
    requested --> accepted : accept (prestataire)
    requested --> cancelled : cancel
    accepted --> funded : paiement OK (webhook / mock)
    accepted --> cancelled : cancel
    funded --> en_route : prestataire
    en_route --> arrived : prestataire
    arrived --> in_progress : prestataire
    in_progress --> done : prestataire

    funded --> completed : complete (client)
    en_route --> completed : complete (client)
    arrived --> completed : complete (client)
    in_progress --> completed : complete (client)
    done --> completed : complete (client) — fonds libérés

    funded --> cancelled : cancel client + refund
    en_route --> cancelled : cancel client + refund

    funded --> disputed : dispute
    en_route --> disputed : dispute
    arrived --> disputed : dispute
    in_progress --> disputed : dispute
    done --> disputed : dispute
    disputed --> completed : admin release
    disputed --> cancelled : admin refund

    completed --> [*]
    cancelled --> [*]
```

| Statut | `payment_status` typique | Signification |
|---|---|---|
| `requested` | `unpaid` | Demande créée (diffusée si pas de prestataire, sinon directe) |
| `accepted` | `unpaid` / `pending` | Prestataire trouvé ; en attente de paiement |
| `funded` | `held` | Fonds en séquestre ; le prestataire peut partir |
| `en_route` / `arrived` / `in_progress` / `done` | `held` | Exécution de la mission |
| `completed` | `released` | Validée ; prestataire payé, commission encaissée |
| `cancelled` | `unpaid` ou `refunded` | Annulée (remboursée si elle avait été payée) |
| `disputed` | `held` | Litige en cours d'arbitrage |

---

## 5. Modèle de données

### 5.1 Diagramme entité-association

```mermaid
erDiagram
    cities ||--o{ users : "localise"
    users ||--o| provider_profiles : "a (mode prestataire)"
    users ||--o{ provider_skills : "déclare"
    categories ||--o{ provider_skills : "compétence"
    categories ||--o{ categories : "parent de"
    users ||--o{ portfolio_items : "expose"
    users ||--o{ jobs : "client de"
    users ||--o{ jobs : "prestataire de"
    categories ||--o{ jobs : "classe"
    jobs ||--o{ transactions : "génère"
    users ||--o{ transactions : "concerne"
    jobs ||--o{ reviews : "évaluée par"
    users ||--o{ reviews : "auteur / cible"
    users ||--o{ conversations : "participe"
    jobs |o--o{ conversations : "contexte"
    conversations ||--o{ messages : "contient"
    users ||--o{ messages : "envoie"
    users ||--o{ notifications : "reçoit"
    users ||--o{ favorites : "suit"
    jobs ||--o| disputes : "fait l'objet de"
    users ||--o{ disputes : "ouvre / résout"
    users ||--o{ category_suggestions : "propose"
    promotions |o--o{ jobs : "appliquée à"

    users {
        uuid id PK
        string full_name
        string phone UK
        string email
        string password_hash
        string avatar_url
        string city
        bool is_provider
        bool is_admin
        string status
        int verification_level
        timestamp created_at
    }
    provider_profiles {
        uuid user_id PK, FK
        string headline
        text bio
        string provider_type
        int years_experience
        bool is_online
        float lat
        float lng
        float rating_avg
        int rating_count
        int missions_completed
        int completion_rate
        string momo_number
        string momo_operator
        string plan
        timestamp pro_until
        timestamp featured_until
        int_array available_days
    }
    categories {
        uuid id PK
        uuid parent_id FK
        string name
        string slug UK
        text description
        string icon
        string color
        int position
        bool is_active
    }
    provider_skills {
        uuid user_id PK, FK
        uuid category_id PK, FK
        int base_price
    }
    portfolio_items {
        uuid id PK
        uuid user_id FK
        string title
        string image_url
    }
    jobs {
        uuid id PK
        uuid client_id FK
        uuid provider_id FK
        uuid category_id FK
        string title
        text description
        string photo_url
        string address
        float lat
        float lng
        string urgency
        timestamp scheduled_at
        int budget
        int price
        int service_fee
        int total
        int provider_commission
        int provider_payout
        string status
        string payment_status
        timestamp accepted_at
        timestamp started_at
        timestamp completed_at
    }
    transactions {
        uuid id PK
        uuid job_id FK
        uuid user_id FK
        string type
        int amount
        string method
        string phone
        string provider
        string external_ref UK
        string status
        timestamp created_at
    }
    reviews {
        uuid id PK
        uuid job_id FK
        uuid author_id FK
        uuid target_id FK
        int rating
        text comment
    }
    conversations {
        uuid id PK
        uuid user_a FK
        uuid user_b FK
        uuid job_id FK
        timestamp updated_at
    }
    messages {
        uuid id PK
        uuid conversation_id FK
        uuid sender_id FK
        string type
        text body
        float lat
        float lng
        timestamp read_at
    }
    notifications {
        uuid id PK
        uuid user_id FK
        string type
        string title
        text body
        json data
        timestamp read_at
    }
    favorites {
        uuid user_id PK, FK
        uuid provider_id PK, FK
    }
    disputes {
        uuid id PK
        uuid job_id FK
        uuid opened_by FK
        text reason
        string status
        string resolution
        text note
        uuid resolved_by FK
    }
    settings {
        string key PK
        json value
    }
    cities {
        uuid id PK
        string name
        float lat
        float lng
        bool is_active
    }
    promotions {
        uuid id PK
        string code UK
        text description
        int discount_percent
        int max_uses
        int used_count
        timestamp expires_at
        bool is_active
    }
    category_suggestions {
        uuid id PK
        string label
        uuid user_id FK
        timestamp created_at
    }
```

### 5.2 Description des tables

| Table | Rôle | Points clés |
|---|---|---|
| `users` | Tout compte (client, prestataire, admin) | Téléphone unique normalisé `+237…` ; `status` `active`/`suspended` ; `verification_level` 1–5 ; `is_provider` vrai dès l'activation du mode prestataire |
| `provider_profiles` | Extension 1–1 de `users` pour le Mode Prestataire | Position (`lat`, `lng`), en ligne, agrégats de réputation (dénormalisés pour la recherche), MoMo, `plan`/`pro_until`, `featured_until`, jours de disponibilité |
| `categories` | Catalogue dynamique à 2 niveaux | `parent_id` nul = catégorie, sinon sous-service ; icône parmi la liste autorisée ; `position` pour l'ordre ; désactivation plutôt que suppression |
| `provider_skills` | Compétences d'un prestataire (N–N avec `categories`) | `base_price` par compétence → `min_price` des cartes de recherche |
| `portfolio_items` | Réalisations du prestataire | Image + titre |
| `jobs` | Missions | Montants **figés** à l'acceptation (prix, frais, commission, total, versement) ; `status` + `payment_status` ; horodatages de chaque étape |
| `transactions` | Journal financier immuable | Types `escrow_in`, `payout`, `commission`, `refund`, `subscription`, `boost` ; `external_ref` unique (idempotence des webhooks) |
| `reviews` | Notes croisées | Unicité (`job_id`, `author_id`) ; `target_id` = personne notée |
| `conversations` | Fil de discussion entre deux utilisateurs | Réutilisée si elle existe ; optionnellement liée à une mission |
| `messages` | Messages | `text`, `location` (lat/lng), `image` (URL dans `body`) ; `read_at` |
| `notifications` | Centre de notifications | `type` `job`/`payment`/`message`/`system` ; `data` JSON (ex. `job_id`) |
| `favorites` | Prestataires suivis | Clé composite |
| `disputes` | Litiges | `status` `open`/`resolved` ; `resolution` `release`/`refund` ; note de l'admin |
| `settings` | Paramètres plateforme clé/valeur | `client_fee_rate`, `provider_commission_rate`, `min_service_fee`, `search_radius_km`, `avg_speed_kmh`, `pro_plan_price`, `boost_day_price`, `boost_month_price`, `payment_provider`, `otp_dev_mode`… |
| `cities` | Villes ouvertes | Coordonnées par défaut (Yaoundé 3.8480, 11.5021 · Douala 4.0511, 9.7679) ; activation progressive |
| `promotions` | Codes promo | Pourcentage, plafond d'utilisation, expiration |
| `category_suggestions` | Saisies « Autre service » | Agrégées par libellé (nombre, dernière date) pour l'admin |

Tables techniques complémentaires (selon implémentation) : `otp_codes` (code haché, expiration, tentatives), `push_tokens`, `admin_audit_log`.

Index recommandés : `users(phone)`, `provider_profiles(is_online, lat, lng)`, `provider_skills(category_id)`, `jobs(status, created_at)`, `jobs(client_id)`, `jobs(provider_id)`, `transactions(external_ref)`, `messages(conversation_id, created_at)`, `notifications(user_id, read_at)`.

---

## 6. Algorithme de matching

### 6.1 Formule actuelle (contrat d'API)

```
score = 0,35 × (1 − d / rayon)            proximité
      + 0,25 × (note / 5)                 qualité perçue
      + 0,15 × min(missions / 50, 1)      expérience prouvée
      + 0,10 × en_ligne                   disponibilité immédiate (0 ou 1)
      + 0,10 × mis_en_avant               boost actif (0 ou 1)
      + 0,05 × pro                        abonnement Pro (0 ou 1)

eta_min   = ceil(d / vitesse_moyenne × 60) + 2      (vitesse_moyenne = 20 km/h par défaut)
min_price = plus petit base_price des compétences correspondant à la recherche
```

Pipeline :

```
Requête (lat, lng, catégorie, q)
  │
  ├─▶ 1. Filtre dur : compte actif, mode prestataire, compétence ∈ catégorie (ou sous-services)
  ├─▶ 2. Distance Haversine ≤ rayon (10 km par défaut)
  ├─▶ 3. Calcul du score (0–1) et de l'ETA
  └─▶ 4. Tri (score | distance | note | prix) → ProviderCard[]
```

Exemple : prestataire à 2,3 km (rayon 10), note 4,8, 57 missions, en ligne, non boosté, Pro → `0,35×0,77 + 0,25×0,96 + 0,15×1 + 0,10 + 0 + 0,05 ≈ 0,81`.

> La mise en avant et l'abonnement Pro pèsent volontairement **peu** (15 % au total) : on achète de la visibilité, pas la première place face à un prestataire bien plus proche et mieux noté. C'est une condition de confiance.

### 6.2 Évolution prévue

Ajout progressif de : prix relatif (vs médiane de la catégorie), disponibilité déclarée (jour/heure), taux d'acceptation et délai de réponse, taux d'annulation, historique client-prestataire (favori, déjà travaillé ensemble), puis remplacement des poids manuels par un modèle appris (*learning to rank*) entraîné sur les conversions réelles.

---

## 7. Stratégie temps réel

| Besoin | Mécanisme | Room / événement |
|---|---|---|
| Nouvelle demande diffusée | Serveur → prestataires en ligne, proches, compétents | `user:<id>` → `job:new` |
| Changement de statut | Serveur → client, prestataire, room de la mission | `job:<id>` → `job:updated` |
| Position du prestataire | Prestataire → serveur (`location:update`) → rooms de ses missions actives | `provider:location` (lat, lng, eta_min, distance_km) |
| Chat | Serveur → membres de la conversation | `conversation:<id>` → `message:new`, `typing` |
| Notifications | Serveur → utilisateur | `user:<id>` → `notification:new` |

Choix techniques :
- **Authentification** à la connexion (`auth: { token }`) ; adhésion aux rooms `job:` et `conversation:` contrôlée (seuls les participants).
- **Économie de données** : position envoyée toutes les 5–15 s seulement en mission active, et uniquement si déplacement significatif (> 20–30 m).
- **Résilience** : à la reconnexion, l'app recharge l'état par REST (`GET /jobs/:id`) — le temps réel accélère, le REST fait foi.
- **Mise à l'échelle** : adaptateur Redis pour Socket.IO et *sticky sessions* derrière le répartiteur de charge.
- **Repli** : push FCM quand l'app est en arrière-plan.

---

## 8. Sécurité

| Couche | Mesures |
|---|---|
| Identité | OTP SMS (limité en tentatives, code haché, expiration courte), mots de passe hachés (bcrypt/argon2), JWT signé 30 j |
| Autorisation | RBAC (client / prestataire / admin) + contrôle d'appartenance sur chaque ressource (mission, conversation, transaction) |
| API | Validation des entrées (schémas), requêtes SQL paramétrées, Helmet, CORS restreint aux origines connues, limitation de débit (auth, OTP, paiement) |
| Paiement | Montants calculés côté serveur, signature HMAC des webhooks, idempotence par `external_ref`, journal immuable des transactions, rapprochement quotidien avec l'agrégateur |
| Fichiers | Types MIME et tailles contrôlés, noms aléatoires, pièces KYC chiffrées et hors du répertoire public |
| Données personnelles | Minimisation, masquage des numéros dans les journaux, consentement, suppression de compte, durée de conservation |
| Exploitation | Secrets en variables d'environnement, HTTPS, sauvegardes chiffrées, mises à jour de dépendances, journalisation centralisée, alertes |
| Anti-fraude | Détection de comptes multiples (même téléphone/appareil), schémas de notation suspects, annulations répétées, litiges en série |

---

## 9. Déploiement

```mermaid
flowchart LR
    DEV[Développeur] -- push --> GIT[Dépôt Git]
    GIT --> CI[CI : lint · tests · build]
    CI --> IMG[Images Docker<br/>api · admin]
    CI --> APK[Build Flutter<br/>APK / AAB · Web]
    IMG --> STG[Préproduction]
    STG -- validation --> PROD
    subgraph PROD[Production — VPS ou cloud]
        RP[Reverse proxy<br/>Nginx / Caddy + TLS]
        API1[API + Socket.IO]
        ADM[Admin statique]
        PG[(PostgreSQL<br/>sauvegardes chiffrées)]
        RD[(Redis — à l'échelle)]
        RP --> API1
        RP --> ADM
        API1 --> PG
        API1 --> RD
    end
    APK --> STORE[Google Play / distribution]
```

| Étape | Choix |
|---|---|
| **Développement local** | `docker compose up -d` (PostgreSQL), API sur le port 4300, admin sur 5180, Flutter sur Chrome ou émulateur |
| **Hébergement MVP** | 1 VPS (2–4 vCPU, 4–8 Go RAM) avec Docker Compose ; datacenter le plus proche possible des utilisateurs (Europe ou Afrique) pour limiter la latence |
| **Montée en charge** | Base managée, plusieurs instances API, Redis, stockage objet, CDN pour les images |
| **CI/CD** | Pipeline (ex. GitHub Actions) : lint, tests unitaires (tarification, machine à états), tests d'API, build des images, déploiement sur préproduction puis production après validation |
| **Observabilité** | Journaux centralisés, métriques (latence, erreurs, jobs/minute, paiements en attente), alertes sur échec de webhook |
| **Sauvegardes** | Dump quotidien + rétention 30 jours ; test de restauration mensuel |

---

## 10. Évolution data & IA

```mermaid
flowchart LR
    PG[(PostgreSQL<br/>OLTP)] -- ETL nocturne --> DW[(Entrepôt de données<br/>schéma en étoile)]
    DW --> BI[Power BI / tableaux de bord]
    DW --> ML[Modèles IA]
    ML --> F1[Prévision de la demande<br/>zone × heure × catégorie]
    ML --> F2[Score de matching appris]
    ML --> F3[Détection de fraude]
    ML --> F4[Recommandation de prix]
    F1 & F2 & F3 & F4 --> API[API Tasko]
```

| Brique | Contenu | Usage |
|---|---|---|
| **Entrepôt de données** | Faits : missions, transactions, recherches (y compris sans résultat), connexions prestataires ; dimensions : temps, zone (maillage géographique), catégorie, prestataire, client | Analyse historique sans charger la base de production |
| **BI (Power BI)** | GMV, take rate, cohortes de rétention, taux de complétion, temps de mise en relation, carte de chaleur offre/demande | Pilotage, présentation aux investisseurs, mémoire de Master |
| **Prévision de la demande** | Séries temporelles par zone/heure/catégorie (saisonnalité hebdomadaire, jours de paie, rentrée, fêtes) | Alerter les prestataires (« forte demande en coiffure à Bastos samedi ») et ajuster le recrutement |
| **Matching appris** | Score = f(distance, disponibilité, note, expérience, prix, historique) entraîné sur les acceptations et validations | Meilleure conversion, moins d'annulations |
| **Détection de fraude** | Anomalies : paiements, comptes liés, faux avis, contournement | Réduction des pertes et protection de la confiance |

Prérequis : collecte d'événements dès le MVP (recherches, vues de profil, demandes non satisfaites), anonymisation pour l'analyse, et volume de données suffisant — l'IA est une **étape V2+**, pas une promesse du MVP.

---

## 11. V2 — Garantie de paiement, jalons, appels d'offres, planificateur et grand livre

> Spécification de référence : [contrat d'API § 5](05-contrat-api.md). Explications en langage simple : [08 — Confiance, paiement et trésorerie](08-confiance-paiement-et-tresorerie.md).

### 11.1 Composants ajoutés

| Composant | Rôle |
|---|---|
| **Planificateur serveur** (tâche périodique dans le processus API, toutes les minutes ; verrou consultatif PostgreSQL pour qu'une seule instance l'exécute) | (1) **libération automatique** des jobs et jalons dont `auto_release_at` est échu sans litige ouvert ; (2) **rappels** au client à mi-parcours et 2 h avant l'échéance ; (3) **missions récurrentes** : création d'une mission `direct` à `next_run_at` puis avance de l'échéance ; (4) **clôture des appels d'offres** à `bid_deadline` ; (5) **reversement automatique** des revenus (`auto_settlement`) ; (6) relance des versements prestataires en échec. |
| **Service de grand livre** | Calcule à partir des transactions les postes `escrow_held`, `providers_available`, `revenue_*` ; contrôle sous verrou chaque retrait admin. |
| **Service de chiffrement** | AES-256-GCM (clé `DATA_ENCRYPTION_KEY`) pour les numéros de comptes de reversement ; seules des valeurs masquées sortent de l'API. |
| **Journal d'audit** | Enregistre acteur, action, cible, détails, IP pour toute action sensible (retraits, comptes de reversement, litiges, paramètres, droits). |
| **Masquage des contacts** | Filtre de sérialisation (`phone = null` tant que `funds_secured = false`) et filtre des messages du chat (numéros remplacés par « 6•• •• •• •• »). |

Toutes les tâches du planificateur sont **idempotentes** (RG-G9) : chaque opération financière est exécutée dans une transaction SQL avec `SELECT … FOR UPDATE` sur le job ou le jalon, et des contraintes d'unicité (cible job/jalon + `type` pour `payout`, `commission`, `refund`) empêchent tout double versement, même si deux exécutions se chevauchent ou si un webhook arrive deux fois.

### 11.2 Séquence V2 : code de démarrage et libération automatique

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant API as API Tasko
    participant SCH as Planificateur
    participant AG as NotchPay (coffre)
    actor P as Prestataire
    C->>AG: Paiement (via POST /jobs/:id/pay)
    AG->>API: Webhook signé : succès
    API->>API: job funded, funds_secured = true, start_code généré, contacts démasqués
    API-->>P: « 5 000 FCFA sécurisés par Tasko — vous pouvez y aller »
    P->>API: status en_route puis arrived
    P->>API: status in_progress avec start_code
    API->>API: Vérifie le code (sinon refus)
    P->>API: status done avec proof_photos et note
    API->>API: done_at, auto_release_at = done_at + 48 h
    SCH->>C: Rappels (mi-parcours, H-2)
    SCH->>API: auto_release_at échu et pas de litige ouvert ?
    API->>API: BEGIN, SELECT FOR UPDATE, completed (completed_by = auto), payout + commission, COMMIT
    API->>AG: Transfert vers le MoMo du prestataire
    AG-->>API: Webhook transfert (succès, ou échec → wallet available)
```

### 11.3 Machine à états V2 d'une mission

```mermaid
stateDiagram-v2
    [*] --> requested : POST /jobs (instant, direct, tender)
    [*] --> accepted : POST /jobs/offer (offre du prestataire)
    requested --> accepted : accept (instant 1er gagnant, direct prestataire désigné) ou award (tender)
    requested --> cancelled : cancel gratuit ou bid_deadline sans attribution
    accepted --> cancelled : cancel gratuit
    accepted --> funded : paiement OK (total ou 1er jalon)
    funded --> en_route : prestataire (RG-G1)
    en_route --> arrived : prestataire
    arrived --> in_progress : prestataire + start_code (RG-G2)
    in_progress --> done : prestataire + preuves (RG-G3), auto_release_at = +48 h

    funded --> cancelled : client (remboursement intégral) ou prestataire
    en_route --> cancelled : client (remboursement moins frais de déplacement) ou prestataire
    arrived --> cancelled : prestataire uniquement
    in_progress --> cancelled : prestataire uniquement

    funded --> completed : client valide
    done --> completed : client valide ou planificateur 48 h (completed_by = auto)

    funded --> disputed : litige
    en_route --> disputed : litige
    arrived --> disputed : litige
    in_progress --> disputed : litige
    done --> disputed : litige avant auto_release_at (gèle la libération)
    disputed --> completed : admin release ou split
    disputed --> cancelled : admin refund

    completed --> [*]
    cancelled --> [*]
```

Notes :
- **Pas d'annulation client** à partir de `arrived` : seule la voie du litige reste ouverte. Une annulation par le prestataire rembourse toujours intégralement le client et incrémente son compteur `cancellations`.
- Le client peut toujours valider plus tôt (`funded`…`done` → `completed`), comme en V1.
- `split` : le job est `completed`, `provider_amount` est versé au prestataire, le reste est remboursé au client (`partial_refund`).
- Avec des **jalons**, le statut du job est dérivé : `funded` dès le 1er jalon financé, `done` quand le dernier jalon est `submitted`, `completed` quand tous sont `released`.

### 11.4 Machine à états d'un jalon

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> funded : client paie ce jalon (séquestre)
    funded --> submitted : prestataire soumet + preuves, auto_release_at = +48 h
    submitted --> released : client valide ou planificateur 48 h
    funded --> refunded : annulation ou admin refund
    funded --> disputed : litige
    submitted --> disputed : litige avant auto_release_at
    disputed --> released : admin release ou split
    disputed --> refunded : admin refund
    released --> [*]
    refunded --> [*]
```

### 11.5 Modèle de données — tables et colonnes ajoutées

```mermaid
erDiagram
    users ||--o| business_profiles : "compte Business"
    users ||--o{ properties : "possède"
    properties |o--o{ jobs : "concerne"
    properties |o--o{ recurring_jobs : "planifie"
    users ||--o{ recurring_jobs : "client ou prestataire attitré"
    recurring_jobs ||--o{ jobs : "génère"
    jobs ||--o{ milestones : "découpée en"
    jobs ||--o{ bids : "reçoit (tender)"
    users ||--o{ bids : "soumet"
    jobs ||--o{ job_invitations : "invite (tender invited)"
    disputes ||--o{ dispute_evidence : "preuves"
    jobs ||--o| receipts : "justifiée par"
    milestones ||--o{ transactions : "génère"
    payout_accounts ||--o{ withdrawals : "reçoit"
    users ||--o{ withdrawals : "demande (admin)"
    users ||--o{ audit_logs : "agit"

    business_profiles {
        uuid user_id PK
        string name
        string kind
        string niu
        string rccm
        string address
    }
    properties {
        uuid id PK
        uuid owner_id FK
        string name
        string kind
        string address
        float lat
        float lng
        int units_count
        text notes
    }
    recurring_jobs {
        uuid id PK
        uuid client_id FK
        uuid provider_id FK
        uuid property_id FK
        uuid category_id FK
        string title
        int price
        string frequency
        timestamp next_run_at
        bool is_active
    }
    milestones {
        uuid id PK
        uuid job_id FK
        int position
        string title
        int amount
        int service_fee
        string status
        timestamp funded_at
        timestamp submitted_at
        timestamp auto_release_at
        timestamp released_at
        json proof_photos
    }
    bids {
        uuid id PK
        uuid job_id FK
        uuid provider_id FK
        int amount
        int duration_days
        text message
        json attachments
        json milestones
        string status
    }
    job_invitations {
        uuid job_id PK
        uuid provider_id PK
    }
    dispute_evidence {
        uuid id PK
        uuid dispute_id FK
        uuid author_id FK
        text message
        json photos
    }
    receipts {
        uuid id PK
        uuid job_id FK
        string number UK
        timestamp issued_at
    }
    payout_accounts {
        uuid id PK
        string type
        string label
        string bank_name
        string account_holder
        bytea account_number_enc
        bytea phone_enc
        bool is_default
    }
    withdrawals {
        uuid id PK
        uuid payout_account_id FK
        uuid requested_by FK
        int amount
        int fee
        string status
        string external_ref
        text failure_reason
    }
    audit_logs {
        uuid id PK
        uuid actor_id FK
        string action
        string target
        json details
        string ip
        timestamp created_at
    }
```

| Table / colonne | Points clés |
|---|---|
| `users.account_type`, `business_profiles` | `individual` / `business` ; type `company`, `real_estate`, `ngo`, `administration`, `other` ; NIU, RCCM pour les reçus. |
| `provider_profiles.public_code`, `cancellations`, `wallet_available` | Code `TSK-XXXXX` unique (recherche directe) ; compteur d'annulations (score) ; disponible du portefeuille. |
| `jobs` (colonnes V2) | `mode`, `origin`, `visibility`, `bid_deadline`, `budget_min/max`, `funds_secured`, `funded_at`, `start_code` (renvoyé uniquement au client), `done_at`, `auto_release_at`, `completed_by`, `completion_proof`, `cancellation_fee`, `cancel_reason`, `cancelled_by`, `property_id`, `recurring_job_id`. Index `jobs(status, auto_release_at)` pour le planificateur. |
| `milestones` | Somme des `amount` = `jobs.price` ; index `(status, auto_release_at)`. |
| `bids` | Unicité `(job_id, provider_id)` ; statuts `pending/accepted/rejected/withdrawn`. |
| `job_invitations` | Prestataires invités d'un appel d'offres `invited`. |
| `disputes` (colonnes V2) | `milestone_id`, `respond_before`, `resolution` `release/refund/split`, `provider_amount`. |
| `reviews` | Désormais aussi **prestataire → client** (alimente `client.trust`). |
| `transactions` (types V2) | + `cancellation_fee`, `partial_refund`, `withdrawal` (prestataire), `revenue_withdrawal` (admin) ; colonne `milestone_id` ; unicité (cible + type) pour `payout`, `commission`, `refund`. |
| `receipts` | Numéro séquentiel par année `TSK-2026-000123`. |
| `payout_accounts` | Numéros **chiffrés** ; seules des versions masquées sont exposées. |
| `withdrawals` | Retraits admin ; `pending → success/failed`. |
| `audit_logs` | Remplace `admin_audit_log` ; en ajout seul (jamais modifié). |
| `settings` (clés V2) | `auto_release_hours`, `require_start_code`, `require_completion_proof`, `cancellation_fee_en_route`, `dispute_response_hours`, `mask_contacts_until_funded`, `tender_default_days`, `max_bids_per_tender`, `auto_payout`, `auto_settlement`, `auto_settlement_min`. |

### 11.6 Grand livre et trésorerie

Le coffre physique est **le compte marchand Tasko chez l'agrégateur** ; la base ne détient pas d'argent, elle **tient les comptes**. Chaque poste est calculé à partir des transactions réussies :

| Poste | Calcul (simplifié) | Appartient à |
|---|---|---|
| `escrow_held` | `escrow_in` des jobs/jalons non libérés − remboursements correspondants | Clients / prestataires — intouchable |
| `providers_available` | Montants libérés non encore versés ou en échec (+ `cancellation_fee` dus) − retraits prestataires | Prestataires — intouchable |
| `revenue_total` | Frais de service + commissions + abonnements + boosts + frais d'annulation conservés − remises | Tasko |
| `revenue_withdrawn` | `revenue_withdrawal` réussis | — |
| `revenue_available` | `revenue_total − revenue_withdrawn − retraits en cours` | **Seul poste retirable** |

Contrôles :
- **Retrait admin** : transaction SQL, verrou, recalcul de `revenue_available`, refus `409` si dépassement, mot de passe re-saisi (`401` sinon), entrée d'audit, puis ordre de transfert à l'agrégateur ; en cas d'échec, le montant redevient disponible.
- **Rapprochement** : `aggregator_balance` (si l'API de l'agrégateur l'expose) doit couvrir `escrow_held + providers_available + revenue_available` ; tout écart déclenche une alerte.

```mermaid
flowchart LR
    C[Client] -- escrow_in --> COFFRE[(Compte marchand<br/>NotchPay)]
    COFFRE -- payout --> P[MoMo prestataire]
    COFFRE -- refund / partial_refund --> C
    COFFRE -- cancellation_fee --> P
    COFFRE -- revenue_withdrawal --> B[Ecobank pro ou MoMo société]
    subgraph GL[Grand livre Tasko]
      E[escrow_held]
      PA[providers_available]
      R[revenue_available]
    end
    COFFRE -. reflété par .- GL
```
