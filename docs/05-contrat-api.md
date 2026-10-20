# Tasko — Contrat d'API (source de vérité partagée)

Ce document est la référence commune au **backend** (`backend/`), à l'**admin web** (`admin/`) et à l'**app mobile** (`mobile/`). Toute évolution de l'API doit d'abord être reportée ici.

## 0. Conventions

| Élément | Valeur |
|---|---|
| Base URL (dev) | `http://localhost:4300/api/v1` (émulateur Android : `http://10.0.2.2:4300/api/v1`) |
| Socket.IO (dev) | `http://localhost:4300` (path par défaut `/socket.io`) |
| Fichiers uploadés | servis sous `http://localhost:4300/uploads/...` |
| Format | JSON, champs en `snake_case` |
| Identifiants | UUID v4 (string) |
| Montants | **entiers en FCFA (XAF)** — jamais de décimales |
| Dates | ISO 8601 UTC (`2026-10-03T08:15:00.000Z`) |
| Auth | `Authorization: Bearer <JWT>` (expiration 30 j) |
| Listes | toujours `{ "items": [...] }` ; listes paginées : `{ "items": [...], "total": 123, "page": 1, "limit": 20 }` (query `?page=&limit=`) |
| Erreurs | `{ "error": { "code": "VALIDATION_ERROR", "message": "texte lisible en français", "details": {...}? } }` |

Codes d'erreur : `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INVALID_STATE` (409, transition de statut interdite), `PAYMENT_FAILED` (402), `INTERNAL` (500).

Coordonnées par défaut : Yaoundé `3.8480, 11.5021` · Douala `4.0511, 9.7679`.

## 1. Objets

### User
```json
{
  "id": "uuid", "full_name": "Moussa Kamga", "phone": "+237690000001", "email": null,
  "avatar_url": null, "city": "Yaoundé", "is_provider": true, "is_admin": false,
  "status": "active", "verification_level": 2, "created_at": "...",
  "provider": ProviderProfile | null
}
```
`status` : `active` | `suspended`. `verification_level` : 1 compte créé · 2 téléphone vérifié · 3 identité vérifiée · 4 compétence vérifiée · 5 prestataire recommandé.

### ProviderProfile
```json
{
  "user_id": "uuid", "headline": "Étudiant / Informaticien", "bio": "...",
  "provider_type": "student", "years_experience": 2,
  "is_online": true, "lat": 3.86, "lng": 11.51,
  "rating_avg": 4.7, "rating_count": 12, "missions_completed": 12, "completion_rate": 96,
  "momo_number": "+237690000001", "momo_operator": "mtn",
  "plan": "free", "pro_until": null, "featured_until": null,
  "available_days": [1,2,3,4,5,6],
  "skills": [ { "category_id": "uuid", "name": "Plomberie", "parent_name": "Bâtiment & Chantier", "icon": "plumbing", "base_price": 5000 } ],
  "portfolio": [ { "id": "uuid", "title": "Réparation fuite", "image_url": "/uploads/x.jpg" } ]
}
```
`provider_type` : `artisan` | `student` | `professional` | `freelancer` (débrouillard / indépendant) | `company`.
`available_days` : 0 = dimanche … 6 = samedi. `momo_operator` : `mtn` | `orange`. `plan` : `free` | `pro`.

### ProviderCard (résultat de recherche / carte)
```json
{
  "id": "uuid (= user id)", "full_name": "Bika Services", "avatar_url": null,
  "headline": "Plombier", "provider_type": "artisan",
  "rating_avg": 4.8, "rating_count": 23, "missions_completed": 57,
  "distance_km": 2.3, "eta_min": 8, "min_price": 5000,
  "is_online": true, "is_featured": false, "is_pro": true, "verification_level": 3,
  "lat": 3.86, "lng": 11.51, "skills": ["Plomberie", "Dépannage"], "score": 0.82
}
```

### Category (catégories et sous-services dynamiques — jamais codés en dur)
```json
{
  "id": "uuid", "parent_id": null, "name": "Beauté & Bien-être", "slug": "beaute-bien-etre",
  "description": "...", "icon": "spa", "color": "#E91E63", "position": 3, "is_active": true,
  "providers_count": 120, "children": [Category]
}
```
Un niveau de profondeur : catégorie (parent_id null) → sous-services (parent_id = catégorie).

**Clés d'icône autorisées** (mappées vers Material Icons côté mobile/admin) :
`construction, home_repair_service, spa, computer, school, local_shipping, shopping_basket, directions_car, checkroom, celebration, yard, build, handyman, plumbing, electrical_services, cleaning_services, local_laundry_service, content_cut, face, brush, photo_camera, restaurant, phone_android, ac_unit, chair, child_care, translate, description, print, design_services, videocam, music_note, pets, agriculture, fitness_center, security, key, format_paint, moving, volunteer_activism, more_horiz`

### Job (mission)
```json
{
  "id": "uuid",
  "client": { "id": "uuid", "full_name": "...", "avatar_url": null, "phone": "+237..." },
  "provider": { "id": "uuid", "full_name": "...", "avatar_url": null, "phone": "+237...", "headline": "Plombier", "rating_avg": 4.8, "lat": 3.86, "lng": 11.51 } | null,
  "category": { "id": "uuid", "name": "Plomberie", "icon": "plumbing", "parent_name": "Bâtiment & Chantier" },
  "title": "Plomberie - Réparation fuite", "description": "Fuite sous l'évier", "photo_url": null,
  "address": "Bastos, Yaoundé", "lat": 3.89, "lng": 11.51,
  "urgency": "now", "scheduled_at": null,
  "budget": 5000, "price": 5000, "service_fee": 250, "total": 5250,
  "provider_commission": 0, "provider_payout": 5000,
  "status": "funded", "payment_status": "held",
  "distance_km": 2.3,
  "created_at": "...", "accepted_at": "...", "started_at": null, "completed_at": null,
  "review": { "rating": 5, "comment": "..." } | null
}
```
`urgency` : `now` | `today` | `scheduled`.
`payment_status` : `unpaid` | `pending` | `held` (séquestre) | `released` | `refunded`.

**Machine à états `status`** :
```
requested ──accept(prestataire)──▶ accepted ──pay OK(client)──▶ funded
funded ──▶ en_route ──▶ arrived ──▶ in_progress ──▶ done        (actions prestataire)
funded|en_route|arrived|in_progress|done ──complete(client)──▶ completed  (libère les fonds)
requested|accepted ──cancel──▶ cancelled (aucun remboursement nécessaire)
funded|en_route ──cancel(client)──▶ cancelled + refund
funded..done ──dispute──▶ disputed ──(admin resolve)──▶ completed | cancelled(+refund)
```
`requested` sans `provider` = demande diffusée à tous les prestataires proches de la compétence. `requested` avec `provider` = demande directe à ce prestataire.

### Tarification
`service_fee = max(min_service_fee, round(price × client_fee_rate))` payé par le client en plus.
`provider_commission = round(price × provider_commission_rate)` retenu au prestataire.
`total = price + service_fee` ; `provider_payout = price − provider_commission`.
**Revenu Tasko par job = service_fee + provider_commission.** Valeurs par défaut : `client_fee_rate = 0.05`, `provider_commission_rate = 0`, `min_service_fee = 100`.

### Transaction
```json
{ "id": "uuid", "job_id": "uuid"|null, "user_id": "uuid", "type": "escrow_in", "amount": 5250,
  "method": "mtn_momo", "phone": "+237...", "provider": "mock", "external_ref": "MOCK-...",
  "status": "success", "created_at": "..." }
```
`type` : `escrow_in` (client → séquestre) · `payout` (séquestre → prestataire) · `commission` (revenu Tasko) · `refund` · `subscription` (Tasko Pro) · `boost` (mise en avant).
`method` : `mtn_momo` | `orange_money` | `card`. `provider` : `mock` | `notchpay` | `campay` | `monetbil` (fournisseur qui a traité la transaction ; conservé même si l'admin change de fournisseur — webhooks et vérifications de statut utilisent toujours celui-ci). `status` : `pending` | `success` | `failed`.

### Review
`{ "id", "job_id", "author": {id, full_name, avatar_url}, "rating": 1..5, "comment": "...", "created_at" }`

### Conversation / Message
```json
{ "id": "uuid", "other_user": { "id", "full_name", "avatar_url", "headline", "is_online" },
  "job_id": null, "last_message": Message|null, "unread_count": 0, "updated_at": "..." }
{ "id": "uuid", "conversation_id": "uuid", "sender_id": "uuid", "type": "text", "body": "...",
  "lat": null, "lng": null, "created_at": "...", "read_at": null }
```
`type` : `text` | `location` | `image` (pour `image`, `body` = URL).

### Notification
`{ "id", "type": "job"|"payment"|"message"|"system", "title", "body", "data": {"job_id": "..."}, "read_at": null, "created_at" }`

### Settings (paramètres plateforme, modifiables par l'admin)
```json
{ "client_fee_rate": 0.05, "provider_commission_rate": 0, "min_service_fee": 100,
  "search_radius_km": 10, "avg_speed_kmh": 20, "pro_plan_price": 3000,
  "boost_day_price": 500, "boost_month_price": 5000, "currency": "XAF",
  "otp_dev_mode": true, "payment_provider": "mock", "payout_provider": "same", "support_phone": "+237600000000" }
```
`payment_provider` (encaissements) : `mock` | `notchpay` | `campay` | `monetbil`. `payout_provider` (versements prestataires, remboursements si le fournisseur d'encaissement ne sait pas verser, retraits portefeuille et retraits admin) : `same` (défaut = `payment_provider`) | `mock` | `notchpay` | `campay` | `monetbil`. `PUT /admin/settings` refuse (`400 VALIDATION_ERROR`, `details.payment_provider|payout_provider = "Non configuré"`) un fournisseur dont les clés ne sont pas présentes dans l'environnement du serveur.

## 2. Endpoints

### Auth
| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/auth/otp/request` | `{phone}` | `{ sent: true, dev_code?: "123456" }` (dev_code seulement si `otp_dev_mode`) |
| POST | `/auth/register` | `{full_name, phone, password, otp_code?, city?}` | `{token, user}` |
| POST | `/auth/login` | `{phone, password}` | `{token, user}` |
| GET | `/me` | — | `User` |
| PATCH | `/me` | `{full_name?, email?, city?, avatar_url?}` | `User` |
| POST | `/me/avatar` | multipart `file` | `User` |
| PUT | `/me/provider` | `{headline, bio, provider_type, years_experience, momo_number, momo_operator, available_days}` (active le mode prestataire) | `User` |
| PATCH | `/me/provider/status` | `{is_online}` | `User` |
| POST | `/me/location` | `{lat, lng}` | `{ok:true}` |
| PUT | `/me/skills` | `{skills:[{category_id, base_price}]}` | `User` |
| POST | `/me/portfolio` | multipart `file`, `title` | `ProviderProfile` |
| GET | `/me/earnings` | — | `{ balance_held, total_earned, month_earned, jobs_completed, items:[Transaction] }` |
| POST | `/me/subscription` | `{plan:"pro", method, phone}` | `{transaction}` |
| POST | `/me/boost` | `{duration:"day"\|"month", method, phone}` | `{transaction}` |
| GET | `/me/favorites` | — | `{items:[ProviderCard]}` |

Phone : normalisé en `+237XXXXXXXXX` (9 chiffres commençant par 6 ou 2).

### Catalogue
| GET | `/categories` | `?all=true` (admin seulement : inclut inactives) | `{items:[Category avec children]}` triées par `position` |
| GET | `/categories/:id` | — | `Category` |
| GET | `/cities` | — | `{items:[{id,name,lat,lng,is_active}]}` |
| GET | `/settings/public` | — | `{client_fee_rate, provider_commission_rate, min_service_fee, currency, search_radius_km}` |

### Prestataires
| GET | `/providers` | `?lat&lng&radius_km&category_id&q&sort=score\|distance\|rating\|price&online=true&limit` | `{items:[ProviderCard]}` |
| GET | `/providers/:id` | `?lat&lng` | `ProviderCard + { bio, years_experience, available_days, skills, portfolio, reviews:[Review] (5 dernières), is_followed }` |
| GET | `/providers/:id/reviews` | paginé | `{items:[Review], total, page, limit}` |
| POST | `/providers/:id/follow` | — | `{is_followed: bool}` (bascule) |

`category_id` peut être une catégorie parente (inclut tous ses sous-services) ou un sous-service.
**Score de matching** (0–1) : `0.35·(1 − d/radius) + 0.25·(rating/5) + 0.15·min(missions/50,1) + 0.10·online + 0.10·featured + 0.05·pro`. Tri par défaut `score`.
`eta_min = ceil(distance_km / avg_speed_kmh × 60) + 2`. `min_price` = plus petit `base_price` des compétences correspondantes.

### Missions
| GET | `/jobs/quote` | `?price=5000` | `{price, service_fee, total, provider_commission, provider_payout}` |
| POST | `/jobs` | `{category_id, description, address, lat, lng, urgency, scheduled_at?, budget, provider_id?, photo_url?, title?, other_label?}` — `other_label` = service saisi librement avec la catégorie slug `autre` (alimente `/admin/category-suggestions`) | `Job` (status `requested`) |
| POST | `/uploads` | multipart `file` | `{url}` |
| GET | `/jobs` | `?as=client\|provider&status=active\|history\|<status>` | `{items:[Job]}` |
| GET | `/jobs/nearby` | (prestataire) `?lat&lng` | `{items:[Job]}` demandes `requested` sans prestataire, dans le rayon, correspondant à ses compétences |
| GET | `/jobs/:id` | — | `Job` |
| POST | `/jobs/:id/accept` | (prestataire) `{price?}` | `Job` → `accepted` |
| POST | `/jobs/:id/decline` | (prestataire) | `{ok:true}` |
| POST | `/jobs/:id/pay` | (client) `{method, phone}` | `{transaction, checkout_url: string\|null}` |
| POST | `/jobs/:id/status` | (prestataire) `{status: "en_route"\|"arrived"\|"in_progress"\|"done"}` | `Job` |
| POST | `/jobs/:id/complete` | (client) `{rating?, comment?}` | `Job` → `completed`, fonds libérés (payout + commission) |
| POST | `/jobs/:id/review` | `{rating, comment?}` | `Review` |
| POST | `/jobs/:id/cancel` | `{reason?}` | `Job` |
| POST | `/jobs/:id/dispute` | `{reason}` | `Job` → `disputed` |
| GET | `/transactions/:id` | — | `Transaction` (polling) |
| POST | `/payments/webhook/notchpay` | webhook signé (HMAC `x-notch-signature`) | `{ok:true}` |
| GET/POST | `/payments/webhook/campay` | callback Campay (query ou JSON), `signature` = JWT HS256 (clé `CAMPAY_WEBHOOK_KEY`) | `{ok:true, status?, ignored?}` — `401` signature invalide, `409` montant incohérent |
| POST/GET | `/payments/webhook/monetbil` | notification Monetbil (formulaire), `sign` = md5(secret + valeurs triées par clé) | idem |

Webhooks Campay / Monetbil : idempotents ; la transaction est retrouvée par notre référence (`external_reference` / `payment_ref` = id de transaction) ou la référence fournisseur, **et doit appartenir à ce fournisseur** (sinon `ignored: "provider_mismatch"`). Le statut, le montant et la devise sont **re-vérifiés auprès de l'API du fournisseur** (Campay `GET /transaction/{ref}/`, Monetbil `checkPayment`) avant tout passage en `funded` : le corps du webhook ne suffit jamais. Montant différent → transaction `failed`, `409`, alerte admin. Un planificateur re-vérifie aussi les transactions restées `pending` plus de 2 min (webhook perdu). Campay et Monetbil (paiement direct) n'ont pas de page hébergée : `checkout_url = null`, le client valide sur son téléphone ; Monetbil peut renvoyer une `checkout_url` (widget) si le paiement direct est refusé.

Fournisseur `mock` : la transaction passe en `success` ~3 s après `/pay` (ou `failed` si le numéro se termine par `000`) puis le job passe en `funded`.

### Messagerie
| GET | `/conversations` | — | `{items:[Conversation]}` |
| POST | `/conversations` | `{user_id, job_id?}` | `Conversation` (réutilise l'existante) |
| GET | `/conversations/:id/messages` | `?before=<iso>&limit=50` | `{items:[Message]}` (ordre chronologique) |
| POST | `/conversations/:id/messages` | `{type, body?, lat?, lng?}` | `Message` |
| POST | `/conversations/:id/read` | — | `{ok:true}` |

### Notifications
| GET | `/notifications` | `?type=job\|payment\|message\|system` | `{items:[Notification], unread_count}` |
| POST | `/notifications/read-all` | — | `{ok:true}` |
| POST | `/me/push-token` | `{token, platform}` | `{ok:true}` (FCM, optionnel) |

### Administration (`is_admin` requis)
| GET | `/admin/stats` | — | `{ users_total, users_growth_pct, providers_total, providers_growth_pct, jobs_today, jobs_growth_pct, gmv_today, revenue_today, revenue_growth_pct, gmv_month, revenue_month, active_providers, cancellation_rate, avg_basket, disputes_open }` |
| GET | `/admin/stats/timeseries` | `?days=30` | `{items:[{date:"2026-10-01", jobs, gmv, revenue, new_users}]}` |
| GET | `/admin/stats/categories` | `?days=30` | `{items:[{category_id, name, icon, jobs, gmv, revenue}]}` |
| GET | `/admin/stats/cities` | `?days=30` | `{items:[{city, jobs, gmv, revenue}]}` |
| GET | `/admin/activity` | `?limit=20` | `{items:[{type:"provider_signup"\|"category_created"\|"job_completed"\|"payment"\|"dispute", title, subtitle, avatar_url, created_at}]}` |
| GET | `/admin/users` | `?q&role=client\|provider\|admin&status&page&limit` | paginé `User` |
| PATCH | `/admin/users/:id` | `{status?, verification_level?, is_admin?}` | `User` |
| GET | `/admin/categories` | — | `{items:[Category avec children, inactives incluses]}` |
| POST | `/admin/categories` | `{name, description?, icon, color?, parent_id?, position?, is_active?}` | `Category` |
| PATCH | `/admin/categories/:id` | champs partiels | `Category` |
| DELETE | `/admin/categories/:id` | — | `{ok:true}` (refusé `CONFLICT` si des missions y sont liées → désactiver plutôt) |
| POST | `/admin/categories/reorder` | `{ids:[uuid,...]}` | `{ok:true}` |
| GET | `/admin/category-suggestions` | — | `{items:[{label, count, last_at}]}` (services saisis dans « Autre service ») |
| GET | `/admin/jobs` | `?status&q&page&limit` | paginé `Job` |
| GET | `/admin/transactions` | `?type&status&page&limit` | paginé `Transaction` (+ `user_name`) |
| GET | `/admin/disputes` | `?status=open\|resolved` | `{items:[{id, job:Job, opened_by:{id,full_name}, reason, status, resolution, created_at}]}` |
| POST | `/admin/disputes/:id/resolve` | `{resolution:"release"\|"refund", note}` | dispute |
| GET | `/admin/reviews` | paginé | `{items:[Review + target_name]}` |
| DELETE | `/admin/reviews/:id` | — | `{ok:true}` |
| GET | `/admin/settings` | — | `Settings` |
| PUT | `/admin/settings` | `Settings` partiel | `Settings` (`400` si fournisseur non configuré) |
| GET | `/admin/payment-providers` | — | `{items:[{id, name, configured, supports:{collect, payout_momo, payout_bank, balance}, fees:{collect_rate, payout_rate, bank_flat}, docs_url}]}` (`fees.*` = `null` si non publiés) |
| GET/POST/PATCH/DELETE | `/admin/promotions[/:id]` | `{code, description, discount_percent, max_uses, expires_at, is_active}` | Promotion |
| GET/POST/PATCH | `/admin/cities[/:id]` | `{name, lat, lng, is_active}` | City |

## 3. Temps réel (Socket.IO)

Connexion : `io(URL, { auth: { token } })`. Le serveur place automatiquement le socket dans la room `user:<id>`.

Client → serveur :
| Événement | Payload | Effet |
|---|---|---|
| `job:join` | `{job_id}` | rejoint `job:<id>` (client ou prestataire du job uniquement) |
| `job:leave` | `{job_id}` | |
| `conversation:join` | `{conversation_id}` | rejoint `conversation:<id>` |
| `location:update` | `{lat, lng}` | (prestataire) met à jour sa position ; diffusée en `provider:location` à toutes les rooms des jobs actifs du prestataire |
| `typing` | `{conversation_id}` | relayé aux autres membres |

Serveur → client :
| Événement | Payload |
|---|---|
| `job:new` | `Job` — envoyé aux prestataires en ligne proches ayant la compétence (ou au prestataire ciblé) |
| `job:updated` | `Job` — envoyé à `job:<id>` + `user:<client>` + `user:<provider>` |
| `provider:location` | `{job_id, provider_id, lat, lng, eta_min, distance_km}` |
| `message:new` | `Message` (+ `conversation_id`) — vers `conversation:<id>` et `user:<destinataire>` |
| `notification:new` | `Notification` |
| `typing` | `{conversation_id, user_id}` |

## 4. Comptes de démonstration

Créés par `npm run seed` dans `backend/` ; identifiants listés dans `backend/seeds/README.md` (jamais en dur dans l'app).


---

# 5. V2 — Garantie de paiement, gré à gré, appels d'offres, immobilier, trésorerie

Cette section **complète et remplace** les règles précédentes là où elles diffèrent. Tout ce qui suit est obligatoire pour backend, admin et mobile.

## 5.1 Garantie de paiement (protection contre le client malhonnête)

Principe : **aucun travail ne commence sans que l'argent soit déjà encaissé et bloqué par Tasko**. Le client ne « paie » pas à la fin : il a déjà payé ; à la fin il ne fait que **libérer** (ou contester avec preuves). Son silence vaut acceptation.

Règles de gestion :
- **RG-G1 — Séquestre préalable** : le prestataire ne peut passer en `en_route`/`arrived`/`in_progress` que si `funds_secured = true` (statut ≥ `funded`). L'app prestataire affiche « X FCFA sécurisés par Tasko — vous pouvez y aller ».
- **RG-G2 — Code de démarrage** : au passage en `funded`, le serveur génère un `start_code` à 4 chiffres visible **uniquement par le client**. Le prestataire doit le saisir pour passer en `in_progress` (preuve de présence et d'accord du client). Paramètre `require_start_code` (défaut `true`).
- **RG-G3 — Preuve de fin** : `done` accepte `{proof_photos:[url], note}` (photos obligatoires si `require_completion_proof`, défaut `false`).
- **RG-G4 — Libération automatique** : à `done`, `auto_release_at = done_at + auto_release_hours` (défaut **48 h**). Rappels au client à mi-parcours et 2 h avant. À échéance, sans litige ouvert, un planificateur serveur (toutes les minutes) libère les fonds : `status = completed`, `completed_by = "auto"`.
- **RG-G5 — Annulation encadrée** :
  - client : `requested`/`accepted` → gratuit ; `funded` → remboursement intégral ; `en_route` → remboursement moins `cancellation_fee_en_route` (défaut 1 000 FCFA, plafonné au prix) versé au prestataire (transaction `cancellation_fee`) ; `arrived`/`in_progress`/`done` → **annulation interdite**, seul le litige est possible.
  - prestataire : possible jusqu'à `in_progress` inclus → remboursement intégral du client, compteur `cancellations` du prestataire +1 (impacte son score).
- **RG-G6 — Litige** : ouvrable de `funded` à `done` (et avant `auto_release_at`). Le litige **gèle** la libération automatique. Chaque partie peut déposer des preuves (`/disputes/:id/evidence`) pendant `dispute_response_hours` (défaut 48 h). L'admin tranche : `release` (tout au prestataire), `refund` (tout au client), `split` (montant `provider_amount` au prestataire, le reste remboursé). Le chat de la mission est versé au dossier.
- **RG-G7 — Réputation du client** : le prestataire note aussi le client. Chaque Job expose `client.trust = {rating_avg, rating_count, jobs_paid, disputes_lost}` pour que le prestataire décide avant d'accepter. Un client avec `disputes_lost >= 3` est signalé à l'admin.
- **RG-G8 — Anti-contournement** : tant que `funds_secured = false`, `client.phone` et `provider.phone` valent `null` dans les réponses et les numéros de téléphone écrits dans le chat sont masqués (« 6•• •• •• •• — visible après paiement sécurisé »). Paramètre `mask_contacts_until_funded` (défaut `true`).
- **RG-G9 — Idempotence et atomicité** : toute opération financière est faite dans une transaction SQL avec verrou de ligne (`SELECT ... FOR UPDATE`) ; webhooks et planificateur idempotents (contrainte d'unicité sur la cible job/jalon + type pour `payout`, `commission`, `refund`).

## 5.2 Modes de mission : instantané, gré à gré, appel d'offres

`Job.mode` : `instant` | `direct` | `tender`.
- **`instant`** (style Yango) : diffusée aux prestataires proches ; **le premier qui accepte l'obtient**. L'acceptation est atomique (`UPDATE ... WHERE provider_id IS NULL AND status='requested'`) ; les suivants reçoivent `409 CONFLICT` « Cette mission a déjà été attribuée ». Les prestataires notifiés reçoivent `job:closed`. La mission disparaît de `/jobs/nearby`.
- **`direct`** (« J'ai déjà trouvé mon prestataire ») : `provider_id` obligatoire ; **jamais diffusée** ; seul ce prestataire peut accepter ou refuser. Le client trouve son prestataire par la recherche, par son **code Tasko** (`public_code`, ex. `TSK-7F3K9`) ou par son **numéro de téléphone** (`GET /providers/lookup`).
- **Offre du prestataire** (accord déjà conclu hors de l'app) : le prestataire crée lui-même la mission au prix convenu pour un client identifié par téléphone (`POST /jobs/offer`) → `origin = "provider_offer"`, `mode = "direct"`, `status = "accepted"`. Le client reçoit « Bika Services vous propose : … 5 000 FCFA — Payer pour confirmer ». Il paie (séquestre) ou refuse (`cancel`).
- **`tender`** (appel d'offres — entreprises, propriétaires, gros travaux) : publié avec `bid_deadline`, `visibility` (`public` = prestataires de la compétence dans la ville / `invited` = seulement `invited_provider_ids`), budget indicatif optionnel `budget_min`/`budget_max`. Les prestataires soumettent une **offre** (Bid). Le client compare (prix, délai, note, missions, jalons proposés) et **attribue** : le job passe en `accepted` avec `provider`, `price` = montant de l'offre (et ses jalons) ; les autres offres passent en `rejected` et leurs auteurs sont notifiés. Plus aucune offre n'est acceptée après attribution ou après `bid_deadline` (`409`).

### Bid
```json
{ "id": "uuid", "job_id": "uuid", "provider": ProviderCard, "amount": 450000,
  "duration_days": 10, "message": "...", "attachments": ["/uploads/devis.pdf"],
  "milestones": [ {"title": "Gros œuvre", "amount": 200000}, {"title": "Finitions", "amount": 250000} ],
  "status": "pending", "created_at": "..." }
```
`status` : `pending` | `accepted` | `rejected` | `withdrawn`. Unicité `(job_id, provider_id)` (une offre modifiable par prestataire).

## 5.3 Jalons (paiement par étapes — chantiers, gros contrats)

Un Job peut avoir des `milestones` (sinon tableau vide = paiement unique). `price = somme des milestones.amount`.

### Milestone
```json
{ "id": "uuid", "position": 1, "title": "Gros œuvre", "amount": 200000,
  "service_fee": 10000, "status": "funded", "funded_at": "...", "submitted_at": null,
  "auto_release_at": null, "released_at": null, "proof_photos": [], "note": null }
```
`status` : `pending` → `funded` (client paie ce jalon) → `submitted` (prestataire déclare terminé + preuves) → `released` (client valide ou auto 48 h) | `refunded` | `disputed`.
- Chaque jalon est **séquestré avant son exécution** (RG-G1 s'applique par jalon) ; le prestataire voit « Jalon 2/3 : 250 000 FCFA sécurisés ».
- Frais de service et commission calculés par jalon.
- Job : `funded` dès que le 1er jalon est payé ; `done` quand le dernier jalon est `submitted` ; `completed` quand tous sont `released`.

## 5.4 Comptes entreprise, immobilier, missions récurrentes, reçus

- `User.account_type` : `individual` | `business`. `User.business` : `{name, kind: "company"|"real_estate"|"ngo"|"administration"|"other", niu, rccm, address}` | null.
- **Biens immobiliers** (propriétaires, agences, syndics) — Property : `{id, name, kind: "apartment"|"house"|"building"|"land"|"commercial"|"other", address, lat, lng, units_count, notes, jobs_count, total_spent, created_at}`. Un Job peut référencer `property_id`. Historique des interventions et dépenses par bien.
- **Missions récurrentes** — RecurringJob : `{id, property_id|null, category_id, provider_id, title, description, price, frequency: "weekly"|"biweekly"|"monthly", next_run_at, is_active}`. Le planificateur crée à `next_run_at` une mission `direct` (`status = requested`) pour le prestataire attitré et notifie les deux parties ; le client paie pour la sécuriser comme d'habitude.
- **Reçu** : `GET /jobs/:id/receipt` → `{number:"TSK-2026-000123", issued_at, client:{name, business}, provider:{name, public_code}, lines:[{label, amount}], service_fee, total, payment_method, payment_ref, status}` (justificatif comptable pour entreprises). `GET /jobs/:id/receipt.html` : même contenu en HTML imprimable.

## 5.5 Portefeuilles et trésorerie (où va l'argent, comment l'admin récupère ses revenus)

Flux physique : **Client (MoMo/Orange/carte) → compte marchand Tasko chez l'agrégateur d'encaissement (`payment_provider` : NotchPay, Campay ou Monetbil) = le « coffre »** (les versements partent du compte de l'agrégateur `payout_provider`, qui peut être différent — ex. encaisser avec Monetbil et verser avec Campay : il faut alors approvisionner le compte de versement) → versement automatique au prestataire à la libération → **le reliquat (frais + commissions) est le revenu de Tasko**, que l'admin retire vers son **compte bancaire (Ecobank)** ou un **compte Mobile Money**.

Le grand livre distingue strictement (calculés à partir des transactions) :

| Poste | Signification | Appartient à |
|---|---|---|
| `escrow_held` | fonds séquestrés de missions en cours | clients/prestataires — **intouchable** |
| `providers_available` | fonds libérés dont le versement au prestataire a échoué ou est en attente | prestataires — **intouchable** |
| `revenue_total` | somme service_fee + commissions + abonnements + boosts − remises | Tasko |
| `revenue_withdrawn` | somme des retraits admin réussis | — |
| `revenue_available` | `revenue_total − revenue_withdrawn − retraits en cours` | **retirable par l'admin** |

Nouveaux types de Transaction : `cancellation_fee` (au prestataire), `partial_refund`, `withdrawal` (prestataire → son MoMo), `revenue_withdrawal` (admin → banque/MoMo).
- **Prestataire** : versement automatique sur son MoMo à chaque libération (`auto_payout`, défaut `true`) ; si l'envoi échoue, le montant reste dans son portefeuille (`available`) et il peut retirer manuellement.
- **Admin** : un retrait ne peut **jamais** dépasser `revenue_available` (contrôle serveur sous verrou). Re-saisie du mot de passe obligatoire, journal d'audit. Option de **reversement automatique** quotidien/hebdomadaire vers le compte par défaut au-delà d'un seuil.
- PayoutAccount : `{id, type: "bank"|"mtn_momo"|"orange_money", label, bank_name, account_holder, account_number_masked, phone_masked, is_default, created_at}`. Numéros complets **chiffrés au repos** (AES-256-GCM, clé `DATA_ENCRYPTION_KEY`), jamais renvoyés en clair.
- Withdrawal : `{id, amount, fee, payout_account: PayoutAccount, status: "pending"|"success"|"failed", external_ref, requested_by:{id,full_name}, created_at, completed_at, failure_reason}`. En `mock` : succès après ~3 s.

## 5.6 Objets modifiés

**Job** — champs ajoutés :
```json
{ "mode": "instant", "origin": "client", "visibility": null, "bid_deadline": null,
  "budget_min": null, "budget_max": null, "bids_count": 0, "my_bid": null,
  "funds_secured": true, "funded_at": "...", "start_code": "4821",
  "done_at": null, "auto_release_at": null, "completed_by": null,
  "completion_proof": { "photos": [], "note": null },
  "cancellation_fee": 0, "cancel_reason": null, "cancelled_by": null,
  "milestones": [], "property": {"id": "uuid", "name": "Résidence Les Palmiers"},
  "dispute": { "id": "uuid", "status": "open", "reason": "..." },
  "client": { "phone": null, "trust": {"rating_avg": 4.6, "rating_count": 9, "jobs_paid": 12, "disputes_lost": 0} },
  "provider": { "phone": null, "public_code": "TSK-7F3K9" } }
```
(`completion_proof`, `property`, `dispute` peuvent être `null`.) `start_code` n'est renvoyé qu'au client du job (null pour tous les autres). `my_bid` = l'offre du prestataire courant (tenders). `completed_by` : `client` | `auto` | `admin`. `cancelled_by` : `client` | `provider` | `admin` | `system`.

**ProviderProfile** : + `public_code`, `cancellations`, `wallet_available`.
**Settings** : + `auto_release_hours` (48), `require_start_code` (true), `require_completion_proof` (false), `cancellation_fee_en_route` (1000), `dispute_response_hours` (48), `mask_contacts_until_funded` (true), `tender_default_days` (7), `max_bids_per_tender` (30), `auto_payout` (true), `auto_settlement` (`"off"`|`"daily"`|`"weekly"`, défaut `"off"`), `auto_settlement_min` (50000), `payout_provider` (`"same"`). `/settings/public` expose aussi `auto_release_hours`, `require_start_code`, `cancellation_fee_en_route`, `pro_plan_price`, `boost_day_price`, `boost_month_price`.

## 5.7 Nouveaux endpoints

| Méthode | Route | Corps / query | Réponse |
|---|---|---|---|
| POST | `/jobs` | + `mode`, `provider_id` (obligatoire si `direct`), `bid_deadline?`, `visibility?`, `invited_provider_ids?`, `budget_min?`, `budget_max?`, `property_id?`, `milestones?:[{title, amount}]` | `Job` |
| POST | `/jobs/offer` | (prestataire) `{client_phone, category_id, title?, description, price, address?, lat?, lng?, scheduled_at?, milestones?}` | `Job` (`404` si le numéro n'a pas de compte : `error.details.can_invite = true`) |
| POST | `/invitations` | `{phone}` | `{ok:true}` (SMS d'invitation — TODO fournisseur SMS) |
| GET | `/providers/lookup` | `?code=TSK-XXXXX` ou `?phone=` | `ProviderCard` |
| POST | `/jobs/:id/status` | `in_progress` exige `{start_code}` ; `done` accepte `{proof_photos?, note?}` | `Job` |
| POST | `/jobs/:id/pay` | + `milestone_id?` (sinon prochain jalon `pending`, ou montant total si pas de jalons) | `{transaction, checkout_url}` |
| POST | `/jobs/:id/milestones/:mid/submit` | (prestataire) `{proof_photos?, note?}` | `Job` |
| POST | `/jobs/:id/milestones/:mid/release` | (client) | `Job` |
| POST | `/jobs/:id/dispute` | `{reason, photos?:[url], milestone_id?}` | `Job` |
| GET | `/disputes/:id` | (parties ou admin) | `{id, job, opened_by, reason, status, evidence:[{author:{id,full_name}, message, photos, created_at}], respond_before, resolution, provider_amount}` |
| POST | `/disputes/:id/evidence` | `{message, photos?}` | dispute |
| GET | `/tenders` | (prestataire) `?category_id&q` | `{items:[Job]}` appels d'offres ouverts accessibles |
| POST | `/jobs/:id/bids` | (prestataire) `{amount, duration_days?, message?, attachments?, milestones?}` (crée ou met à jour son offre) | `Bid` |
| GET | `/jobs/:id/bids` | client propriétaire : toutes ; prestataire : la sienne | `{items:[Bid]}` triées par score |
| DELETE | `/jobs/:id/bids/:bidId` | (auteur) retire | `{ok:true}` |
| POST | `/jobs/:id/bids/:bidId/award` | (client) | `Job` → `accepted` |
| GET | `/jobs/:id/receipt` et `/jobs/:id/receipt.html` | — | reçu |
| PUT | `/me/business` | `{name, kind, niu?, rccm?, address?}` ou `null` | `User` |
| GET/POST | `/properties` | `{name, kind, address, lat?, lng?, units_count?, notes?}` | `{items:[Property]}` / `Property` |
| GET/PATCH/DELETE | `/properties/:id` | — | `Property + {jobs:[Job], recurring:[RecurringJob]}` |
| GET/POST | `/recurring-jobs` | RecurringJob | liste / objet |
| PATCH/DELETE | `/recurring-jobs/:id` | partiel | objet / `{ok:true}` |
| GET | `/me/wallet` | (prestataire) | `{held, available, paid_out_total, pending_release:[{job_id, title, amount, auto_release_at}], items:[Transaction]}` |
| POST | `/me/wallet/withdraw` | `{amount, method, phone}` | `{transaction}` |
| GET | `/admin/treasury` | — | `{escrow_held, providers_available, revenue_total, revenue_withdrawn, revenue_pending_withdrawal, revenue_available, revenue_month, breakdown:{service_fees, commissions, subscriptions, boosts, cancellation_fees_kept}, aggregator_balance: number|null, aggregator_balances:[{provider, balance}], collect_provider, payout_provider}` (`aggregator_balance` = somme des soldes connus des fournisseurs d'encaissement et de versement) |
| GET | `/admin/treasury/ledger` | `?days=30` | `{items:[{date, escrow_in, payouts, refunds, revenue, withdrawals}]}` |
| GET/POST | `/admin/payout-accounts` | `{type, label, bank_name?, account_holder?, account_number?, phone?, is_default?}` | `{items:[PayoutAccount]}` / `PayoutAccount` |
| PATCH/DELETE | `/admin/payout-accounts/:id` | — | — |
| GET | `/admin/treasury/withdrawals` | paginé | `{items:[Withdrawal], total, page, limit}` |
| POST | `/admin/treasury/withdrawals` | `{amount, payout_account_id, password}` | `Withdrawal` (`409` si `amount + fee > revenue_available`, `401` si mot de passe faux, `400` si le fournisseur de versement ne sert pas ce type de compte — ex. « Avec Campay, le virement bancaire se fait depuis le tableau de bord Campay »). `fee` = frais du fournisseur de versement (Campay : 1 % MoMo, 5 000 FCFA par virement bancaire) |
| POST | `/admin/disputes/:id/resolve` | `{resolution: "release"|"refund"|"split", provider_amount?, note}` | dispute |
| GET | `/admin/audit-logs` | paginé | `{items:[{id, actor:{id,full_name}, action, target, details, ip, created_at}], total, page, limit}` |

`GET /admin/jobs` accepte aussi `?mode=`. `GET /admin/disputes` renvoie aussi `evidence` et `respond_before`.

## 5.8 Nouveaux événements temps réel

| Événement | Payload | Destinataires |
|---|---|---|
| `job:closed` | `{job_id, reason: "assigned"|"cancelled"|"expired"}` | prestataires ayant reçu `job:new` |
| `bid:new` | `Bid` | client du tender |
| `bid:updated` | `Bid` | auteur de l'offre (acceptée / rejetée) |
| `dispute:updated` | dispute | parties |


## 5.9 Médiation à trois (client · prestataire · Tasko) et prestataire absent

Idée du porteur de projet, retenue : **l'argent séquestré ne retourne jamais sur le Mobile Money du client par sa seule décision**. En cas de problème (prestataire absent, travail non fait ou mal fait, client qui ne valide pas), les deux parties et l'admin échangent dans un **salon de médiation à trois**, en toute transparence, avant l'échéance ; l'admin peut ensuite envoyer l'argent à l'une des parties ou le partager.

Règles :
- **RG-G10 — Pas de remboursement unilatéral** : le client ne peut jamais récupérer seul des fonds séquestrés. Un remboursement ne survient que par : (a) annulation par le prestataire, (b) annulation client autorisée par RG-G5 (avant `arrived`), (c) règle « prestataire absent » non contestée (RG-G11), (d) accord amiable accepté par les deux parties (RG-G13), (e) décision de l'admin.
- **RG-G11 — Prestataire absent (no-show)** : `arrival_deadline` = `funded_at + no_show_hours` (défaut 3 h) pour `urgency = now`, sinon `scheduled_at + no_show_grace_hours` (défaut 2 h). Si le code de démarrage n'a pas été saisi à `arrival_deadline`, le client voit « Le prestataire n'est pas venu » → ouvre un litige `kind = "no_show"` avec demande de remboursement. Le prestataire a `no_show_response_hours` (défaut 12 h) pour répondre dans le salon. **Sans réponse → remboursement automatique** du client (`resolved_by = "system"`), compteur `no_shows` du prestataire +1. S'il conteste → décision admin.
- **RG-G12 — Salon de médiation** : l'ouverture de tout litige crée une conversation `kind = "mediation"` liée au litige, dont les participants sont le client, le prestataire et l'équipe Tasko (tous les admins peuvent lire et écrire ; leurs messages sont signés « Médiateur Tasko »). Le chat normal de la mission y est rattaché en lecture. Les preuves (photos, notes) sont des messages du salon. Tous les messages sont horodatés, non modifiables et non supprimables (ils font foi). Messages système automatiques : ouverture, échéances, propositions, décision. Les numéros de téléphone y restent masqués si les fonds n'avaient pas été sécurisés.
- **RG-G13 — Accord amiable** : l'admin (ou l'une des parties) peut publier une **proposition de règlement** `{provider_amount, message}` (ex. 3 000 FCFA au prestataire, 2 000 FCFA remboursés au client). Si le client ET le prestataire l'acceptent, elle est exécutée automatiquement (comme un `split`) et le litige est clos `resolved_by = "agreement"`. Une nouvelle proposition annule la précédente.
- **RG-G14 — Échéances et décision** : pendant un litige, la libération automatique est gelée. `decision_due_at = opened_at + dispute_decision_hours` (défaut 72 h) ; l'admin est alerté à l'ouverture et 12 h avant l'échéance. L'admin décide `release` / `refund` / `split` avec **motif obligatoire** publié dans le salon ; au-delà de `four_eyes_threshold` (défaut 100 000 FCFA), la décision d'un admin doit être confirmée par un second admin (`pending_confirmation`).
- **RG-G15 — Conséquences** : le perdant d'un litige voit son compteur augmenter (`disputes_lost` client, `disputes_lost` / `no_shows` prestataire) ; au seuil configurable (`suspension_threshold`, défaut 3), l'admin reçoit une alerte de suspension.

Objets :
- **Dispute** : `{id, job, kind: "quality"|"no_show"|"not_validated"|"other", milestone_id, opened_by:{id, full_name, role}, reason, status: "open"|"pending_confirmation"|"resolved", conversation_id, respond_before, decision_due_at, proposals:[Proposal], resolution: "release"|"refund"|"split"|null, provider_amount, resolved_by: "admin"|"agreement"|"system"|null, resolution_note, decided_by, confirmed_by, created_at, resolved_at}`.
- **Proposal** : `{id, author:{id, full_name, role}, provider_amount, client_refund, message, client_accepted: bool|null, provider_accepted: bool|null, status: "pending"|"accepted"|"rejected"|"superseded", created_at}`.
- **Conversation** : + `kind: "direct"|"mediation"`, `dispute_id`, `participants:[{id, full_name, avatar_url, role: "client"|"provider"|"admin"}]`. **Message** : + `sender_role`, `type` accepte aussi `system` et `proposal` (`body` = id de la proposition).
- **Job** : + `arrival_deadline`, `can_report_no_show: bool` (calculé pour le client).
- **Settings** : + `no_show_hours` (3), `no_show_grace_hours` (2), `no_show_response_hours` (12), `dispute_decision_hours` (72), `four_eyes_threshold` (100000), `suspension_threshold` (3).

Endpoints :

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/jobs/:id/no-show` | (client) `{message?}` — autorisé si `can_report_no_show` | `Job` (litige `no_show` ouvert) |
| POST | `/jobs/:id/dispute` | + `kind` | `Job` |
| GET | `/disputes/:id` | parties ou admin | `Dispute` |
| GET | `/disputes/:id/messages` | parties ou admin | `{items:[Message]}` |
| POST | `/disputes/:id/messages` | `{type:"text"|"image", body}` | `Message` (remplace `/disputes/:id/evidence`, conservé comme alias) |
| POST | `/disputes/:id/proposals` | `{provider_amount, message}` (`0 <= provider_amount <= montant séquestré concerné`) | `Proposal` |
| POST | `/disputes/:id/proposals/:pid/accept` · `/reject` | (client ou prestataire) | `Dispute` |
| POST | `/admin/disputes/:id/resolve` | `{resolution, provider_amount?, note}` (note obligatoire) | `Dispute` (`pending_confirmation` si au-delà du seuil) |
| POST | `/admin/disputes/:id/confirm` | (second admin, différent du décideur) | `Dispute` |
| GET | `/admin/disputes` | `?status=open|pending_confirmation|resolved&kind=` | liste avec `decision_due_at`, triée par urgence |

Temps réel : les messages du salon passent par `message:new` (room `conversation:<id>`, les admins peuvent la rejoindre) ; `dispute:updated` à chaque proposition, acceptation, décision.
