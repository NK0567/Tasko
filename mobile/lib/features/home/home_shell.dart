import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../chat/conversations_screen.dart';
import '../jobs/my_jobs_screen.dart';
import '../menu/app_drawer.dart';
import '../profile/profile_screen.dart';
import '../provider_mode/provider_dashboard_screen.dart';
import 'home_providers.dart';
import 'home_screen.dart';
import '../../widgets/ux.dart';
import 'shell_widgets.dart';

/// Coquille principale : Accueil · Mes jobs · (+) · Messages · Profil.
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tab = ref.watch(shellTabProvider);
    final providerMode = ref.watch(authProvider.select((s) => s.isProviderMode));
    final unreadMessages = ref.watch(unreadMessagesProvider);

    final pages = [
      providerMode ? const ProviderDashboardScreen() : const HomeScreen(),
      const MyJobsScreen(),
      const ConversationsScreen(),
      const ProfileScreen(),
    ];
    // Index de page : 0,1,(+),2,3 → l'onglet central n'a pas de page.
    final pageIndex = tab.clamp(0, pages.length - 1);

    void select(int i) => ref.read(shellTabProvider.notifier).set(i);

    return Scaffold(
      key: shellScaffoldKey,
      drawer: const AppDrawer(),
      body: Column(
        children: [
          const SafeArea(bottom: false, child: OfflineBanner()),
          Expanded(child: IndexedStack(index: pageIndex, children: pages)),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          height: 66,
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: TaskoColors.border)),
          ),
          child: Row(
            children: [
              _NavItem(
                icon: providerMode ? Icons.dashboard_outlined : Icons.home_outlined,
                activeIcon: providerMode ? Icons.dashboard : Icons.home_rounded,
                label: providerMode ? 'Tableau' : 'Accueil',
                selected: pageIndex == 0,
                onTap: () => select(0),
              ),
              _NavItem(
                icon: Icons.work_outline,
                activeIcon: Icons.work,
                label: 'Mes jobs',
                selected: pageIndex == 1,
                onTap: () => select(1),
              ),
              Expanded(
                child: Center(
                  child: Tooltip(
                    message: providerMode ? 'Proposer une mission à un client' : 'Demander un service',
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: () =>
                          context.push(providerMode ? '/provider-mode/propose' : '/jobs/new'),
                      child: Container(
                        width: 52,
                        height: 52,
                        decoration: BoxDecoration(
                          color: TaskoColors.primary,
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: TaskoColors.primary.withValues(alpha: 0.35),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: const Icon(Icons.add, color: Colors.white, size: 30),
                      ),
                    ),
                  ),
                ),
              ),
              _NavItem(
                icon: Icons.chat_bubble_outline,
                activeIcon: Icons.chat_bubble,
                label: 'Messages',
                badge: unreadMessages,
                selected: pageIndex == 2,
                onTap: () {
                  select(2);
                  ref.read(unreadMessagesProvider.notifier).refresh();
                },
              ),
              _NavItem(
                icon: Icons.person_outline,
                activeIcon: Icons.person,
                label: 'Profil',
                selected: pageIndex == 3,
                onTap: () => select(3),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.badge = 0,
  });

  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final int badge;

  @override
  Widget build(BuildContext context) {
    final color = selected ? TaskoColors.primary : TaskoColors.textMuted;
    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Badge(
              isLabelVisible: badge > 0,
              label: Text('$badge'),
              backgroundColor: TaskoColors.danger,
              child: Icon(selected ? activeIcon : icon, color: color, size: 24),
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                color: color,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
