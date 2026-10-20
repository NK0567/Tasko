import 'package:flutter/material.dart';

import '../core/formatters.dart';
import 'json.dart';

class AppNotification {
  final String id;
  final String type;
  final String title;
  final String body;
  final Json data;
  final DateTime? readAt;
  final DateTime? createdAt;

  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    this.body = '',
    this.data = const {},
    this.readAt,
    this.createdAt,
  });

  bool get isRead => readAt != null;
  String? get jobId => asStringOrNull(data['job_id']);
  String? get conversationId => asStringOrNull(data['conversation_id']);
  String? get disputeId => asStringOrNull(data['dispute_id']);

  factory AppNotification.fromJson(Json j) => AppNotification(
        id: asString(j['id']),
        type: asString(j['type'], 'system'),
        // Les textes serveur peuvent contenir des emojis, mal rendus sur le web.
        title: stripEmoji(asString(j['title'])),
        body: stripEmoji(asString(j['body'])),
        data: asMap(j['data']) ?? const {},
        readAt: asDate(j['read_at']),
        createdAt: asDate(j['created_at']),
      );

  IconData get icon => switch (type) {
        'job' => Icons.work_outline,
        'payment' => Icons.account_balance_wallet_outlined,
        'message' => Icons.chat_bubble_outline,
        _ => Icons.notifications_none,
      };

  Color get color => switch (type) {
        'job' => const Color(0xFF0F7A3D),
        'payment' => const Color(0xFFF5B700),
        'message' => const Color(0xFF2F80ED),
        _ => const Color(0xFF6B7A72),
      };
}

class NotificationPage {
  final List<AppNotification> items;
  final int unreadCount;
  const NotificationPage({required this.items, this.unreadCount = 0});

  factory NotificationPage.fromJson(Json j) => NotificationPage(
        items: asList(j['items'], AppNotification.fromJson),
        unreadCount: asInt(j['unread_count']),
      );
}
