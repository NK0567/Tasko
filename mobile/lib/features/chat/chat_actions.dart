import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../widgets/common.dart';

/// Ouvre (ou crée) la conversation avec [userId] puis affiche le chat.
Future<void> openChatWith(
  BuildContext context,
  WidgetRef ref, {
  required String userId,
  String? jobId,
}) async {
  try {
    final conv = await ref.read(apiProvider).openConversation(userId, jobId: jobId);
    if (context.mounted) context.push('/chat/${conv.id}', extra: conv.otherUser);
  } catch (e) {
    if (context.mounted) showSnack(context, errorMessage(e), error: true);
  }
}
