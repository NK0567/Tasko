import 'job.dart';
import 'json.dart';

/// Types de biens immobiliers.
const Map<String, String> kPropertyKindLabels = {
  'apartment': 'Appartement',
  'house': 'Maison / villa',
  'building': 'Immeuble',
  'land': 'Terrain',
  'commercial': 'Local commercial',
  'other': 'Autre',
};

String propertyKindLabel(String? kind) => kPropertyKindLabels[kind] ?? 'Bien';

/// Bien immobilier (propriétaires, agences, syndics).
class Property {
  final String id;
  final String name;
  final String kind;
  final String address;
  final double? lat;
  final double? lng;
  final int? unitsCount;
  final String? notes;
  final int jobsCount;
  final int totalSpent;
  final DateTime? createdAt;

  const Property({
    required this.id,
    required this.name,
    this.kind = 'apartment',
    this.address = '',
    this.lat,
    this.lng,
    this.unitsCount,
    this.notes,
    this.jobsCount = 0,
    this.totalSpent = 0,
    this.createdAt,
  });

  factory Property.fromJson(Json j) => Property(
        id: asString(j['id']),
        name: asString(j['name'], 'Bien'),
        kind: asString(j['kind'], 'other'),
        address: asString(j['address']),
        lat: asDoubleOrNull(j['lat']),
        lng: asDoubleOrNull(j['lng']),
        unitsCount: asIntOrNull(j['units_count']),
        notes: asStringOrNull(j['notes']),
        jobsCount: asInt(j['jobs_count']),
        totalSpent: asInt(j['total_spent']),
        createdAt: asDate(j['created_at']),
      );
}

/// Détail d'un bien : `Property + {jobs, recurring}`.
class PropertyDetail {
  final Property property;
  final List<Job> jobs;
  final List<RecurringJob> recurring;

  const PropertyDetail({required this.property, this.jobs = const [], this.recurring = const []});

  factory PropertyDetail.fromJson(Json j) => PropertyDetail(
        property: Property.fromJson(j),
        jobs: asList(j['jobs'], Job.fromJson),
        recurring: asList(j['recurring'], RecurringJob.fromJson),
      );
}

/// Fréquences des missions récurrentes.
const Map<String, String> kFrequencyLabels = {
  'weekly': 'Chaque semaine',
  'biweekly': 'Toutes les 2 semaines',
  'monthly': 'Chaque mois',
};

String frequencyLabel(String f) => kFrequencyLabels[f] ?? f;

/// Mission récurrente avec un prestataire attitré.
class RecurringJob {
  final String id;
  final String? propertyId;
  final String categoryId;
  final String? categoryName;
  final String providerId;
  final String? providerName;
  final String title;
  final String description;
  final int price;
  final String frequency;
  final DateTime? nextRunAt;
  final bool isActive;

  const RecurringJob({
    required this.id,
    this.propertyId,
    required this.categoryId,
    this.categoryName,
    required this.providerId,
    this.providerName,
    required this.title,
    this.description = '',
    required this.price,
    this.frequency = 'monthly',
    this.nextRunAt,
    this.isActive = true,
  });

  factory RecurringJob.fromJson(Json j) {
    final provider = asMap(j['provider']);
    final category = asMap(j['category']);
    return RecurringJob(
      id: asString(j['id']),
      propertyId: asStringOrNull(j['property_id']),
      categoryId: asString(j['category_id'] ?? category?['id']),
      categoryName: asStringOrNull(category?['name'] ?? j['category_name']),
      providerId: asString(j['provider_id'] ?? provider?['id']),
      providerName: asStringOrNull(provider?['full_name'] ?? j['provider_name']),
      title: asString(j['title'], 'Mission récurrente'),
      description: asString(j['description']),
      price: asInt(j['price']),
      frequency: asString(j['frequency'], 'monthly'),
      nextRunAt: asDate(j['next_run_at']),
      isActive: asBool(j['is_active'], true),
    );
  }
}
