import 'json.dart';

class Category {
  final String id;
  final String? parentId;
  final String name;
  final String slug;
  final String? description;
  final String icon;
  final String? color;
  final int position;
  final bool isActive;
  final int providersCount;
  final List<Category> children;

  const Category({
    required this.id,
    this.parentId,
    required this.name,
    this.slug = '',
    this.description,
    this.icon = 'more_horiz',
    this.color,
    this.position = 0,
    this.isActive = true,
    this.providersCount = 0,
    this.children = const [],
  });

  bool get isRoot => parentId == null;

  factory Category.fromJson(Json j) {
    final children = asList(j['children'], Category.fromJson).toList()
      ..sort((a, b) => a.position.compareTo(b.position));
    return Category(
      id: asString(j['id']),
      parentId: asStringOrNull(j['parent_id']),
      name: asString(j['name']),
      slug: asString(j['slug']),
      description: asStringOrNull(j['description']),
      icon: asString(j['icon'], 'more_horiz'),
      color: asStringOrNull(j['color']),
      position: asInt(j['position']),
      isActive: asBool(j['is_active'], true),
      providersCount: asInt(j['providers_count']),
      children: children.where((c) => c.isActive).toList(growable: false),
    );
  }
}

class City {
  final String id;
  final String name;
  final double lat;
  final double lng;
  final bool isActive;

  const City({
    required this.id,
    required this.name,
    required this.lat,
    required this.lng,
    this.isActive = true,
  });

  factory City.fromJson(Json j) => City(
        id: asString(j['id']),
        name: asString(j['name']),
        lat: asDouble(j['lat']),
        lng: asDouble(j['lng']),
        isActive: asBool(j['is_active'], true),
      );
}

/// Catégorie spéciale « Autre service » (slug `autre`, gérée par le backend).
bool isOtherCategory(Category c) => c.slug == 'autre';

Category? otherCategoryOf(List<Category> categories) {
  for (final c in categories) {
    if (isOtherCategory(c)) return c;
  }
  return null;
}
