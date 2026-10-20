import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/socket_service.dart';
import '../../models/provider_card.dart';

/// Prestataires recommandés à proximité (tri par score).
final recommendedProvidersProvider = FutureProvider<List<ProviderCard>>((ref) async {
  final pos = await ref.watch(positionProvider.future);
  return ref.watch(apiProvider).providers(lat: pos.lat, lng: pos.lng, sort: 'score', limit: 10);
});

/// Compteur de notifications non lues (mis à jour en temps réel).
class UnreadNotificationsNotifier extends Notifier<int> {
  StreamSubscription<dynamic>? _sub;
  StreamSubscription<void>? _reconnect;

  @override
  int build() {
    final auth = ref.watch(authProvider);
    _sub?.cancel();
    if (auth.isLoggedIn) {
      _sub = SocketService.instance.on('notification:new').listen((_) => state = state + 1);
      _reconnect = SocketService.instance.reconnected.listen((_) => refresh());
      Future.microtask(refresh);
    }
    ref.onDispose(() {
      _sub?.cancel();
      _reconnect?.cancel();
    });
    return 0;
  }

  Future<void> refresh() async {
    try {
      final page = await ref.read(apiProvider).notifications();
      state = page.unreadCount;
    } catch (_) {}
  }

  void clear() => state = 0;
}

final unreadNotificationsProvider =
    NotifierProvider<UnreadNotificationsNotifier, int>(UnreadNotificationsNotifier.new);

/// Nombre de messages non lus (somme des conversations).
class UnreadMessagesNotifier extends Notifier<int> {
  StreamSubscription<dynamic>? _sub;

  @override
  int build() {
    final auth = ref.watch(authProvider);
    _sub?.cancel();
    if (auth.isLoggedIn) {
      final myId = auth.user?.id;
      _sub = SocketService.instance.on('message:new').listen((m) {
        if (m['sender_id'] != myId) state = state + 1;
      });
      Future.microtask(refresh);
    }
    ref.onDispose(() => _sub?.cancel());
    return 0;
  }

  Future<void> refresh() async {
    try {
      final list = await ref.read(apiProvider).conversations();
      state = list.fold(0, (sum, c) => sum + c.unreadCount);
    } catch (_) {}
  }
}

final unreadMessagesProvider =
    NotifierProvider<UnreadMessagesNotifier, int>(UnreadMessagesNotifier.new);
