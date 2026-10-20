# assets/images

Dossier réservé aux **vraies photos** (bannières, photos de prestataires de démonstration, visuels marketing).

Aujourd'hui l'application n'utilise que des illustrations vectorielles locales (`assets/illustrations/*.svg`)
et des avatars par initiales colorées : aucune URL externe n'est nécessaire.

## Ajouter des photos plus tard

1. Déposez les fichiers ici (formats recommandés : `.webp` ou `.jpg`, largeur max 1080 px, < 200 Ko) :
   - `home_banner.webp` — bannière « Trouvez des prestataires fiables » de l'accueil (ratio ~ 2.4:1) ;
   - `splash_city.webp` — photo de ville (Yaoundé / Douala) pour l'écran de démarrage ;
   - `onboarding_1.webp` … `onboarding_4.webp` — photos des pages d'onboarding (ratio ~ 1:1).
2. Le dossier est déjà déclaré dans `pubspec.yaml` (`assets/images/`), aucun changement n'est requis.
3. Remplacez l'`SvgPicture.asset(...)` correspondant par `Image.asset('assets/images/xxx.webp', fit: BoxFit.cover)`
   (voir `lib/widgets/illustrations.dart`, qui centralise les chemins).

Les photos des prestataires réels proviennent de l'API (`avatar_url`, `portfolio[].image_url`) et sont servies sous
`/uploads/...` par le backend : ne les mettez pas ici.

Utilisez uniquement des images dont vous détenez les droits (photos maison, banques libres de droits avec licence adaptée).
