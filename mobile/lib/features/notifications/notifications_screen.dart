import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/socket_service.dart';
import '../../core/tasko_api.dart';
import '../../core/theme.dart';
import '../../models/notification.dart';
import '../../widgets/common.dart';
import '../home/home_providers.dart';
import '../jobs/job_common.dart';

/// Écran 14 — Notifications : Toutes / Jobs / Messages / Système, temps réel.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  static const _tabs = [
    (null, 'Toutes'),
    ('job', 'Jobs'),
    ('message', 'Messages'),
    ('system', 'Système'),
  ];

  List<AppNotification> _items = const [];
  bool _loading = true;
  Object? _error;
  StreamSubscription<dynamic>? _sub;
  Timer? _ticker;

  late final TaskoApi _api = ref.read(apiProvider);

  @override
  void initState() {
    super.initState();
    _api; // capture pour dispose()
    _load();
    _sub = SocketService.instance.on('notification:new').listen((data) {
      final n = AppNotification.fromJson(data);
      if (!mounted || _items.any((e) => e.id == n.id)) return;
      setState(() => _items = [n, ..._items]);
    });
    // Rafraîchit les « Il y a X min ».
    _ticker = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _ticker?.cancel();
    // Tout est considéré comme lu en quittant l'écran.
    _api.readAllNotifications().catchError((_) {});
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ref.read(apiProvider).notifications();
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _loading = false;
      });
      ref.read(unreadNotificationsProvider.notifier).clear();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  void _open(AppNotification n) {
    if (n.disputeId != null) {
      context.push('/disputes/${n.disputeId}');
    } else if (n.jobId != null) {
      openJobById(context, ref, n.jobId!);
    } else if (n.conversationId != null) {
      context.push('/chat/${n.conversationId}');
    }
  }

  List<AppNotification> _filter(String? type) {
    if (type == null) return _items;
    if (type == 'job') return _items.where((n) => n.type == 'job' || n.type == 'payment').toList();
    return _items.where((n) => n.type == type).toList();
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: _tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Notifications'),
          actions: [
            IconButton(
              tooltip: 'Tout marquer comme lu',
              icon: const Icon(Icons.done_all),
              onPressed: () async {
                try {
                  await ref.read(apiProvider).readAllNotifications();
                  ref.read(unreadNotificationsProvider.notifier).clear();
                  _load();
                } catch (e) {
                  if (context.mounted) showSnack(context, errorMessage(e), error: true);
                }
              },
            ),
          ],
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(52),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Builder(
                builder: (context) {
                  final controller = DefaultTabController.of(context);
                  return AnimatedBuilder(
                    animation: controller,
                    builder: (_, _) => Row(
                      children: [
                        for (var i = 0; i < _tabs.length; i++)
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 3),
                              child: _PillTab(
                                label: _tabs[i].$2,
                                selected: controller.index == i,
                                onTap: () => controller.animateTo(i),
                              ),
                            ),
                          ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
        ),
        body: _loading
            ? const LoadingView()
            : _error != null
                ? ErrorView(error: _error!, onRetry: _load)
                : TabBarView(
                    children: [
                      for (final t in _tabs) _buildList(_filter(t.$1)),
                    ],
                  ),
      ),
    );
  }

  Widget _buildList(List<AppNotification> list) {
    if (list.isEmpty) {
      return const EmptyView(title: 'Aucune notification', message: 'Vous êtes à jour.');
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: list.length,
        separatorBuilder: (_, _) => const Divider(indent: 72),
        itemBuilder: (_, i) {
          final n = list[i];
          return ListTile(
            onTap: () => _open(n),
            tileColor: n.isRead ? null : TaskoColors.chip.withValues(alpha: 0.5),
            leading: CircleAvatar(
              radius: 22,
              backgroundColor: n.color.withValues(alpha: 0.14),
              child: Icon(n.icon, color: n.color),
            ),
            title: Text(
              n.title,
              style: TextStyle(fontWeight: n.isRead ? FontWeight.w500 : FontWeight.w700),
            ),
            subtitle: n.body.isEmpty ? null : Text(n.body, maxLines: 2, overflow: TextOverflow.ellipsis),
            trailing: Text(
              formatRelative(n.createdAt),
              style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted),
            ),
          );
        },
      ),
    );
  }
}

class _PillTab extends StatelessWidget {
  const _PillTab({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? TaskoColors.primary : TaskoColors.chip,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: selected ? Colors.white : TaskoColors.primary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
