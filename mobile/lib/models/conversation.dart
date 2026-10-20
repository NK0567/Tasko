import 'json.dart';

class ChatUser {
  final String id;
  final String fullName;
  final String? avatarUrl;
  final String? headline;
  final bool isOnline;

  const ChatUser({
    required this.id,
    required this.fullName,
    this.avatarUrl,
    this.headline,
    this.isOnline = false,
  });

  factory ChatUser.fromJson(Json j) => ChatUser(
        id: asString(j['id']),
        fullName: asString(j['full_name'], 'Utilisateur'),
        avatarUrl: asStringOrNull(j['avatar_url']),
        headline: asStringOrNull(j['headline']),
        isOnline: asBool(j['is_online']),
      );
}

class Message {
  final String id;
  final String conversationId;
  final String senderId;
  final String type;
  final String body;
  final double? lat;
  final double? lng;
  final DateTime? createdAt;
  final DateTime? readAt;

  /// Rôle de l'expéditeur dans un salon de médiation : client | provider | admin | system.
  final String? senderRole;

  /// Nom de l'expéditeur (salon de médiation).
  final String? senderName;

  const Message({
    required this.id,
    required this.conversationId,
    required this.senderId,
    this.type = 'text',
    this.body = '',
    this.lat,
    this.lng,
    this.createdAt,
    this.readAt,
    this.senderRole,
    this.senderName,
  });

  bool get isLocation => type == 'location' && lat != null && lng != null;
  bool get isImage => type == 'image';
  bool get isSystem => type == 'system' || senderRole == 'system';
  bool get isProposal => type == 'proposal';

  factory Message.fromJson(Json j) => Message(
        id: asString(j['id']),
        conversationId: asString(j['conversation_id']),
        senderId: asString(j['sender_id']),
        type: asString(j['type'], 'text'),
        body: asString(j['body']),
        lat: asDoubleOrNull(j['lat']),
        lng: asDoubleOrNull(j['lng']),
        createdAt: asDate(j['created_at']),
        readAt: asDate(j['read_at']),
        senderRole: asStringOrNull(j['sender_role']),
        senderName: asStringOrNull(j['sender_name'] ?? asMap(j['sender'])?['full_name']),
      );

  /// Aperçu pour la liste des conversations.
  String get preview => switch (type) {
        'location' => 'Position partagée',
        'image' => 'Photo',
        'proposal' => 'Proposition d’accord',
        _ => body,
      };
}

class Conversation {
  final String id;
  final ChatUser otherUser;
  final String? jobId;
  final Message? lastMessage;
  final int unreadCount;
  final DateTime? updatedAt;

  const Conversation({
    required this.id,
    required this.otherUser,
    this.jobId,
    this.lastMessage,
    this.unreadCount = 0,
    this.updatedAt,
  });

  factory Conversation.fromJson(Json j) {
    final last = asMap(j['last_message']);
    return Conversation(
      id: asString(j['id']),
      otherUser: ChatUser.fromJson(asMap(j['other_user']) ?? const {}),
      jobId: asStringOrNull(j['job_id']),
      lastMessage: last == null ? null : Message.fromJson(last),
      unreadCount: asInt(j['unread_count']),
      updatedAt: asDate(j['updated_at']),
    );
  }
}
