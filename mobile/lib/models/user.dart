import 'json.dart';

class ProviderSkill {
  final String categoryId;
  final String name;
  final String? parentName;
  final String? icon;
  final int basePrice;

  const ProviderSkill({
    required this.categoryId,
    required this.name,
    this.parentName,
    this.icon,
    required this.basePrice,
  });

  factory ProviderSkill.fromJson(Json j) => ProviderSkill(
        categoryId: asString(j['category_id']),
        name: asString(j['name']),
        parentName: asStringOrNull(j['parent_name']),
        icon: asStringOrNull(j['icon']),
        basePrice: asInt(j['base_price']),
      );

  Json toJson() => {'category_id': categoryId, 'base_price': basePrice};
}

class PortfolioItem {
  final String id;
  final String title;
  final String? imageUrl;

  const PortfolioItem({required this.id, required this.title, this.imageUrl});

  factory PortfolioItem.fromJson(Json j) => PortfolioItem(
        id: asString(j['id']),
        title: asString(j['title']),
        imageUrl: asStringOrNull(j['image_url']),
      );
}

/// Types de prestataires (contrat : `provider_type`).
const Map<String, String> kProviderTypeLabels = {
  'artisan': 'Artisan',
  'student': 'Étudiant',
  'professional': 'Professionnel',
  'freelancer': 'Débrouillard / Indépendant',
  'company': 'Entreprise',
};

String providerTypeLabel(String? type) =>
    kProviderTypeLabels[type] ?? 'Prestataire';

class ProviderProfile {
  final String userId;
  final String headline;
  final String bio;
  final String providerType;
  final int yearsExperience;
  final bool isOnline;
  final double? lat;
  final double? lng;
  final double ratingAvg;
  final int ratingCount;
  final int missionsCompleted;
  final int completionRate;
  final String? momoNumber;
  final String? momoOperator;
  final String plan;
  final DateTime? proUntil;
  final DateTime? featuredUntil;
  final List<int> availableDays;
  final List<ProviderSkill> skills;
  final List<PortfolioItem> portfolio;

  /// Code Tasko public (`TSK-XXXXX`) à partager aux clients.
  final String? publicCode;

  /// Nombre d'annulations du prestataire (impacte son score).
  final int cancellations;

  /// Montant disponible dans son portefeuille (versements échoués / en attente).
  final int walletAvailable;

  const ProviderProfile({
    required this.userId,
    this.headline = '',
    this.bio = '',
    this.providerType = 'freelancer',
    this.yearsExperience = 0,
    this.isOnline = false,
    this.lat,
    this.lng,
    this.ratingAvg = 0,
    this.ratingCount = 0,
    this.missionsCompleted = 0,
    this.completionRate = 0,
    this.momoNumber,
    this.momoOperator,
    this.plan = 'free',
    this.proUntil,
    this.featuredUntil,
    this.availableDays = const [],
    this.skills = const [],
    this.portfolio = const [],
    this.publicCode,
    this.cancellations = 0,
    this.walletAvailable = 0,
  });

  bool get isPro => plan == 'pro';
  bool get isFeatured =>
      featuredUntil != null && featuredUntil!.isAfter(DateTime.now());

  factory ProviderProfile.fromJson(Json j) => ProviderProfile(
        userId: asString(j['user_id']),
        headline: asString(j['headline']),
        bio: asString(j['bio']),
        providerType: asString(j['provider_type'], 'freelancer'),
        yearsExperience: asInt(j['years_experience']),
        isOnline: asBool(j['is_online']),
        lat: asDoubleOrNull(j['lat']),
        lng: asDoubleOrNull(j['lng']),
        ratingAvg: asDouble(j['rating_avg']),
        ratingCount: asInt(j['rating_count']),
        missionsCompleted: asInt(j['missions_completed']),
        completionRate: asInt(j['completion_rate']),
        momoNumber: asStringOrNull(j['momo_number']),
        momoOperator: asStringOrNull(j['momo_operator']),
        plan: asString(j['plan'], 'free'),
        proUntil: asDate(j['pro_until']),
        featuredUntil: asDate(j['featured_until']),
        availableDays: asIntList(j['available_days']),
        skills: asList(j['skills'], ProviderSkill.fromJson),
        portfolio: asList(j['portfolio'], PortfolioItem.fromJson),
        publicCode: asStringOrNull(j['public_code']),
        cancellations: asInt(j['cancellations']),
        walletAvailable: asInt(j['wallet_available']),
      );
}

/// Types de structure d'un compte entreprise.
const Map<String, String> kBusinessKindLabels = {
  'company': 'Entreprise',
  'real_estate': 'Immobilier (agence, syndic, propriétaire)',
  'ngo': 'ONG / association',
  'administration': 'Administration',
  'other': 'Autre',
};

String businessKindLabel(String? kind) => kBusinessKindLabels[kind] ?? 'Entreprise';

/// Informations d'un compte entreprise (`User.business`).
class BusinessInfo {
  final String name;
  final String kind;
  final String? niu;
  final String? rccm;
  final String? address;

  const BusinessInfo({
    required this.name,
    this.kind = 'company',
    this.niu,
    this.rccm,
    this.address,
  });

  factory BusinessInfo.fromJson(Json j) => BusinessInfo(
        name: asString(j['name']),
        kind: asString(j['kind'], 'company'),
        niu: asStringOrNull(j['niu']),
        rccm: asStringOrNull(j['rccm']),
        address: asStringOrNull(j['address']),
      );

  Json toJson() => {
        'name': name,
        'kind': kind,
        if (niu != null && niu!.isNotEmpty) 'niu': niu,
        if (rccm != null && rccm!.isNotEmpty) 'rccm': rccm,
        if (address != null && address!.isNotEmpty) 'address': address,
      };

  bool get isRealEstate => kind == 'real_estate';
}

class User {
  final String id;
  final String fullName;
  final String phone;
  final String? email;
  final String? avatarUrl;
  final String? city;
  final bool isProvider;
  final bool isAdmin;
  final String status;
  final int verificationLevel;
  final DateTime? createdAt;
  final ProviderProfile? provider;

  /// `individual` ou `business`.
  final String accountType;
  final BusinessInfo? business;
  final Json raw;

  const User({
    required this.id,
    required this.fullName,
    required this.phone,
    this.email,
    this.avatarUrl,
    this.city,
    this.isProvider = false,
    this.isAdmin = false,
    this.status = 'active',
    this.verificationLevel = 1,
    this.createdAt,
    this.provider,
    this.accountType = 'individual',
    this.business,
    this.raw = const {},
  });

  factory User.fromJson(Json j) {
    final p = asMap(j['provider']);
    final b = asMap(j['business']);
    return User(
      id: asString(j['id']),
      fullName: asString(j['full_name'], 'Utilisateur'),
      phone: asString(j['phone']),
      email: asStringOrNull(j['email']),
      avatarUrl: asStringOrNull(j['avatar_url']),
      city: asStringOrNull(j['city']),
      isProvider: asBool(j['is_provider']),
      isAdmin: asBool(j['is_admin']),
      status: asString(j['status'], 'active'),
      verificationLevel: asInt(j['verification_level'], 1),
      createdAt: asDate(j['created_at']),
      provider: p == null ? null : ProviderProfile.fromJson(p),
      accountType: asString(j['account_type'], b == null ? 'individual' : 'business'),
      business: b == null ? null : BusinessInfo.fromJson(b),
      raw: j,
    );
  }

  Json toJson() => raw;

  bool get isBusiness => accountType == 'business' && business != null;

  String get headline {
    final h = provider?.headline ?? '';
    if (h.isNotEmpty) return h;
    return isProvider ? 'Prestataire Tasko' : 'Client Tasko';
  }
}
