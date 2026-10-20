# Tasko — Admin web (back-office)

Back-office du propriétaire de **Tasko** : pilotage de la marketplace (KPI, revenus), utilisateurs et prestataires, catégories dynamiques, missions, transactions Mobile Money en séquestre, litiges/avis, codes promo et paramètres de la plateforme.

Contrat d'API de référence : [`../docs/05-contrat-api.md`](../docs/05-contrat-api.md) (section *Administration*).

## Stack

Vite 5 · React 18 · TypeScript (strict) · react-router 6 · @tanstack/react-query 5 · recharts · lucide-react · police **Material Symbols Rounded** (icônes de catégories) · Inter / Poppins (Google Fonts). Styles : CSS global à base de tokens (`src/styles/global.css`) + CSS Modules (`*.module.css`).

## Démarrage

```bash
cd admin
npm install
npm run dev        # http://localhost:5180
```

L'API Tasko doit tourner sur `http://localhost:4300` (dossier `backend/`). Le serveur de dev Vite fait proxy de `/api`, `/uploads` et `/socket.io` vers cette adresse : aucun souci de CORS.

Connexion : téléphone + mot de passe d'un compte **administrateur** (`is_admin = true`). Les comptes de démonstration sont créés par `npm run seed` dans `backend/` et documentés dans `backend/seeds/README.md` (ils ne sont jamais écrits dans le code de l'admin).

## Scripts

| Script | Rôle |
|---|---|
| `npm run dev` | Serveur de développement (port **5180**, strict) |
| `npm run build` | Vérification TypeScript (`tsc -b`) puis build de production dans `dist/` |
| `npm run preview` | Sert le build de production sur le port 5180 |
| `npm run lint` | ESLint (typescript-eslint, règles React Hooks) |
| `npm run typecheck` | Vérification TypeScript seule |

## Configuration

| Variable | Défaut | Usage |
|---|---|---|
| `TASKO_API_URL` (env du shell, lue par `vite.config.ts`) | `http://localhost:4300` | Cible du proxy de dev |
| `VITE_API_BASE` (fichier `.env.local`) | `/api/v1` | Base des appels API côté navigateur. En production, servir l'admin derrière le même domaine que l'API, ou mettre l'URL absolue (`https://api.exemple.cm/api/v1`) — l'API doit alors autoriser l'origine (CORS). |

## Fonctionnement

- **Client API typé** : `src/api/types.ts` reprend les objets du contrat (V1 + V2 §5, champs V2 optionnels pour tolérer un backend partiellement migré) ; `src/api/admin.ts` expose un appel par endpoint. Seul le JWT est stocké dans `localStorage` (accès protégé par try/catch) — aucune autre donnée (mot de passe de retrait, numéros de compte…) n'est persistée côté navigateur. Toute réponse **401** déconnecte et renvoie vers `/connexion`, **sauf** le retrait de revenus où un 401 signifie « mot de passe incorrect » (message dans le formulaire). Si le serveur est injoignable au démarrage, la session est conservée et un bouton « Réessayer » est proposé.
- **Connexion** refusée si le compte n'est pas administrateur (au login et à la revalidation via `GET /me`).
- **Temps réel** : `socket.io-client` (`src/lib/socket.ts`), via le proxy Vite `/socket.io`. Le salon de médiation rejoint la room `conversation:<id>` et écoute `message:new` / `dispute:updated` ; à défaut de socket, l'historique reste disponible (badge « Hors ligne »). `VITE_SOCKET_URL` permet de viser une autre origine en production.
- Rafraîchissement automatique (react-query `refetchInterval`) : 30 s en général, 4–5 s tant qu'un retrait est en cours.
- **Catégories** : aucune catégorie codée en dur — tout vient de `GET /admin/categories`.
- Montants affichés partout via `formatMoney` : entiers FCFA avec espaces insécables (`1 248 500 FCFA`). Saisie tolérante via `parseAmount` (`1 248 500`, `1.248.500`).

## Pages

Menu groupé : **Pilotage** (Tableau de bord, Trésorerie) · **Opérations** (Missions, Médiation, Transactions) · **Catalogue** (Catégories, Promotions) · **Utilisateurs** (Utilisateurs, Prestataires) · **Système** (Paramètres, Journal d'audit).

| Route | Page |
|---|---|
| `/connexion` | Connexion |
| `/` | Tableau de bord : bandeau **« À faire maintenant »** (litiges urgents, décisions à confirmer, versements prestataires en échec, revenus à retirer), tuiles « Revenus disponibles » et « Paiements en attente de libération », KPI, tendance 30 j, catégories, villes, activité, simulateur |
| `/tresorerie` | **Trésorerie** : revenus disponibles (à vous) vs argent bloqué des clients et dus aux prestataires (intouchables), retraits, origine des revenus, schéma du flux d'argent, mouvements 30 j (`/admin/treasury/ledger`, vue graphique ou tableau), comptes de versement (banque / MTN MoMo / Orange Money, numéros masqués), **retrait** (montant ≤ disponible, « Tout retirer », re-saisie du mot de passe, récapitulatif, gestion du 409), historique, reversement automatique |
| `/missions` | Missions : filtres mode (instantané / gré à gré / appel d'offres) et statut, jalons, libération automatique, `completed_by`, preuves, offres reçues (tenders). Le code de démarrage n'est **jamais** affiché. Filtre initial par URL : `?statut=done`, `?mode=tender` |
| `/mediation` | **Médiation** (§5.9) : onglets À traiter / À confirmer / Clos / Avis, filtre par type (travail contesté, prestataire absent, client ne valide pas), tri par échéance de décision, dossier complet avec **salon à trois en temps réel** (messages signés « Médiateur Tasko », photos, messages système et propositions), proposition d'accord, décision payer / rembourser / partager (curseur + aperçu) avec motif obligatoire, double validation au-delà du seuil (un admin ne confirme pas sa propre décision). `/avis-litiges` redirige ici |
| `/transactions` | Transactions (filtres type/statut, aussi via `?type=payout&status=failed`) |
| `/categories` | Catégories & sous-services + services suggérés |
| `/promotions` | Codes promo |
| `/utilisateurs` | Utilisateurs : type de compte (particulier / entreprise + nom), réputation client (note, jobs payés, litiges perdus, badge d'alerte ≥ 3), suspension, vérification (avec confirmation), droits admin |
| `/prestataires` | Prestataires (note, missions, plan Pro, en ligne, incidents dans la fiche) |
| `/parametres` | Paramètres : tarification, sécurité des paiements (libération auto, code de démarrage, preuve photo, frais d'annulation en route, délai de réponse aux litiges, masquage des contacts, appels d'offres, versement auto des prestataires), médiation & prestataire absent (§5.9), villes. Récapitulatif avant / après et confirmation à l'enregistrement |
| `/journal` | Journal d'audit (`/admin/audit-logs`) |

## Principes UX

1. **Une action principale par page**, en haut à droite (ex. « Retirer mes revenus »). Les actions financières ou destructrices sont **rouges** et passent toujours par un **récapitulatif + confirmation** (retrait, décision de litige, confirmation à quatre yeux, suppression, modification des paramètres).
2. **Langage simple** : « argent bloqué des clients » plutôt que « séquestre/escrow », « versements aux prestataires » plutôt que « payouts », « paiements clients » plutôt que « GMV ». Chaque indicateur de la Trésorerie et chaque réglage a une infobulle **« ? »** (survol, clic ou clavier).
3. **Le tableau de bord commence par « À faire maintenant »** avec des liens directs vers l'écran où agir.
4. **Couleurs de statut cohérentes** : vert = tout va bien, orange = action requise / en attente, rouge = problème, gris = terminé. Bleu et violet ne servent qu'à identifier (modes, rôles, types).
5. **États explicites** : squelettes de chargement, états vides qui expliquent quoi faire, erreurs avec bouton « Réessayer », toasts de succès après chaque action.
6. **Montants FCFA identiques partout** (`formatMoney`).
7. **Navigation groupée** par usage (voir ci-dessus) ; badge rouge = litiges urgents (< 12 h de l'échéance), jaune = dossiers en attente.
8. **Accessibilité** : focus visible (contour jaune), libellés de formulaire reliés (`htmlFor`, `aria-describedby`, `aria-invalid`), contrastes AA des badges, cibles ≥ 40 px, lignes de tableau activables au clavier (Entrée/Espace), modales avec piège à focus et retour du focus, Échap ferme la fenêtre du dessus uniquement.

Mise en page responsive : sous 900 px la barre latérale devient un tiroir (bouton menu) ; à 375 px aucune page ne défile horizontalement (les tableaux défilent dans leur cadre).
