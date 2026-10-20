/// Petites fonctions de conversion tolérantes pour le JSON de l'API.
typedef Json = Map<String, dynamic>;

int asInt(dynamic v, [int fallback = 0]) {
  if (v == null) return fallback;
  if (v is int) return v;
  if (v is num) return v.round();
  if (v is String) return num.tryParse(v)?.round() ?? fallback;
  return fallback;
}

int? asIntOrNull(dynamic v) => v == null ? null : asInt(v);

double asDouble(dynamic v, [double fallback = 0]) {
  if (v == null) return fallback;
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? fallback;
  return fallback;
}

double? asDoubleOrNull(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v);
  return null;
}

bool asBool(dynamic v, [bool fallback = false]) {
  if (v == null) return fallback;
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) return v == 'true' || v == '1';
  return fallback;
}

String asString(dynamic v, [String fallback = '']) =>
    v == null ? fallback : v.toString();

String? asStringOrNull(dynamic v) => v?.toString();

DateTime? asDate(dynamic v) {
  if (v == null) return null;
  if (v is DateTime) return v;
  return DateTime.tryParse(v.toString());
}

Json? asMap(dynamic v) {
  if (v is Map<String, dynamic>) return v;
  if (v is Map) return v.map((k, val) => MapEntry(k.toString(), val));
  return null;
}

List<T> asList<T>(dynamic v, T Function(Json) fromJson) {
  if (v is! List) return <T>[];
  return v
      .map(asMap)
      .whereType<Json>()
      .map(fromJson)
      .toList(growable: false);
}

List<String> asStringList(dynamic v) {
  if (v is! List) return const [];
  return v.map((e) {
    if (e is Map) return asString(e['name']);
    return e.toString();
  }).where((s) => s.isNotEmpty).toList(growable: false);
}

List<int> asIntList(dynamic v) {
  if (v is! List) return const [];
  return v.map((e) => asInt(e, -1)).where((e) => e >= 0).toList(growable: false);
}

/// Extrait `items` d'une réponse de liste `{ "items": [...] }`.
List<T> itemsOf<T>(dynamic data, T Function(Json) fromJson) {
  final map = asMap(data);
  if (map != null) return asList(map['items'], fromJson);
  if (data is List) return asList(data, fromJson);
  return <T>[];
}
