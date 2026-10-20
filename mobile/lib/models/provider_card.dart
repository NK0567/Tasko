import 'json.dart';
import 'review.dart';
import 'user.dart';

class ProviderCard {
  final String id;
  final String fullName;
  final String? avatarUrl;
  final String headline;
  final String providerType;
  final double ratingAvg;
  final int ratingCount;
  final int missionsCompleted;
  final double? distanceKm;
  final int? etaMin;
  final int? minPrice;
  final bool isOnline;
  final bool isFeatured;
  final bool isPro;
  final int verificationLevel;
  final double? lat;
  final double? lng;
  final List<String> skills;
  final double score;

  const ProviderCard({
    required this.id,
    required this.fullName,
    this.avatarUrl,
    this.headline = '',
    this.providerType = 'freelancer',
    this.ratingAvg = 0,
    this.ratingCount = 0,
    this.missionsCompleted = 0,
    this.distanceKm,
    this.etaMin,
    this.minPrice,
    this.isOnline = false,
    this.isFeatured = false,
    this.isPro = false,
    this.verificationLevel = 1,
    this.lat,
    this.lng,
    this.skills = const [],
    this.score = 0,
  });

  factory ProviderCard.fromJson(Json j) => ProviderCard(
        id: asString(j['id'] ?? j['user_id']),
        fullName: asString(j['full_name'], 'Prestataire'),
        avatarUrl: asStringOrNull(j['avatar_url']),
        headline: asString(j['headline']),
        providerType: asString(j['provider_type'], 'freelancer'),
        ratingAvg: asDouble(j['rating_avg']),
        ratingCount: asInt(j['rating_count']),
        missionsCompleted: asInt(j['missions_completed']),
        distanceKm: asDoubleOrNull(j['distance_km']),
        etaMin: asIntOrNull(j['eta_min']),
        minPrice: asIntOrNull(j['min_price']),
        isOnline: asBool(j['is_online']),
        isFeatured: asBool(j['is_featured']),
        isPro: asBool(j['is_pro']),
        verificationLevel: asInt(j['verification_level'], 1),
        lat: asDoubleOrNull(j['lat']),
        lng: asDoubleOrNull(j['lng']),
        skills: asStringList(j['skills']),
        score: asDouble(j['score']),
      );
}

/// Détail d'un prestataire : `ProviderCard + { bio, years_experience, ... }`.
class ProviderDetail {
  final ProviderCard card;
  final String bio;
  final int yearsExperience;
  final List<int> availableDays;
  final List<ProviderSkill> skills;
  final List<PortfolioItem> portfolio;
  final List<Review> reviews;
  final bool isFollowed;
  final String? phone;

  const ProviderDetail({
    required this.card,
    this.bio = '',
    this.yearsExperience = 0,
    this.availableDays = const [],
    this.skills = const [],
    this.portfolio = const [],
    this.reviews = const [],
    this.isFollowed = false,
    this.phone,
  });

  factory ProviderDetail.fromJson(Json j) {
    final rawSkills = j['skills'];
    final skills = <ProviderSkill>[];
    if (rawSkills is List) {
      for (final s in rawSkills) {
        if (s is Map) {
          skills.add(ProviderSkill.fromJson(asMap(s)!));
        } else if (s != null) {
          skills.add(ProviderSkill(categoryId: '', name: s.toString(), basePrice: 0));
        }
      }
    }
    return ProviderDetail(
      card: ProviderCard.fromJson(j),
      bio: asString(j['bio']),
      yearsExperience: asInt(j['years_experience']),
      availableDays: asIntList(j['available_days']),
      skills: skills,
      portfolio: asList(j['portfolio'], PortfolioItem.fromJson),
      reviews: asList(j['reviews'], Review.fromJson),
      isFollowed: asBool(j['is_followed']),
      phone: asStringOrNull(j['phone']),
    );
  }

  ProviderDetail copyWith({bool? isFollowed}) => ProviderDetail(
        card: card,
        bio: bio,
        yearsExperience: yearsExperience,
        availableDays: availableDays,
        skills: skills,
        portfolio: portfolio,
        reviews: reviews,
        isFollowed: isFollowed ?? this.isFollowed,
        phone: phone,
      );
}
