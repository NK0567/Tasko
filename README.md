# Tasko

**La marketplace des services, compétences et petits jobs du quotidien** — *« le Yango des petits jobs »*.

Tasko met en relation, en temps réel et par géolocalisation, des clients qui ont besoin d'un service (plomberie, coiffure, ménage, répétition, informatique, chantier…) avec des prestataires proches, notés et vérifiés. Le client suit l'arrivée du prestataire, paie par Mobile Money (fonds en **séquestre**), valide la mission ; le prestataire est alors payé et Tasko prélève sa commission.

Lancement prévu : **Yaoundé** et **Douala** (Cameroun).

![Maquette des 16 écrans de Tasko](docs/maquettes/tasko-16-ecrans.webp)

---

## Structure du dépôt

```
tsako/
├── backend/   API Node.js / Express + PostgreSQL + Socket.IO (port 4300)
├── admin/     Back-office d'administration React (port 5180)
├── mobile/    Application Flutter (Android, iOS, Web) — client + Mode Prestataire
└── docs/      Dossier projet, business et technique
    └── maquettes/tasko-16-ecrans.webp
```

## Documentation

| # | Document | Contenu |
|---|---|---|
| 01 | [Description du projet](docs/01-description-projet.md) | Pitch, problématique, solution, catégories, confiance, concurrence, les 16 écrans |
| 02 | [Modèle économique](docs/02-modele-economique.md) | Ce que gagne le propriétaire : revenus, unit economics, scénarios, coûts, point mort, risques |
| 03 | [Cahier des charges](docs/03-cahier-des-charges.md) | Acteurs, exigences fonctionnelles (EF) et non fonctionnelles, règles de gestion (RG), MoSCoW |
| 04 | [Architecture et données](docs/04-architecture-et-donnees.md) | Architecture, séquestre, machine à états, modèle de données, matching, sécurité, déploiement, IA |
| 05 | [Contrat d'API](docs/05-contrat-api.md) | Source de vérité partagée backend / admin / mobile |
| 06 | [Parcours utilisateurs](docs/06-parcours-utilisateurs.md) | Client, étudiant, tresseuse, entreprise, administrateur |
| 07 | [Roadmap et lancement](docs/07-roadmap-et-lancement.md) | Feuille de route, go-to-market, KPIs, checklist de mise en production |
| 08 | [Confiance, paiement et trésorerie](docs/08-confiance-paiement-et-tresorerie.md) | V2 : garantie de paiement du prestataire (client malhonnête), modes de mission (accord déjà conclu, appel d'offres), entreprises et immobilier, comment le propriétaire récupère ses revenus (coffre NotchPay → Ecobank / MoMo) |

> **V2** : paiement obligatoire avant le travail avec code de démarrage et libération automatique après 48 h, litiges arbitrés sur preuves, modes instantané / gré à gré / appel d'offres, jalons, comptes Business et biens immobiliers, missions récurrentes, reçus, portefeuilles et trésorerie admin — spécifiés dans le [contrat d'API § 5](docs/05-contrat-api.md) et expliqués dans le [doc 08](docs/08-confiance-paiement-et-tresorerie.md).

## Démarrage rapide

Prérequis : Docker, Node.js (LTS), Flutter SDK.

```bash
# 1. Base de données (PostgreSQL)
docker compose up -d

# 2. API — http://localhost:4300/api/v1
cd backend
npm install
npm run migrate
npm run seed
npm run dev

# 3. Back-office admin — http://localhost:5180
cd admin
npm install
npm run dev

# 4. Application mobile (dans le navigateur)
cd mobile
flutter pub get
flutter run -d chrome
```

- Émulateur Android : l'API est joignable via `http://10.0.2.2:4300/api/v1`.
- Le paiement fonctionne par défaut avec un **simulateur** (`payment_provider = mock`) : un paiement est confirmé en ~3 s ; un numéro se terminant par `000` simule un échec.
- En développement, le code OTP est renvoyé par l'API (`otp_dev_mode`).
- **Comptes de démonstration** : voir [`backend/seeds/README.md`](backend/seeds/README.md).

## Stack

Flutter · Node.js / Express · PostgreSQL · Socket.IO · OpenStreetMap · NotchPay (Mobile Money) · React · Docker
