// Données de référence pour le seed de démonstration Tasko.

export const CITIES = [
  { name: 'Yaoundé', lat: 3.848, lng: 11.5021, is_active: true },
  { name: 'Douala', lat: 4.0511, lng: 9.7679, is_active: true },
  { name: 'Bafoussam', lat: 5.4781, lng: 10.4176, is_active: true },
  { name: 'Limbe', lat: 4.0186, lng: 9.2043, is_active: true },
  { name: 'Kribi', lat: 2.9395, lng: 9.9087, is_active: true },
  { name: 'Garoua', lat: 9.3017, lng: 13.3921, is_active: false },
  { name: 'Bamenda', lat: 5.9631, lng: 10.1591, is_active: false },
];

/** [nom, icône, couleur, description, sous-services [nom, icône]] */
export const CATEGORIES = [
  ['Bâtiment & Chantier', 'construction', '#F57C00', 'Travaux, réparations et aide sur chantier', [
    ['Maçonnerie', 'construction'], ['Peinture', 'format_paint'], ['Carrelage', 'build'], ['Plomberie', 'plumbing'],
    ['Électricité', 'electrical_services'], ['Soudure', 'build'], ['Menuiserie', 'handyman'], ['Aide sur chantier', 'handyman'],
  ]],
  ['Maison & Maintenance', 'home_repair_service', '#1E88E5', 'Entretien de la maison et petites réparations', [
    ['Ménage', 'cleaning_services'], ['Lessive', 'local_laundry_service'], ['Repassage', 'local_laundry_service'], ['Jardinage', 'yard'],
    ['Montage de meubles', 'chair'], ['Réparation électroménager', 'build'], ['Climatisation', 'ac_unit'],
  ]],
  ['Beauté & Bien-être', 'spa', '#E91E63', 'Coiffure, tresses, ongles et soins à domicile', [
    ['Coiffure', 'content_cut'], ['Tresses', 'face'], ['Barber', 'content_cut'], ['Maquillage', 'brush'], ['Manucure', 'spa'],
    ['Pédicure', 'spa'], ["Pose d'ongles", 'brush'], ['Soins du visage', 'face'], ['Massage', 'spa'],
  ]],
  ['Informatique & Digital', 'computer', '#3949AB', 'Dépannage, téléphones, CV et création numérique', [
    ['Dépannage PC', 'computer'], ['Installation Windows / logiciels', 'computer'], ['Réparation téléphone', 'phone_android'],
    ['Création de CV', 'description'], ['Saisie', 'description'], ['Impression', 'print'], ['Design graphique', 'design_services'],
    ['Montage vidéo', 'videocam'],
  ]],
  ['Études & Éducation', 'school', '#8E24AA', 'Répétiteurs, aide aux devoirs et travaux académiques', [
    ['Répétiteur', 'school'], ['Aide aux devoirs', 'child_care'], ['Préparation aux examens', 'school'], ['Traduction', 'translate'],
    ['Mise en forme de mémoires', 'description'], ['Recherches documentaires', 'description'],
  ]],
  ['Logistique & Manutention', 'local_shipping', '#6D4C41', 'Déménagement, chargement et rangement', [
    ['Aide au déménagement', 'moving'], ['Chargement / déchargement', 'local_shipping'], ['Rangement', 'chair'],
  ]],
  ['Courses & Livraison', 'shopping_basket', '#43A047', 'Marché, courses et livraisons rapides', [
    ['Faire le marché', 'shopping_basket'], ['Petites courses', 'shopping_basket'], ['Livraison de colis', 'local_shipping'],
    ['Récupération de documents', 'description'],
  ]],
  ['Automobile', 'directions_car', '#546E7A', 'Lavage, nettoyage et petite mécanique', [
    ['Lavage', 'directions_car'], ['Nettoyage intérieur', 'cleaning_services'], ['Petite mécanique', 'build'], ['Assistance', 'directions_car'],
  ]],
  ['Mode & Couture', 'checkroom', '#D81B60', 'Couture sur mesure et retouches', [['Couture', 'checkroom'], ['Retouches', 'checkroom']]],
  ['Événementiel', 'celebration', '#FB8C00', 'Décoration, service, cuisine, photo et animation', [
    ['Décoration', 'celebration'], ['Serveurs', 'restaurant'], ['Cuisine', 'restaurant'], ['Photographie', 'photo_camera'],
    ['DJ / animation', 'music_note'],
  ]],
  ['Jardinage & Extérieur', 'yard', '#2E7D32', 'Débroussaillage et entretien de terrains', [
    ['Débroussaillage', 'agriculture'], ['Entretien de terrain', 'yard'],
  ]],
  ["Main-d'œuvre ponctuelle", 'handyman', '#795548', 'Bras disponibles pour vos besoins ponctuels', [
    ['Aide agricole', 'agriculture'], ['Installation', 'build'], ['Manutention', 'moving'],
  ]],
  ['Aide quotidienne', 'volunteer_activism', '#00897B', 'Accompagnement et petits services du quotidien', [
    ['Accompagnement', 'volunteer_activism'], ["Récupération d'objets", 'key'], ['Petits services divers', 'more_horiz'],
  ]],
];

export const OTHER_CATEGORY = ['Autre service', 'more_horiz', '#9E9E9E', "Vous ne trouvez pas votre besoin ? Décrivez-le, on s'en occupe."];

/** [nom, headline, provider_type, ville (Y|D), compétences [[service, prix]], vérification, années, options] */
export const PROVIDERS = [
  ['Moussa Kamga', 'Étudiant / Informaticien', 'student', 'Y', [['Dépannage PC', 3000], ['Installation Windows / logiciels', 2500], ['Création de CV', 2000], ['Saisie', 1500]], 3, 2, {}],
  ['Bika Services', 'Plombier', 'artisan', 'Y', [['Plomberie', 5000], ['Réparation électroménager', 7000]], 4, 9, { pro: true }],
  ['Aïcha Bello', 'Coiffeuse à domicile', 'freelancer', 'Y', [['Coiffure', 4000], ['Tresses', 6000]], 3, 6, { featured: true }],
  ['Clarisse Ngo Mbarga', 'Tresseuse', 'artisan', 'Y', [['Tresses', 5000], ['Coiffure', 3500]], 2, 4, {}],
  ['Nadège Fouda', 'Manucure & pédicure', 'freelancer', 'Y', [['Manucure', 2500], ['Pédicure', 3000], ["Pose d'ongles", 5000]], 3, 3, {}],
  ['Jean-Pierre Essomba', 'Maçon', 'artisan', 'Y', [['Maçonnerie', 15000], ['Carrelage', 12000], ['Aide sur chantier', 5000]], 4, 15, {}],
  ['Serge Atangana', 'Électricien bâtiment', 'artisan', 'Y', [['Électricité', 6000], ['Climatisation', 10000]], 4, 11, { pro: true }],
  ['Brice Owona', 'Étudiant répétiteur maths-physique', 'student', 'Y', [['Répétiteur', 5000], ['Préparation aux examens', 7000], ['Aide aux devoirs', 3000]], 3, 3, {}],
  ['Lydie Mvogo', 'Répétitrice & traductrice', 'student', 'Y', [['Répétiteur', 4000], ['Traduction', 5000], ['Mise en forme de mémoires', 8000]], 2, 2, {}],
  ['Patrick Ndzana', 'Peintre décorateur', 'artisan', 'Y', [['Peinture', 10000], ['Décoration', 15000]], 3, 8, {}],
  ['Hervé Tchoumi', 'Menuisier', 'artisan', 'Y', [['Menuiserie', 12000], ['Montage de meubles', 5000]], 3, 12, {}],
  ['Rostand Mbida', 'Débrouillard multi-services', 'freelancer', 'Y', [['Petites courses', 1500], ['Faire le marché', 2000], ['Aide au déménagement', 5000], ['Petits services divers', 1000]], 2, 4, {}],
  ['Sandrine Abena', "Agent d'entretien", 'freelancer', 'Y', [['Ménage', 4000], ['Lessive', 2500], ['Repassage', 2000]], 3, 5, {}],
  ['Grâce Ngono', 'Maquilleuse professionnelle', 'professional', 'Y', [['Maquillage', 8000], ['Soins du visage', 6000]], 5, 7, { pro: true, featured: true }],
  ['Ibrahim Moussa', 'Barber', 'artisan', 'Y', [['Barber', 1500], ['Coiffure', 2000]], 2, 5, {}],
  ['Christian Onana', 'Réparateur de téléphones', 'artisan', 'Y', [['Réparation téléphone', 3000], ['Dépannage PC', 4000]], 3, 6, {}],
  ['Ulrich Fotso', 'Graphiste & vidéaste', 'freelancer', 'Y', [['Design graphique', 10000], ['Montage vidéo', 15000], ['Photographie', 20000]], 4, 5, { pro: true }],
  ['Prisca Ebogo', 'Couturière', 'artisan', 'Y', [['Couture', 8000], ['Retouches', 1500]], 3, 10, {}],
  ['Alain Messi', 'Mécanicien auto', 'artisan', 'Y', [['Petite mécanique', 7000], ['Assistance', 5000], ['Lavage', 2000]], 3, 14, {}],
  ['Fabrice Nkodo', 'Laveur auto à domicile', 'freelancer', 'Y', [['Lavage', 2000], ['Nettoyage intérieur', 4000]], 2, 3, {}],
  ['EcoClean Services', 'Entreprise de nettoyage', 'company', 'Y', [['Ménage', 10000], ['Nettoyage intérieur', 6000], ['Débroussaillage', 15000]], 5, 6, { pro: true, featured: true }],
  ['Joseph Ayissi', 'Jardinier', 'artisan', 'Y', [['Jardinage', 5000], ['Débroussaillage', 8000], ['Entretien de terrain', 10000]], 3, 18, {}],
  ['Marthe Bilong', 'Cuisinière événementielle', 'professional', 'Y', [['Cuisine', 20000], ['Serveurs', 10000]], 4, 12, {}],
  ['Kevin Manga', 'DJ & animateur', 'freelancer', 'Y', [['DJ / animation', 25000], ['Décoration', 12000]], 3, 6, {}],
  ['Steve Omgba', 'Livreur moto', 'freelancer', 'Y', [['Livraison de colis', 1500], ['Récupération de documents', 1500], ['Petites courses', 1000]], 2, 3, {}],
  ['Mireille Zang', 'Masseuse bien-être', 'professional', 'Y', [['Massage', 10000], ['Soins du visage', 7000]], 4, 8, {}],
  ['Paul Ekani', 'Soudeur', 'artisan', 'Y', [['Soudure', 8000], ['Installation', 5000]], 3, 13, {}],
  ['Arnaud Tsala', 'Étudiant – saisie & impression', 'student', 'Y', [['Saisie', 1000], ['Impression', 1000], ['Recherches documentaires', 3000], ['Création de CV', 1500]], 2, 1, {}],
  ['Kalvin Ekwalla', 'Plombier sanitaire', 'artisan', 'D', [['Plomberie', 6000], ['Carrelage', 10000]], 3, 10, {}],
  ['Josiane Ekambi', 'Coiffeuse & tresseuse', 'artisan', 'D', [['Tresses', 7000], ['Coiffure', 4000], ["Pose d'ongles", 4000]], 3, 7, { featured: true }],
  ['Samuel Ngando', 'Électricien', 'artisan', 'D', [['Électricité', 5000], ['Réparation électroménager', 6000]], 3, 9, {}],
  ['Douala Move Express', 'Déménagement & manutention', 'company', 'D', [['Aide au déménagement', 25000], ['Chargement / déchargement', 10000], ['Manutention', 8000]], 5, 8, { pro: true }],
  ['Rita Dikongue', 'Ménagère', 'freelancer', 'D', [['Ménage', 3500], ['Repassage', 2000], ['Lessive', 2500]], 2, 4, {}],
  ['Blaise Moukoko', 'Mécanicien', 'artisan', 'D', [['Petite mécanique', 8000], ['Assistance', 6000]], 3, 16, {}],
  ['Cynthia Epee', 'Manucure & pédicure', 'freelancer', 'D', [['Manucure', 3000], ['Pédicure', 3500], ["Pose d'ongles", 6000]], 2, 3, {}],
  ['Yannick Ebelle', 'Technicien informatique', 'professional', 'D', [['Dépannage PC', 5000], ['Installation Windows / logiciels', 4000], ['Réparation téléphone', 5000]], 4, 7, { pro: true }],
  ['Emmanuel Kotto', 'Étudiant répétiteur d’anglais', 'student', 'D', [['Répétiteur', 5000], ['Traduction', 6000], ['Aide aux devoirs', 3000]], 3, 2, {}],
  ['Gisèle Njoh', 'Couturière retoucheuse', 'artisan', 'D', [['Retouches', 2000], ['Couture', 10000]], 2, 11, {}],
  ['Achille Mbella', "Main-d'œuvre & aide agricole", 'freelancer', 'D', [['Aide agricole', 4000], ['Manutention', 4000], ['Chargement / déchargement', 5000], ['Aide sur chantier', 4000]], 1, 5, {}],
  ['Florence Ewane', 'Aide à domicile', 'freelancer', 'D', [['Accompagnement', 5000], ["Récupération d'objets", 2000], ['Faire le marché', 2500]], 2, 6, {}],
];

/** [nom, ville (Y|D)] — le premier est le client de démonstration principal. */
export const CLIENTS = [
  ['Marie Ngo Bassa', 'Y'], ['Thierry Mbarga', 'Y'], ['Estelle Nkoulou', 'Y'], ['Franck Tagne', 'Y'], ['Viviane Ondoa', 'Y'],
  ['Lionel Fokou', 'Y'], ['Carine Ndongo', 'Y'], ['Olivier Nguema', 'D'], ['Sylvie Eboa', 'D'], ['Rodrigue Kamdem', 'D'],
];

export const NEIGHBORHOODS = {
  Y: ['Bastos', 'Essos', 'Mvog-Mbi', 'Biyem-Assi', 'Mendong', 'Ngoa-Ekellé', 'Nlongkak', 'Omnisport', 'Emana', 'Etoudi', 'Mimboman',
    'Odza', 'Ekounou', 'Melen', 'Nkolbisson', 'Tsinga', 'Elig-Essono', 'Mokolo', 'Santa Barbara', 'Obili'],
  D: ['Akwa', 'Bonapriso', 'Bonanjo', 'Bonamoussadi', 'Makepe', 'Deïdo', 'Bali', 'Logpom', 'Kotto', 'Ndokoti', 'Bépanda',
    'Ndogbong', 'Bonabéri', 'PK14', 'Cité des Palmiers'],
};

/** Descriptions de missions par sous-service (fallback générique sinon). */
export const JOB_DESCRIPTIONS = {
  Plomberie: ['Fuite sous l\'évier de la cuisine', 'Robinet de douche qui goutte', 'WC bouché à déboucher', 'Installation d\'un chauffe-eau', 'Fuite d\'eau dans la salle de bain'],
  'Dépannage PC': ['Ordinateur très lent, besoin d\'un nettoyage', 'PC portable qui ne démarre plus', 'Virus à supprimer'],
  'Installation Windows / logiciels': ['Installer Windows 11 et Office', 'Installation de logiciels pour étudiant'],
  'Création de CV': ['CV moderne pour candidature', 'Mise à jour de CV et lettre de motivation'],
  Coiffure: ['Coupe et brushing à domicile', 'Défrisage + mise en plis'],
  Tresses: ['Tresses box braids longues', 'Nattes collées pour enfant', 'Tresses africaines pour mariage'],
  Ménage: ['Grand ménage d\'un appartement 3 pièces', 'Ménage hebdomadaire', 'Nettoyage après déménagement'],
  Électricité: ['Prise électrique qui ne fonctionne plus', 'Installation de lampes au salon', 'Disjoncteur qui saute souvent'],
  Répétiteur: ['Cours de maths pour élève de 3e', 'Répétitions pour classe de Terminale C', 'Soutien en physique-chimie'],
  Maçonnerie: ['Construction d\'un petit mur de clôture', 'Réparation de fissures', 'Crépissage d\'une façade'],
  Manucure: ['Manucure simple + vernis', 'Manucure semi-permanent'],
  Pédicure: ['Pédicure complète à domicile'],
  "Pose d'ongles": ['Pose gel avec décoration', 'Remplissage capsules'],
  Lavage: ['Lavage complet de voiture à domicile', 'Lavage extérieur rapide'],
  'Faire le marché': ['Faire le marché au Mfoundi pour la semaine', 'Courses au marché Central'],
  'Petites courses': ['Acheter des médicaments à la pharmacie', 'Récupérer une commande en boutique'],
  'Livraison de colis': ['Livrer un colis à Bastos', 'Livraison de documents urgents'],
  'Aide au déménagement': ['Déménagement d\'un studio', 'Transport de meubles vers le nouveau logement'],
  Peinture: ['Peindre une chambre', 'Peinture du salon et des couloirs'],
  Menuiserie: ['Réparer une porte d\'armoire', 'Fabrication d\'étagères sur mesure'],
  'Réparation téléphone': ['Écran de téléphone cassé', 'Batterie à remplacer', 'Téléphone qui ne charge plus'],
  Couture: ['Robe en pagne sur mesure', 'Ensemble kaba ngondo pour cérémonie'],
  Retouches: ['Raccourcir un pantalon', 'Reprise de taille d\'une robe'],
  Cuisine: ['Cuisine pour un anniversaire de 30 personnes', 'Repas pour une réunion familiale'],
  'DJ / animation': ['Animation d\'un anniversaire', 'DJ pour une soirée de mariage'],
  Débroussaillage: ['Débroussailler un terrain de 500 m²', 'Nettoyage d\'une parcelle envahie'],
  Massage: ['Massage relaxant d\'une heure'],
  Maquillage: ['Maquillage pour un mariage', 'Maquillage soirée'],
  Barber: ['Coupe dégradé + barbe'],
  Climatisation: ['Entretien de deux climatiseurs', 'Climatiseur qui ne refroidit plus'],
  Traduction: ['Traduction d\'un document français-anglais'],
  'Mise en forme de mémoires': ['Mise en forme d\'un mémoire de Master'],
};

export const REVIEW_COMMENTS = {
  5: ['Excellent travail, très professionnel. Je recommande !', 'Ponctuel, efficace et souriant. Merci beaucoup !', 'Travail impeccable, rapide et propre.',
    'Très satisfaite, je ferai de nouveau appel à lui.', 'Au top ! Prix correct et travail soigné.', 'Service rapide, problème réglé en moins d\'une heure.',
    'Vraiment sérieux, il a même donné des conseils utiles.', 'Parfait du début à la fin.'],
  4: ['Bon travail, juste un petit retard à l\'arrivée.', 'Satisfait dans l\'ensemble, je recommande.', 'Travail bien fait, un peu cher mais correct.',
    'Prestataire aimable et compétent.', 'Bon service, communication à améliorer.'],
  3: ['Travail correct mais il a fallu revenir sur certains détails.', 'Moyen, le retard était important.', 'Résultat acceptable sans plus.'],
  2: ['Pas très satisfait, finitions bâclées.', 'Beaucoup de retard et travail incomplet.'],
  1: ['Très déçu, je ne recommande pas.'],
};

export const SUGGESTIONS = [
  'Réparation de groupe électrogène', 'Garde d\'enfants', 'Cours de guitare', 'Réparation de groupe électrogène', 'Installation de panneaux solaires',
  'Garde d\'enfants', 'Dératisation', 'Cours de guitare', 'Garde d\'enfants', 'Installation de caméras de surveillance', 'Désinsectisation',
  'Réparation de groupe électrogène', 'Coach sportif à domicile',
];
