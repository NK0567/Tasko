import 'json.dart';

class PersonRef {
  final String id;
  final String fullName;
  final String? avatarUrl;

  const PersonRef({required this.id, required this.fullName, this.avatarUrl});

  factory PersonRef.fromJson(Json j) => PersonRef(
        id: asString(j['id']),
        fullName: asString(j['full_name'], 'Utilisateur'),
        avatarUrl: asStringOrNull(j['avatar_url']),
      );
}

class Review {
  final String id;
  final String? jobId;
  final PersonRef author;
  final int rating;
  final String comment;
  final DateTime? createdAt;
  final String? targetName;

  const Review({
    required this.id,
    this.jobId,
    required this.author,
    required this.rating,
    this.comment = '',
    this.createdAt,
    this.targetName,
  });

  factory Review.fromJson(Json j) => Review(
        id: asString(j['id']),
        jobId: asStringOrNull(j['job_id']),
        author: PersonRef.fromJson(asMap(j['author']) ?? const {}),
        rating: asInt(j['rating']).clamp(0, 5),
        comment: asString(j['comment']),
        createdAt: asDate(j['created_at']),
        targetName: asStringOrNull(j['target_name']),
      );
}
