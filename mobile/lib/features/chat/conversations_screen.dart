import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/socket_service.dart';
import '../../core/theme.dart';
import '../../models/conversation.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../home/shell_widgets.dart';

final conversationsProvider = FutureProvider<List<Conversation>>((ref) async {
  ref.watch(authProvider.select((s) => s.token));
  final list = await ref.watch(apiProvider).conversations();
  list.sort((a, b) => (b.updatedAt ?? DateTime(0)).compareTo(a.updatedAt ?? DateTime(0)));
  return list;
});

/// Onglet Messages : liste des conversations (rafraîchie en temps réel).
class ConversationsScreen extends ConsumerStatefulWidget {
  const ConversationsScreen({super.key});

  @override
  ConsumerState<ConversationsScreen> createState() => _ConversationsScreenState();
}

class _ConversationsScreenState extends ConsumerState<ConversationsScreen> {
  StreamSubscription<dynamic>? _sub;

  @override
  void initState() {
    super.initState();
    _sub = SocketService.instance.on('message:new').listen((_) {
      if (mounted) ref.invalidate(conversationsProvider);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final convs = ref.watch(conversationsProvider);
    return Scaffold(
      appBar: AppBar(
        leading: const MenuButton(),
        title: const Text('Messages'),
        actions: const [NotificationBell()],
      ),
      body: AsyncView(
        value: convs,
        onRetry: () => ref.invalidate(conversationsProvider),
        data: (list) => list.isEmpty
            ? const EmptyView(
                title: 'Aucune conversation',
                message: 'Contactez un prestataire depuis son profil pour démarrer une discussion.',
              )
            : RefreshIndicator(
                onRefresh: () => ref.refresh(conversationsProvider.future),
                child: ListView.separated(
                  itemCount: list.length,
                  separatorBuilder: (_, _) => const Divider(indent: 76),
                  itemBuilder: (_, i) {
                    final c = list[i];
                    return ListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                      leading: TaskoAvatar(
                        name: c.otherUser.fullName,
                        url: c.otherUser.avatarUrl,
                        size: 48,
                        online: c.otherUser.isOnline,
                      ),
                      title: Text(
                        c.otherUser.fullName,
                        style: TextStyle(
                          fontWeight: c.unreadCount > 0 ? FontWeight.w700 : FontWeight.w600,
                        ),
                      ),
                      subtitle: Text(
                        c.lastMessage?.preview ?? (c.otherUser.headline ?? 'Nouvelle conversation'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            formatRelative(c.lastMessage?.createdAt ?? c.updatedAt),
                            style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted),
                          ),
                          if (c.unreadCount > 0) ...[
                            const SizedBox(height: 4),
                            CircleAvatar(
                              radius: 10,
                              backgroundColor: TaskoColors.primary,
                              child: Text(
                                '${c.unreadCount}',
                                style: const TextStyle(fontSize: 11, color: Colors.white),
                              ),
                            ),
                          ],
                        ],
                      ),
                      onTap: () async {
                        await context.push('/chat/${c.id}', extra: c.otherUser);
                        ref.invalidate(conversationsProvider);
                      },
                    );
                  },
                ),
              ),
      ),
    );
  }
}
