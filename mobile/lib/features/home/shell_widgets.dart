import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import 'home_providers.dart';

/// Clé du Scaffold principal (pour ouvrir le tiroir depuis les onglets).
final GlobalKey<ScaffoldState> shellScaffoldKey = GlobalKey<ScaffoldState>();

class MenuButton extends StatelessWidget {
  const MenuButton({super.key, this.color = TaskoColors.primaryDark});
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Menu',
      icon: Icon(Icons.menu_rounded, color: color),
      onPressed: () {
        final state = shellScaffoldKey.currentState;
        if (state != null) {
          state.openDrawer();
        } else {
          Scaffold.maybeOf(context)?.openDrawer();
        }
      },
    );
  }
}

class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key, this.color = TaskoColors.primaryDark});
  final Color color;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(unreadNotificationsProvider);
    return IconButton(
      tooltip: 'Notifications',
      onPressed: () => context.push('/notifications'),
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '99+' : '$count'),
        backgroundColor: TaskoColors.danger,
        child: Icon(Icons.notifications_none_rounded, color: color),
      ),
    );
  }
}

/// Sélecteur de ville (GET /cities).
class CitySelector extends ConsumerWidget {
  const CitySelector({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(selectedCityProvider);
    final user = ref.watch(authProvider).user;
    final label = selected?.name ?? user?.city ?? 'Yaoundé';
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () => _pick(context, ref),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.location_on, size: 18, color: TaskoColors.primary),
            const SizedBox(width: 2),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 90),
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: TaskoColors.primaryDark,
                ),
              ),
            ),
            const Icon(Icons.keyboard_arrow_down, size: 18, color: TaskoColors.primaryDark),
          ],
        ),
      ),
    );
  }

  void _pick(BuildContext context, WidgetRef ref) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => Consumer(
        builder: (ctx, ref, _) {
          final cities = ref.watch(citiesProvider);
          return SafeArea(
            child: cities.when(
              data: (list) => list.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(24),
                      child: Text('Aucune ville disponible.'),
                    )
                  : ListView(
                      shrinkWrap: true,
                      children: [
                        const Padding(
                          padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
                          child: Text(
                            'Choisir votre ville',
                            style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                          ),
                        ),
                        for (final c in list)
                          ListTile(
                            leading: const Icon(Icons.location_city, color: TaskoColors.primary),
                            title: Text(c.name),
                            onTap: () {
                              ref.read(selectedCityProvider.notifier).select(c);
                              Navigator.pop(ctx);
                            },
                          ),
                      ],
                    ),
              loading: () => const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (e, _) => Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Impossible de charger les villes.'),
                    TextButton(
                      onPressed: () => ref.invalidate(citiesProvider),
                      child: const Text('Réessayer'),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
