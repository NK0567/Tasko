# Tasko — application mobile (Flutter)

« La marketplace des services, compétences et petits jobs du quotidien » — le *Yango des petits jobs* au Cameroun.
Une seule app : mode **Client** et mode **Prestataire** (interrupteur dans le menu).

- Flutter 3.44 / Dart 3.12 — Android, iOS, Web
- API : contrat dans `../docs/05-contrat-api.md` (REST `/api/v1` + Socket.IO), **section 5 (V2)** comprise, serveur sur le **port 4300**

## Lancer

```bash
cd mobile
flutter pub get

# Web (API par défaut : http://localhost:4300)
flutter run -d chrome

# Émulateur Android (API par défaut : http://10.0.2.2:4300)
flutter run -d emulator-5554

# Simulateur iOS (API par défaut : http://localhost:4300)
flutter run -d ios

# Téléphone réel / autre serveur : préciser l'URL de l'API
flutter run --dart-define=API_URL=http://192.168.1.20:4300
```

`API_URL` accepte l'origine (`http://hote:4300`) ou l'URL complète (`.../api/v1`). Socket.IO et les fichiers
`/uploads/...` utilisent la même origine.

Build : `flutter build web` · `flutter build apk --dart-define=API_URL=https://api.exemple.cm`
(la version web compilée peut être servie par n'importe quel serveur statique, ex. `npx http-server build/web -p 5190`).

Tests et analyse : `flutter analyze` · `flutter test`

Comptes de démonstration : voir `../backend/seeds/README.md` (jamais codés dans l'app).
En mode dev, l'API renvoie `dev_code` pour l'OTP : il est prérempli à l'inscription.

## Principes UX

Public visé : clients pressés **et** artisans / débrouillards peu à l'aise avec le numérique, sur Android d'entrée de
gamme en 3G. Règles appliquées à tous les écrans :

1. **Une action principale par écran**, gros bouton vert en bas (zone du pouce, `BottomActionBar`), libellé verbe + objet
   (« Payer 5 250 FCFA », « Je suis arrivé », « Valider et libérer le paiement »). Actions secondaires en texte /
   contour ; actions dangereuses en rouge **avec confirmation** (`confirmAction`, `showCancelSheet`).
2. **Divulgation progressive** : demande simple = mode → service → besoin → lieu/quand → budget, sur un seul écran.
   Bien immobilier et paiement par étapes sont repliés sous « Options avancées » (dépliées d'office pour les comptes
   entreprise) ; les champs d'appel d'offres n'apparaissent que si ce mode est choisi.
3. **Zéro jargon** : jamais « séquestre », « escrow », « payout », « milestone », « tender » dans l'interface →
   « argent bloqué en sécurité chez Tasko », « paiement versé », « étape », « appel d'offres (plusieurs devis) ».
   Chaque statut a un libellé humain + une carte **« Et maintenant ? »** (`NextStepCard`, `JobStatus.nextStep`).
4. **Icône + texte** pour toute action ; **couleurs de statut** uniques (`StatusColors`) : vert = OK / payé,
   orange = en attente / action requise, rouge = problème, gris = terminé / annulé.
5. **Frise de progression** sur toute mission (`JobProgressBar` : Payé → En route → Sur place → En cours → Terminé →
   Versé) + prochaine échéance (« Libération dans 47 h 05 min »).
6. **Montants explicites et identiques partout** (`AmountSummary` : « Vous payez 5 250 FCFA dont 250 FCFA de frais
   Tasko ; le prestataire reçoit 5 000 FCFA »), récapitulatif avant toute action financière.
7. **Retour immédiat** : bouton en chargement et désactivé (anti double-tap), snackbar de succès, erreurs en français
   avec « Réessayer » ; squelettes de chargement (`SkeletonList`) au lieu d'écrans blancs.
8. **Premiers pas** : bulles d'aide fermables et mémorisées (`TipBanner`, une par rôle) ; états vides avec un bouton
   (« Aucune mission — Demander un service »).
9. **Accessibilité** : cibles ≥ 48 dp, corps de texte 15–16 sp, `Semantics` / `tooltip` sur les icônes-boutons,
   échelle de police système respectée.
10. **Formulaires** : clavier numérique (téléphone, montant, code), préremplissage (ville, position, MoMo),
    validation en direct sous le champ, montants avec séparateur de milliers pendant la saisie (`AmountField`).
11. **Réseau lent / coupé** : bandeau « Pas de connexion — vos données se mettront à jour automatiquement »
    (`OfflineBanner`), la saisie en cours n'est jamais perdue, resynchronisation automatique à la reconnexion.

Aucun emoji dans l'interface (rendu en carrés vides sur le web) : icônes Material ou éléments dessinés
(`CameroonFlag`) ; les textes serveur (notifications, messages système) sont nettoyés par `stripEmoji`.

## Permissions

- Android : `INTERNET`, `ACCESS_FINE_LOCATION`/`COARSE`, `usesCleartextTraffic="true"` (HTTP en dev — à retirer en prod), `<queries>` pour `tel:`/`https`.
- iOS : `NSLocationWhenInUseUsageDescription` (français), photos/caméra, `NSAllowsLocalNetworking`.
- Localisation refusée ou indisponible → position par défaut : ville choisie, sinon Yaoundé (3.8480, 11.5021).

## Structure

```
lib/
  main.dart                 ProviderScope, locale fr, MaterialApp.router
  core/
    config.dart             API_URL (dart-define) + défauts web/Android, tuiles OSM
    theme.dart              Couleurs (#0F7A3D, #0B3D2E, #F5B700), StatusColors, Poppins, cartes 16 px
    api_client.dart         Dio + intercepteur JWT + ApiException (format d'erreur du contrat)
    tasko_api.dart          Toutes les routes du contrat (V1 + V2), typées
    socket_service.dart     Socket.IO singleton, reconnexion, ré-adhésion aux rooms (compteur de références),
                            flux `reconnected` (resynchronisation) et `offline` (bandeau)
    location_service.dart   geolocator + repli Yaoundé, interpolation (simulation)
    providers.dart          Riverpod : auth, catégories, villes, position, onglet, paramètres publics
    router.dart             go_router + redirection selon la session
    formatters.dart         « 5 000 FCFA », distances, compte à rebours, « 17/10 à 14:30 », stripEmoji
    icon_map.dart           Clés d'icônes du contrat → Material Icons (+ repli), couleurs hex
  models/                   User (+ business), ProviderProfile (+ public_code), ProviderCard, Category, City,
                            Job (+ V2 : mode, garantie, jalons, preuve, litige, bien, no-show), Bid, Milestone,
                            Dispute / Proposal (médiation), Property, RecurringJob, Wallet, Receipt,
                            PublicSettings, Transaction, Review, Conversation, Message, Notification
    job_rules.dart          Règles métier testées : annulation (RG-G5), litige (RG-G6), départ (RG-G1),
                            bouton « prestataire absent » (RG-G11)
  widgets/                  TaskoButton, cartes, états chargement / erreur / vide,
    guarantee.dart          Bandeau « X FCFA sécurisés », carte code de démarrage, compte à rebours,
                            réputation client, règles d'annulation, photos de preuve, bouton Appeler masqué
    start_code_field.dart   Saisie PIN 4 chiffres
    milestones.dart         Frise et éditeur d'étapes de paiement
    provider_picker.dart    Recherche prestataire par nom / code Tasko / téléphone
    ux.dart                 Frise de progression, « Et maintenant ? », AmountSummary, AmountField,
                            TipBanner, OfflineBanner, BottomActionBar, squelettes, confirmAction
    cameroon_flag.dart      Drapeau dessiné (remplace l'emoji)
  features/
    auth/                   Splash, onboarding, inscription (OTP), connexion
    home/                   Coquille (nav + bouton +), accueil client, catégories
    explore/                Carte / liste des prestataires, filtres
    provider_profile/       Détail prestataire / service, avis
    chat/                   Conversations, chat temps réel
    jobs/                   Création (3 modes), attente, suivi, validation, détail, Mes jobs, proposition reçue,
                            étapes de paiement, reçu, feuilles (code, preuves, annulation)
    disputes/               Signalement d'un problème, salon de médiation à trois
    tenders/                Appels d'offres (liste, détail + devis prestataire, devis reçus + comparateur client)
    properties/             Mes biens, ajout / modification, détail, missions récurrentes
    payment/                Paiement sécurisé (MoMo / Orange Money / carte, polling, par étape)
    notifications/          Notifications par onglets, temps réel, ouverture selon le rôle
    menu/                   Tiroir, À propos, paramètres, aide (FAQ V2), paiements, avis, favoris
    profile/                Mon profil, code Tasko, compte entreprise
    provider_mode/          Onboarding, compétences, tableau de bord, mission, portefeuille,
                            proposer une mission, Pro & Boost (tarifs de /settings/public)
```

## Écrans

| Écran | Route |
|---|---|
| Démarrage · Onboarding · Inscription · Connexion | `/`, `/onboarding`, `/register`, `/login` |
| Accueil client / tableau de bord prestataire (coquille) | `/home` |
| Carte des prestataires · catégorie | `/explore`, `/categories/:id` |
| Profil prestataire | `/provider/:id` |
| Chat | `/chat/:id` |
| Nouvelle demande (3 modes : premier disponible / mon prestataire / appel d'offres) | `/jobs/new?mode=&provider_id=&property_id=` |
| Attente d'acceptation | `/jobs/:id/waiting` |
| Proposition d'un prestataire (« Payer pour confirmer / Refuser ») | `/jobs/:id/proposal` |
| Paiement sécurisé (total ou étape) | `/jobs/:id/pay?milestone_id=` |
| Suivi client : code de démarrage, règles d'annulation, prestataire absent | `/jobs/:id/track` |
| Vérification : preuves, compte à rebours, valider / signaler | `/jobs/:id/done` |
| Étapes de paiement | `/jobs/:id/milestones` |
| Devis reçus + comparateur + attribution (client) | `/jobs/:id/tender` |
| Reçu + partage | `/jobs/:id/receipt` |
| Signaler un problème | `/jobs/:id/dispute` |
| Salon de médiation (client · prestataire · Médiateur Tasko) | `/disputes/:id` |
| Détail de mission | `/jobs/:id` |
| Appels d'offres (prestataire) · détail + devis | `/tenders`, `/tenders/:id` |
| Mission prestataire : garantie, code, preuves | `/provider-mode/mission/:id` |
| Portefeuille prestataire | `/provider-mode/wallet` |
| Proposer une mission à un client | `/provider-mode/propose` |
| Compte entreprise | `/business` |
| Mes biens · ajout · détail · modification | `/properties`, `/properties/new`, `/properties/:id`, `/properties/:id/edit` |
| Notifications · menus | `/notifications`, `/about`, `/settings`, `/help`, `/payments`, `/my-reviews`, `/favorites` |

## Garantie de paiement (V2)

- **Prestataire** : bouton « Je pars chez le client » désactivé tant que la mission n'est pas payée
  (« En attente du paiement sécurisé du client ») ; dès `funded`, bandeau vert « 5 000 FCFA sécurisés par Tasko — vous
  serez payé à la fin » ; démarrage avec le **code à 4 chiffres** du client ; fin avec **photos de preuve** + note ;
  puis « Paiement libéré automatiquement le JJ/MM à HH:MM si le client ne réagit pas ».
- **Client** : carte « Votre code de démarrage » à donner à l'arrivée ; écran de vérification avec preuves, compte à
  rebours et « Valider et libérer le paiement » / « Signaler un problème » ; règles d'annulation affichées selon le
  statut ; « Le prestataire doit arriver avant HH:MM » puis bouton « Le prestataire n'est pas venu ».
- **Litige** : salon de médiation à trois en temps réel (rôles distincts, messages système centrés, photos,
  échéances, propositions d'accord Accepter / Refuser avec l'état de chaque partie, décision finale + motif).
- **Réputation du client** visible avant d'accepter ; **contacts masqués** avant paiement (bouton Appeler grisé avec
  explication).

## Temps réel

`job:new` (pop-up), `job:closed` (la pop-up se ferme : « Mission déjà attribuée »), `job:updated`, `provider:location`,
`message:new` / `typing`, `notification:new`, `bid:new` / `bid:updated` (devis), `dispute:updated` (salon).
Après une reconnexion, chaque écran recharge son état (mission, devis, salon, chat, listes).
Côté prestataire, la position est émise via `location:update` toutes les 5 s (GPS) ; sur le web ou sans GPS,
un déplacement vers le client est **simulé** pour la démo.

## Limites connues

- « Autre service » : catégorie de slug `autre` + `other_label`.
- Appel d'offres : `budget` est envoyé égal au budget max (ou min) quand il est renseigné, sinon omis (le contrat
  marque `budget` obligatoire pour `POST /jobs` mais le budget d'un appel d'offres est optionnel).
- Pièces jointes des devis : photos uniquement (sélecteur d'images), envoyées via `POST /uploads`.
- Partage du reçu / du code Tasko via WhatsApp, SMS, e-mail ou copie (pas de feuille de partage native, aucune
  dépendance ajoutée) ; `receipt.html` nécessite le jeton et n'est pas ouvert depuis l'app.
- Notifications push (FCM) non branchées : le temps réel passe par Socket.IO.
