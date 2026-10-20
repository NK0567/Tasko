# Tasko — Modèle économique

## « Ce que gagne le propriétaire »

![Tasko — maquette](maquettes/tasko-16-ecrans.webp)

> ### ⚠️ Avertissement de lecture
> Tous les chiffres de ce document sont des **simulations construites à partir d'hypothèses explicites**, pas des prévisions ni des résultats constatés. Ils servent à comprendre **comment** Tasko gagne de l'argent, **quels leviers** comptent et **à partir de quel volume** l'activité devient rentable. Chaque hypothèse (taux, frais Mobile Money, coûts) est **paramétrable** et doit être remplacée par des valeurs réelles dès qu'elles sont connues (contrat avec l'agrégateur de paiement, premiers mois d'exploitation).
>
> Conventions : montants en **FCFA (XAF)**, entiers ; 1 mois = 30 jours ; 1 an = 365 jours (52 semaines pour les calculs hebdomadaires) ; les taxes (TVA, impôt sur les sociétés) ne sont **pas** intégrées aux résultats et doivent être validées avec un expert-comptable.

---

## Sommaire

1. [Le principe : un péage sur chaque transaction réussie](#1-le-principe--un-péage-sur-chaque-transaction-réussie)
2. [Les sources de revenus](#2-les-sources-de-revenus)
3. [Unit economics d'un job de 5 000 FCFA](#3-unit-economics-dun-job-de-5-000-fcfa)
4. [Scénarios de volume (100 à 5 000 jobs/jour)](#4-scénarios-de-volume-100-à-5-000-jobsjour)
5. [Scénario consolidé sur 3 ans](#5-scénario-consolidé-sur-3-ans)
6. [Structure des coûts](#6-structure-des-coûts)
7. [Point mort](#7-point-mort)
8. [Ce que le propriétaire possède réellement — et la valorisation](#8-ce-que-le-propriétaire-possède-réellement--et-la-valorisation)
9. [Risques et conditions de succès](#9-risques-et-conditions-de-succès)
10. [Leviers de croissance](#10-leviers-de-croissance)
11. [V2 — Entreprises, immobilier, annulations, encaissement réel et anti-contournement](#11-v2--entreprises-immobilier-annulations-encaissement-réel-et-anti-contournement)
12. [Conclusion](#12-conclusion)

---

## 1. Le principe : un péage sur chaque transaction réussie

Tasko ne vend pas d'application : il **prélève une petite part de la valeur qui circule** entre clients et prestataires — uniquement **quand un job est réalisé et validé**.

```
           Client                         Tasko                       Prestataire
   paie prix + frais de service    garde frais + commission       reçoit prix − commission
        5 000 + 250 = 5 250  ───▶   250 (+ commission éventuelle) ───▶   5 000
```

Formules (identiques au [contrat d'API](05-contrat-api.md#tarification)) :

| Grandeur | Formule | Valeur par défaut |
|---|---|---|
| Frais de service client | `service_fee = max(min_service_fee, round(price × client_fee_rate))` | `client_fee_rate = 5 %`, `min_service_fee = 100 FCFA` |
| Commission prestataire | `provider_commission = round(price × provider_commission_rate)` | `0 %` au lancement |
| Total payé par le client | `total = price + service_fee` | |
| Versé au prestataire | `provider_payout = price − provider_commission` | |
| **Revenu brut Tasko par job** | **`service_fee + provider_commission`** | |

Tous ces paramètres sont **modifiables par l'administrateur** (back-office → Paramètres), sans redéploiement.

Vocabulaire :
- **GMV** (*Gross Merchandise Value*) : valeur totale des prestations réalisées (somme des `price`).
- **Take rate** : part du GMV que Tasko conserve = (frais + commission) / GMV.
- **Revenu net de paiement** : revenu brut − frais facturés par l'agrégateur / les opérateurs Mobile Money.

---

## 2. Les sources de revenus

| # | Source | Mécanisme | Exemple chiffré | Phase |
|---|---|---|---|---|
| 1 | **Frais de service client** | % ajouté au prix, payé par le client | Job 5 000 FCFA → client paie 5 250 FCFA → **250 FCFA** pour Tasko | MVP |
| 2 | **Commission prestataire** | % retenu sur le versement au prestataire (0 % au lancement pour attirer l'offre, puis 5–10 % une fois la valeur prouvée ; réduite pour les membres Pro) | Commission 5 % sur 5 000 FCFA → **250 FCFA** de plus | V1 |
| 3 | **Abonnement Tasko Pro** | 2 000 à 5 000 FCFA/mois (3 000 FCFA par défaut) : badge Pro, meilleur classement, commission réduite, statistiques, portfolio étendu | 300 prestataires Pro × 3 000 FCFA = **900 000 FCFA/mois** | MVP (paiement) / V1 (avantages complets) |
| 4 | **Boost / mise en avant** | Prestataire placé en tête des résultats de sa zone | 500 FCFA/jour ou 5 000 FCFA/mois ; 100 boosts mensuels = **500 000 FCFA/mois** | MVP |
| 5 | **Tasko Business (B2B)** | Abonnement entreprise : multi-utilisateurs, facturation mensuelle, prestataires attitrés, SLA | Ex. 25 000 FCFA/mois × 20 entreprises = **500 000 FCFA/mois** (+ frais sur leurs jobs) | V2 |
| 5 bis | **Missions B2B / immobilier** (appels d'offres, jalons, missions récurrentes) — V2 | Frais de service 5 % (+ commission) sur des paniers plus gros et **récurrents** ; le compte Business (reçus, appels d'offres, jalons) est d'abord gratuit, l'abonnement ci-dessus restant une option | Appel d'offres attribué 450 000 FCFA → **22 500 FCFA** de frais ; ménage hebdomadaire 10 000 FCFA → 500 FCFA × 52 = **26 000 FCFA/an** par logement | V2 |
| 6 | **Frais de déplacement** | Forfait ou supplément au km, payé par le client ; Tasko peut prélever sa commission dessus | Déplacement 1 000 FCFA → frais 5 % = 50 FCFA | V1 |
| 7 | **Services premium** | Urgence garantie (« en moins de 30 min »), vérification express d'identité, garantie / assurance mission, mise en relation assistée | Supplément urgence 500 FCFA | V2 |
| 8 | **Partenariats & données agrégées** *(long terme)* | Partenariats avec fournisseurs de matériel, formations, microfinance ; études de demande **anonymisées et agrégées**, dans le respect de la loi sur les données personnelles | À définir | Expansion |

> 🎯 **Take rate cible** : ~5 % au lancement (frais client seuls), puis **8 à 12 %** en régime de croisière (frais client + commission prestataire modulée), ce qui reste dans la fourchette habituelle des marketplaces de services.

---

## 3. Unit economics d'un job de 5 000 FCFA

### 3.1 Hypothèses de frais de paiement (à remplacer par le contrat réel)

| Paramètre | Hypothèse de travail | Plage étudiée | Commentaire |
|---|---|---|---|
| Frais d'**encaissement** (client → Tasko via agrégateur) | **2 %** du montant encaissé | 1,5 % – 3 % | Dépend de l'agrégateur (NotchPay retenu ; Campay, Monetbil en alternative), de l'opérateur et du volume négocié |
| Frais de **décaissement** (Tasko → Mobile Money prestataire) | **1 %** du montant versé | 0 % – 1,5 % | Certains agrégateurs facturent le *payout*, d'autres non ; à vérifier |
| Frais sur abonnements / boosts | 2 % | 1,5 % – 3 % | Mêmes canaux d'encaissement |

### 3.2 Décomposition d'un job (lancement : frais client 5 %, commission prestataire 0 %)

| Ligne | Calcul | Montant |
|---|---|---|
| Prix de la prestation | | 5 000 FCFA |
| Frais de service client (5 %) | 5 000 × 5 % | 250 FCFA |
| **Encaissé auprès du client** | 5 000 + 250 | **5 250 FCFA** |
| Versé au prestataire | 5 000 − 0 | 5 000 FCFA |
| **Revenu brut Tasko** | 250 + 0 | **250 FCFA** |
| Frais d'encaissement (2 %) | 5 250 × 2 % | − 105 FCFA |
| Frais de décaissement (1 %) | 5 000 × 1 % | − 50 FCFA |
| **Marge nette de paiement par job** | 250 − 105 − 50 | **≈ 95 FCFA** (1,9 % du GMV) |

### 3.3 Sensibilité aux frais de paiement

| Frais d'encaissement | Avec décaissement 1 % | Sans frais de décaissement |
|---|---|---|
| 1,5 % (−79) | **121 FCFA** | 171 FCFA |
| 2 % (−105) | **95 FCFA** | 145 FCFA |
| 3 % (−158) | **42 FCFA** | 92 FCFA |

### 3.4 Même job en régime de croisière (frais client 5 % + commission prestataire 5 %)

| Ligne | Calcul | Montant |
|---|---|---|
| Encaissé auprès du client | 5 000 + 250 | 5 250 FCFA |
| Versé au prestataire | 5 000 − 250 | 4 750 FCFA |
| **Revenu brut Tasko** | 250 + 250 | **500 FCFA** (take rate 10 %) |
| Frais d'encaissement (2 %) | 5 250 × 2 % | − 105 FCFA |
| Frais de décaissement (1 %) | 4 750 × 1 % | − 47,5 FCFA |
| **Marge nette de paiement par job** | | **≈ 348 FCFA** (≈ 7 % du GMV) |

> 💡 **Enseignement clé n° 1** : à 5 % de frais client seuls, les frais Mobile Money absorbent **plus de la moitié** du revenu brut. Le modèle 5 % est un **modèle d'amorçage** (attirer prestataires et clients) ; la rentabilité passe par **(a)** une commission prestataire progressive, **(b)** la négociation des frais de paiement avec le volume, **(c)** l'augmentation du panier moyen et **(d)** les revenus récurrents (Pro, Boost, Business), qui ne dépendent pas du volume de jobs.
>
> 💡 **Enseignement clé n° 2** : le plancher `min_service_fee = 100 FCFA` protège les petits jobs : un job de 1 500 FCFA rapporte 100 FCFA (et non 75), ce qui couvre au moins les frais de paiement.

---

## 4. Scénarios de volume (100 à 5 000 jobs/jour)

Hypothèses : panier moyen **5 000 FCFA**, frais de paiement 2 % (encaissement) + 1 % (décaissement).

### 4.1 Volume d'affaires (GMV)

| Jobs / jour | GMV / jour | GMV / mois | GMV / an |
|---|---|---|---|
| 100 | 500 000 FCFA | 15 000 000 FCFA | 182 500 000 FCFA |
| 500 | 2 500 000 FCFA | 75 000 000 FCFA | 912 500 000 FCFA |
| 1 000 | 5 000 000 FCFA | 150 000 000 FCFA | 1 825 000 000 FCFA |
| 2 000 | 10 000 000 FCFA | 300 000 000 FCFA | 3 650 000 000 FCFA |
| 5 000 | 25 000 000 FCFA | 750 000 000 FCFA | 9 125 000 000 FCFA |

### 4.2 Modèle de lancement — take rate 5 % (frais client seuls)

| Jobs / jour | CA brut / jour | CA brut / mois | CA brut / an | **Net de paiement / mois** | **Net de paiement / an** |
|---|---|---|---|---|---|
| 100 | 25 000 FCFA | 750 000 FCFA | 9 125 000 FCFA | 285 000 FCFA | 3 467 500 FCFA |
| 500 | 125 000 FCFA | 3 750 000 FCFA | 45 625 000 FCFA | 1 425 000 FCFA | 17 337 500 FCFA |
| 1 000 | 250 000 FCFA | 7 500 000 FCFA | 91 250 000 FCFA | 2 850 000 FCFA | 34 675 000 FCFA |
| 2 000 | 500 000 FCFA | 15 000 000 FCFA | 182 500 000 FCFA | 5 700 000 FCFA | 69 350 000 FCFA |
| 5 000 | 1 250 000 FCFA | 37 500 000 FCFA | 456 250 000 FCFA | 14 250 000 FCFA | 173 375 000 FCFA |

### 4.3 Modèle de croisière — take rate 10 % (5 % client + 5 % prestataire)

| Jobs / jour | CA brut / jour | CA brut / mois | CA brut / an | **Net de paiement / mois** | **Net de paiement / an** |
|---|---|---|---|---|---|
| 100 | 50 000 FCFA | 1 500 000 FCFA | 18 250 000 FCFA | 1 042 500 FCFA | 12 683 750 FCFA |
| 500 | 250 000 FCFA | 7 500 000 FCFA | 91 250 000 FCFA | 5 212 500 FCFA | 63 418 750 FCFA |
| 1 000 | 500 000 FCFA | 15 000 000 FCFA | 182 500 000 FCFA | 10 425 000 FCFA | 126 837 500 FCFA |
| 2 000 | 1 000 000 FCFA | 30 000 000 FCFA | 365 000 000 FCFA | 20 850 000 FCFA | 253 675 000 FCFA |
| 5 000 | 2 500 000 FCFA | 75 000 000 FCFA | 912 500 000 FCFA | 52 125 000 FCFA | 634 187 500 FCFA |

> Le « net de paiement » n'est **pas** un bénéfice : il reste à couvrir l'équipe, le marketing, l'hébergement, le support, etc. (voir [§ 6](#6-structure-des-coûts) et [§ 7](#7-point-mort)). Ces tableaux n'incluent pas non plus les abonnements Pro et les boosts.

```
CA brut mensuel (millions FCFA) — panier 5 000 FCFA
                  take rate 5 %        take rate 10 %
  100 jobs/j   ▏0,75                 ▏1,5
  500 jobs/j   ███ 3,75              ██████ 7,5
1 000 jobs/j   ██████ 7,5            ████████████ 15
2 000 jobs/j   ████████████ 15       ████████████████████████ 30
5 000 jobs/j   ██████████████████████████████ 37,5   (×2 = 75 en take rate 10 %)
```

---

## 5. Scénario consolidé sur 3 ans

### 5.1 Hypothèses

| Hypothèse | Prudent A1 / A2 / A3 | Médian A1 / A2 / A3 | Ambitieux A1 / A2 / A3 |
|---|---|---|---|
| Prestataires **actifs** (moyenne de l'année) | 150 / 400 / 900 | 300 / 1 000 / 2 500 | 600 / 2 500 / 6 000 |
| Jobs par prestataire actif et par semaine | 2 / 2,5 / 3 | 3 / 3,5 / 4 | 4 / 4,5 / 5 |
| Panier moyen | 5 000 / 5 500 / 6 000 FCFA | 5 000 / 6 000 / 6 500 FCFA | 5 500 / 6 500 / 7 000 FCFA |
| Take rate (frais + commission) | 5 % / 7 % / 8 % | 5 % / 8 % / 10 % | 6 % / 10 % / 10 % |
| % de prestataires actifs abonnés Pro (3 000 FCFA/mois) | 5 % / 8 % / 10 % | 8 % / 10 % / 12 % | 10 % / 12 % / 15 % |
| Recettes Boost par mois | 20 000 / 80 000 / 200 000 FCFA | 50 000 / 250 000 / 750 000 FCFA | 100 000 / 800 000 / 2 000 000 FCFA |
| Entreprises Tasko Business (25 000 FCFA/mois) | 0 / 0 / 5 | 0 / 5 / 20 | 0 / 20 / 60 |
| Frais de paiement | ≈ 3,1 % du GMV + 2 % des abonnements/boosts | idem | idem |
| Coûts d'exploitation annuels (voir § 6) | 18 / 30 / 45 M FCFA | 30 / 60 / 160 M FCFA | 60 / 220 / 450 M FCFA |

Lecture côté **demande** : 1 425 jobs/jour (médian A3) correspondent par exemple à ~40 000 clients actifs faisant en moyenne un peu plus d'un job par mois — un ordre de grandeur cohérent avec deux métropoles de plusieurs millions d'habitants, mais qui **suppose une forte notoriété** et devra être confirmé par les données des premiers mois (fréquence client réelle).

### 5.2 Résultats (millions de FCFA, arrondis)

| Indicateur | Prudent A1 | A2 | A3 | Médian A1 | A2 | A3 | Ambitieux A1 | A2 | A3 |
|---|---|---|---|---|---|---|---|---|---|
| Jobs / jour (moyenne) | 43 | 142 | 385 | 128 | 499 | 1 425 | 342 | 1 603 | 4 274 |
| Jobs / an | 15 600 | 52 000 | 140 400 | 46 800 | 182 000 | 520 000 | 124 800 | 585 000 | 1 560 000 |
| **GMV** | 78,0 | 286,0 | 842,4 | 234,0 | 1 092,0 | 3 380,0 | 686,4 | 3 802,5 | 10 920,0 |
| Frais + commissions | 3,9 | 20,0 | 67,4 | 11,7 | 87,4 | 338,0 | 41,2 | 380,3 | 1 092,0 |
| Abonnements Pro | 0,3 | 1,2 | 3,2 | 0,9 | 3,6 | 10,8 | 2,2 | 10,8 | 32,4 |
| Boosts | 0,2 | 1,0 | 2,4 | 0,6 | 3,0 | 9,0 | 1,2 | 9,6 | 24,0 |
| Tasko Business | 0 | 0 | 1,5 | 0 | 1,5 | 6,0 | 0 | 6,0 | 18,0 |
| **CA brut Tasko** | **4,4** | **22,1** | **74,5** | **13,2** | **95,5** | **363,8** | **44,5** | **406,7** | **1 166,4** |
| Frais de paiement | −2,4 | −8,9 | −26,3 | −7,3 | −34,0 | −105,3 | −21,3 | −118,4 | −340,0 |
| **Net de paiement** | 2,0 | 13,2 | 48,3 | 5,9 | 61,4 | 258,5 | 23,2 | 288,2 | 826,4 |
| Coûts d'exploitation | −18,0 | −30,0 | −45,0 | −30,0 | −60,0 | −160,0 | −60,0 | −220,0 | −450,0 |
| **Résultat avant impôts** | **−16,0** | **−16,8** | **+3,3** | **−24,1** | **+1,4** | **+98,5** | **−36,8** | **+68,2** | **+376,4** |

### 5.3 Lecture

- **Prudent** : la plateforme atteint à peine l'équilibre en année 3 ; besoin de financement cumulé d'environ **33 M FCFA**. C'est le scénario d'un lancement « à petits moyens », porté en grande partie par les fondateurs.
- **Médian** : pertes la 1re année (~24 M FCFA), équilibre en année 2, rentabilité nette en année 3 (~1 400 jobs/jour). C'est le scénario de référence pour un plan d'affaires.
- **Ambitieux** : suppose un financement initial significatif (marketing, équipe) et une adoption rapide dans plusieurs villes ; les montants de l'année 3 dépendent fortement de l'exécution et de la concurrence.
- Dans **tous** les scénarios, la **première année est déficitaire** : c'est normal pour une marketplace, qui doit d'abord construire la densité des deux côtés.
- Le passage d'un take rate de 5 % à 8–10 % est le **levier le plus puissant** du modèle ; il doit être introduit progressivement, accompagné d'avantages concrets pour les prestataires (flux de clients, garantie de paiement, Pro avec commission réduite).

---

## 6. Structure des coûts

> Fourchettes **indicatives**, à titre d'hypothèses de travail pour Yaoundé/Douala ; à affiner par des devis réels.

| Poste | Fourchette mensuelle (hypothèse) | Commentaire |
|---|---|---|
| **Hébergement / cloud** (VPS, base de données, stockage, sauvegardes) | 30 000 – 150 000 FCFA (MVP) ; 300 000 – 1 000 000 FCFA à grande échelle | Démarrage sur un VPS unique dockerisé, puis montée en charge |
| **SMS OTP** | Quelques dizaines de FCFA par SMS (tarif à négocier avec un fournisseur local ou international) ; 20 000 – 200 000 FCFA/mois selon les inscriptions | Réduire via OTP WhatsApp, appels flash ou réutilisation de session |
| **Cartographie** | 0 – 100 000 FCFA | OpenStreetMap (tuiles gratuites sous conditions d'usage raisonnable, ou fournisseur de tuiles / auto-hébergement à l'échelle) |
| **Notifications push** | ≈ 0 | Firebase Cloud Messaging |
| **Support client** (1 à 4 agents) | 150 000 – 800 000 FCFA | Support WhatsApp/téléphone, gestion des litiges, KYC |
| **Équipe** (fondateurs, développeurs, ops, commercial terrain) | 1 000 000 – 6 000 000 FCFA (selon taille et phase) | Poste principal |
| **Marketing & acquisition** | 300 000 – 5 000 000 FCFA | Terrain, ambassadeurs, parrainage, réseaux sociaux, radio locale |
| **Juridique, comptabilité, assurance** | 100 000 – 500 000 FCFA (moyenné) | Statuts, CGU/CGV, conformité paiement, données personnelles, expert-comptable |
| **Taxes et impôts** | Selon régime fiscal | TVA, impôt sur les sociétés, patente… **à valider avec un professionnel** |
| **Frais de paiement** | Variables (≈ 3 % du GMV, cf. § 3) | Coût variable, déjà déduit dans le « net de paiement » |

Ordres de grandeur des coûts fixes mensuels retenus pour le point mort :

| Configuration | Coûts fixes / mois |
|---|---|
| **Lean** (2–3 personnes, marketing terrain minimal) | ~1 500 000 FCFA |
| **Standard** (5–7 personnes, une ville bien couverte) | ~2 500 000 FCFA |
| **Croissance** (10+ personnes, 2 villes, marketing soutenu) | ~5 000 000 FCFA et plus |

---

## 7. Point mort

`Jobs nécessaires / mois = coûts fixes mensuels ÷ marge nette de paiement par job` (hors Pro/Boost/Business, qui réduisent ce seuil).

| Coûts fixes / mois | Take rate 5 % (≈ 95 FCFA/job) | Take rate 10 % (≈ 348 FCFA/job) | Take rate 10 %, panier 6 500 FCFA (≈ 452 FCFA/job) |
|---|---|---|---|
| 1 500 000 FCFA | 15 790 jobs/mois ≈ **526 jobs/jour** | 4 317 jobs/mois ≈ **144 jobs/jour** | 3 321 jobs/mois ≈ **111 jobs/jour** |
| 2 500 000 FCFA | 26 316 jobs/mois ≈ **877 jobs/jour** | 7 195 jobs/mois ≈ **240 jobs/jour** | 5 535 jobs/mois ≈ **185 jobs/jour** |
| 5 000 000 FCFA | 52 632 jobs/mois ≈ **1 754 jobs/jour** | 14 389 jobs/mois ≈ **480 jobs/jour** | 11 069 jobs/mois ≈ **369 jobs/jour** |

Effet des revenus récurrents : 300 abonnés Pro (900 000 FCFA/mois) + 100 boosts mensuels (500 000 FCFA/mois) couvrent à eux seuls **plus de la moitié** d'une structure « standard ».

> 🎯 **Ordre de grandeur à retenir** : avec une équipe standard, Tasko est à l'équilibre autour de **200 à 250 jobs/jour** dans un modèle à ~10 % de take rate, contre **près de 900 jobs/jour** si l'on reste à 5 % de frais client seuls.

---

## 8. Ce que le propriétaire possède réellement — et la valorisation

### 8.1 Les actifs

| Actif | Pourquoi il a de la valeur |
|---|---|
| **Le réseau de prestataires vérifiés** | Long et coûteux à constituer (terrain, KYC, formation) ; c'est l'offre que les concurrents devront reconstruire |
| **La base clients** | Utilisateurs ayant déjà payé via l'app, avec historique et moyens de paiement |
| **L'effet réseau local** | Plus il y a de prestataires dans un quartier, plus le service est rapide → plus de clients → plus de prestataires. Cet avantage est **local et cumulatif** |
| **La réputation accumulée** | Avis et historiques non transférables : un prestataire avec 200 missions notées 4,8 ne repart pas de zéro ailleurs |
| **Les données** | Demande par zone/heure/catégorie, prix pratiqués, temps de réponse : base des futurs services IA et d'un avantage d'exécution |
| **L'infrastructure transactionnelle** | Séquestre, intégration Mobile Money, gestion des litiges, back-office : briques réutilisables pour d'autres verticales et d'autres pays |
| **La marque** | « Tasko » comme réflexe verbal (« Tasko-le ! ») |
| **Le code et la propriété intellectuelle** | Application, API, back-office, algorithmes de matching |

### 8.2 Comment une marketplace est valorisée (principes, sans promesse de chiffres)

- Les investisseurs regardent d'abord le **GMV** et sa **croissance**, puis le **revenu net** (take rate × GMV) et sa **qualité** : récurrence, rétention des clients (cohortes), part des jobs « organiques » (sans marketing payé), marge de contribution par job.
- La valorisation s'exprime souvent comme un **multiple du revenu net** (ou, plus rarement, une fraction du GMV). Ce multiple **varie fortement** selon la croissance, la rentabilité, la taille du marché adressable, le niveau de risque du pays et le stade de maturité ; il n'existe pas de « bon » multiple universel.
- Les signaux qui augmentent la valorisation : **liquidité** (taux de demandes satisfaites, temps de mise en relation court), **rétention** élevée, **faible désintermédiation**, **CAC maîtrisé** vs **LTV**, **multi-villes** démontré, **conformité** (paiement, données) solide.
- À un stade précoce, la valeur réside davantage dans **la preuve de traction** (croissance mensuelle du GMV, cohortes) que dans le chiffre d'affaires absolu.

---

## 9. Risques et conditions de succès

| Risque | Description | Parades |
|---|---|---|
| **Désintermédiation** (contournement) | Après un premier contact, client et prestataire échangent leurs numéros et traitent en direct, hors commission | **Séquestre** (le client est protégé seulement via l'app) ; **garantie / litiges** ; la **réputation** ne se construit que sur des jobs payés via Tasko (classement, niveau 5 « Recommandé ») ; **avantages Pro** et boosts ; frais faibles (5 %) qui rendent le contournement peu intéressant ; **V2 : masquage des numéros (profil et chat) tant que le paiement n'est pas sécurisé** (RG-G8) ; modes « direct » et « offre du prestataire » pour faire passer les accords déjà conclus par Tasko (voir [§ 11](#11-v2--entreprises-immobilier-annulations-encaissement-réel-et-anti-contournement)) ; programmes de fidélité et parrainage |
| **Densité insuffisante** (« œuf et poule ») | Trop peu de prestataires → clients déçus → départ | Lancement **quartier par quartier** et **catégorie par catégorie** ; recrutement terrain des 200 premiers prestataires avant ouverture publique ; commission prestataire à 0 % au lancement |
| **Confiance / sécurité** | Incident grave (vol, agression, travail bâclé) | KYC niveau 3 obligatoire pour certaines catégories (domicile, enfants), notation croisée, bouton d'alerte, support réactif, assurance à étudier |
| **Réglementation des paiements** | Encaisser et **détenir des fonds pour compte de tiers** (séquestre) est une activité réglementée dans la zone CEMAC | Opérer le séquestre **par ou avec un partenaire agréé** (agrégateur disposant des autorisations, établissement de paiement ou banque) ; ne pas se présenter comme établissement de paiement ; faire valider le schéma de flux par un juriste spécialisé (réglementation **COBAC / BEAC** sur les services de paiement et la monnaie électronique) |
| **Statut juridique & fiscalité** | Forme de la société, TVA sur les frais de service, retenues éventuelles, statut des prestataires (indépendants et non salariés) | Accompagnement par un avocat d'affaires et un expert-comptable **avant** la mise en production ; CGU claires sur l'indépendance des prestataires |
| **Données personnelles** | Collecte de pièces d'identité, géolocalisation, téléphones | Minimisation, chiffrement, consentement explicite, politique de confidentialité, conformité au cadre camerounais applicable **à vérifier** avec un juriste |
| **Coût des frais de paiement** | Peut absorber la majorité du revenu à 5 % | Négociation volume, choix de l'agrégateur, plancher de frais, take rate progressif |
| **Concurrence** | Arrivée d'un acteur financé ou d'une super-app | Vitesse d'exécution, densité locale, inclusion des débrouillards, relation terrain, catalogue dynamique |
| **Qualité de service hétérogène** | Prestataires peu fiables | Niveaux de vérification, désactivation automatique sous un seuil de note, formation, badges |

**Conditions de succès** : (1) densité locale de prestataires fiables, (2) temps de mise en relation court (< 15 min en urgence), (3) zéro incident de paiement, (4) support humain réactif, (5) conformité juridique dès le départ, (6) discipline sur le coût d'acquisition.

---

## 10. Leviers de croissance

1. **Take rate progressif** : commission prestataire 0 % → 5 % → modulée selon Pro / volume.
2. **Panier moyen** : catégories à plus forte valeur (chantier, événementiel, B2B), frais de déplacement, devis multi-tâches.
3. **Fréquence** : services récurrents (ménage hebdomadaire, répétiteur, coiffure), abonnements client.
4. **Revenus récurrents** : Tasko Pro, Boost, Tasko Business.
5. **Géographie** : Yaoundé/Douala → Bafoussam, Limbe, Kribi → autres villes → pays de la CEMAC (même monnaie, logique de paiement proche).
6. **Coût de paiement** : renégociation à volume, multi-agrégateurs, portefeuille interne (avec partenaire agréé) pour réduire les décaissements.
7. **IA** : meilleur matching = plus de conversions ; prévision de la demande = prestataires au bon endroit au bon moment ; détection de fraude = moins de pertes.
8. **Services financiers partenaires** (long terme) : avances, micro-épargne, assurance pour prestataires, adossées à leur historique de revenus — uniquement via des partenaires agréés.

---

## 11. V2 — Entreprises, immobilier, annulations, encaissement réel et anti-contournement

> Référence : [08 — Confiance, paiement et trésorerie](08-confiance-paiement-et-tresorerie.md). Montants illustratifs, hypothèses à confirmer.

### 11.1 Revenus B2B et immobiliers

| Levier | Mécanisme | Exemple illustratif |
|---|---|---|
| **Appels d'offres** | Frais de service (et commission éventuelle) sur le montant attribué ; paniers bien supérieurs au job moyen de 5 000 FCFA | Rénovation attribuée 450 000 FCFA → 22 500 FCFA de frais client (5 %) ; avec 5 % de commission prestataire → 45 000 FCFA |
| **Jalons** | Frais calculés **par jalon** : Tasko encaisse au fil du chantier, pas seulement à la fin ; moins de risque pour les deux parties → plus de gros contrats via l'app | 200 000 + 250 000 FCFA → 10 000 + 12 500 FCFA de frais |
| **Missions récurrentes** | Ménage, jardinage, maintenance créés automatiquement chaque semaine / mois : **revenu prévisible** et rétention forte | Une agence avec 20 logements, ménage hebdomadaire à 10 000 FCFA → 20 × 500 × 52 ≈ **520 000 FCFA/an** de frais |
| **Abonnement entreprise (éventuel)** | Plus tard : multi-utilisateurs, facturation mensuelle consolidée, tableau de bord dépenses, SLA, frais réduits | 25 000 FCFA/mois (hypothèse du § 2) |
| **Reçus et comptes Business** | Gratuits : ce sont des **arguments de vente** (les entreprises ont besoin de justificatifs), pas des revenus | — |

### 11.2 Frais d'annulation

| Cas (RG-G5) | Effet financier |
|---|---|
| Annulation client avant paiement | Aucun flux. |
| Annulation client après paiement, prestataire pas parti | Remboursement intégral : Tasko **perd** les frais d'encaissement (≈ 2 %) déjà payés à l'agrégateur, sauf si la politique de remboursement prévoit de conserver une partie des frais de service (à décider et à écrire dans les CGU). |
| Annulation client pendant « en route » | 1 000 FCFA (paramètre) **versés au prestataire** (`cancellation_fee`) ; le reste remboursé. Ce n'est **pas** un revenu Tasko, mais cela fidélise les prestataires. |
| Annulation par le prestataire | Remboursement intégral du client ; coût pour Tasko = frais de paiement perdus ; le prestataire est pénalisé dans son classement. |

> À surveiller : le poste `cancellation_fees_kept` de la trésorerie et le coût des remboursements. Un taux d'annulation après paiement élevé ronge la marge.

### 11.3 Comment le propriétaire encaisse réellement

L'argent ne va **pas** directement sur le MoMo ou le compte Ecobank du propriétaire :

1. Les clients paient sur le **compte marchand de Tasko chez NotchPay** (le « coffre »).
2. Les prestataires sont payés depuis ce coffre ; les remboursements aussi.
3. Ce qui reste (frais, commissions, Pro, boosts) est le **revenu disponible**, calculé par le grand livre de l'app.
4. L'admin le **retire** depuis la page Trésorerie vers le **compte Ecobank professionnel de la société** (gros montants) ou un compte MoMo (petits montants), ou programme un **reversement automatique**.

Coûts à intégrer : frais d'encaissement (≈ 2 % selon la page tarifs NotchPay, à confirmer), frais de transfert vers Mobile Money (≈ 1 %), frais éventuels de reversement bancaire (**à vérifier auprès de NotchPay**), et **TVA** sur les frais de service (taux généralement cité à 19,25 % au Cameroun — à confirmer avec un expert-comptable). Détails : [08 § 6](08-confiance-paiement-et-tresorerie.md#6-question-4--comment-le-propriétaire-de-tasko-récupère-ses-revenus).

### 11.4 Impact de l'anti-contournement

| Mesure V2 | Effet attendu sur le modèle |
|---|---|
| Numéros masqués avant paiement (profil + chat) | Moins de jobs « sortis » de l'app après le premier contact → protège le take rate. |
| Mode **direct** et **offre du prestataire** | Les accords conclus hors de l'app reviennent dans Tasko (le prestataire y gagne la garantie de paiement et la réputation) → **GMV supplémentaire** qui aurait été perdu. |
| Garantie de paiement (séquestre préalable, libération auto) | C'est la **raison** de rester dans l'app ; plus elle est forte, plus le contournement coûte cher au prestataire (risque d'impayé). |
| Réputation construite uniquement sur des missions payées | Un prestataire qui contourne ne monte pas en classement. |

Limite honnête : un client fidèle et son prestataire habituel pourront toujours se payer en cash. L'objectif n'est pas de l'empêcher totalement mais de rendre **Tasko plus avantageux** (garantie, reçu, réputation, missions récurrentes automatiques) que le contournement.

---

## 12. Conclusion

| En une phrase | |
|---|---|
| **Comment Tasko gagne** | Une petite part (5 % au lancement, 8–10 % à terme) de chaque job réussi, plus des abonnements et de la visibilité payante. |
| **Ce qu'il faut atteindre** | Quelques centaines de jobs par jour dans une ville, avec un take rate proche de 10 %, pour couvrir une équipe standard. |
| **Ce qu'on construit vraiment** | Un réseau de confiance — prestataires vérifiés, clients fidèles, données et infrastructure de paiement — difficile à copier. |
| **Ce qu'il faut sécuriser d'abord** | Le partenaire de paiement agréé, le cadre juridique et la densité de prestataires au lancement. |

> ### **Tasko gagne de l'argent quand ses utilisateurs en gagnent.**
> Chaque franc prélevé correspond à une mission réalisée, un client satisfait et un prestataire payé. L'intérêt du propriétaire est donc parfaitement aligné avec celui de la communauté : **plus Tasko crée de revenus pour les prestataires, plus Tasko vaut.**
