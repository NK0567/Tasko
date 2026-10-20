import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../widgets/avatar.dart';
import '../../widgets/tasko_logo.dart';

/// Écran 15 — Menu utilisateur (tiroir vert foncé).
class AppDrawer extends ConsumerWidget {
  const AppDrawer({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    final user = auth.user;

    void go(String path, {int? tab}) {
      Navigator.of(context).pop();
      if (tab != null) {
        ref.read(shellTabProvider.notifier).set(tab);
      } else {
        context.push(path);
      }
    }

    Future<void> toggleProvider(bool value) async {
      if (value && !(user?.isProvider ?? false)) {
        Navigator.of(context).pop();
        context.push('/provider-mode/setup');
        return;
      }
      await ref.read(authProvider.notifier).setProviderMode(value);
      ref.read(shellTabProvider.notifier).set(0);
    }

    return Drawer(
      backgroundColor: TaskoColors.primaryDark,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
              child: Row(
                children: [
                  TaskoAvatar(
                    name: user?.fullName,
                    url: user?.avatarUrl,
                    size: 56,
                    borderColor: TaskoColors.accent,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.fullName ?? 'Invité',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w600,
                            fontSize: 16,
                          ),
                        ),
                        Text(
                          user?.headline ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Colors.white70, fontSize: 12.5),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  const Icon(Icons.swap_horiz_rounded, color: TaskoColors.accent),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Mode Prestataire',
                          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                        ),
                        Text(
                          'Basculer pour recevoir des missions',
                          style: TextStyle(color: Colors.white60, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                  Switch(
                    value: auth.isProviderMode,
                    activeThumbColor: Colors.white,
                    activeTrackColor: TaskoColors.accent,
                    onChanged: toggleProvider,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 6),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  _Item(Icons.person_outline, 'Mon profil', () => go('', tab: 3)),
                  _Item(Icons.work_outline, 'Mes jobs', () => go('', tab: 1)),
                  _Item(Icons.receipt_long_outlined, 'Mes paiements', () => go('/payments')),
                  _Item(Icons.star_outline_rounded, 'Mes avis', () => go('/my-reviews')),
                  _Item(Icons.favorite_border, 'Mes favoris', () => go('/favorites')),
                  if (!auth.isProviderMode) ...[
                    _Item(Icons.apartment, 'Mes biens immobiliers', () => go('/properties')),
                    _Item(Icons.business_center_outlined, 'Compte entreprise', () => go('/business')),
                  ],
                  if (auth.isProviderMode) ...[
                    _Item(Icons.account_balance_wallet_outlined, 'Mon portefeuille',
                        () => go('/provider-mode/wallet')),
                    _Item(Icons.request_quote_outlined, 'Appels d’offres', () => go('/tenders')),
                    _Item(Icons.handshake_outlined, 'Proposer une mission',
                        () => go('/provider-mode/propose')),
                    _Item(Icons.handyman_outlined, 'Ce que je sais faire',
                        () => go('/provider-mode/skills')),
                    _Item(Icons.workspace_premium_outlined, 'Tasko Pro & Boost',
                        () => go('/provider-mode/offers')),
                  ],
                  _Item(Icons.notifications_none, 'Notifications', () => go('/notifications')),
                  _Item(Icons.settings_outlined, 'Paramètres', () => go('/settings')),
                  _Item(Icons.help_outline, 'Aide', () => go('/help')),
                  _Item(Icons.lightbulb_outline, 'À propos / Vision', () => go('/about')),
                  const Divider(color: Colors.white12, indent: 20, endIndent: 20),
                  _Item(Icons.logout, 'Déconnexion', () {
                    Navigator.of(context).pop();
                    ref.read(authProvider.notifier).logout();
                    context.go('/');
                  }),
                ],
              ),
            ),
            const Padding(
              padding: EdgeInsets.all(20),
              child: TaskoLogo(size: 24, textColor: Colors.white),
            ),
          ],
        ),
      ),
    );
  }
}

class _Item extends StatelessWidget {
  const _Item(this.icon, this.label, this.onTap);
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: Colors.white),
      title: Text(label, style: const TextStyle(color: Colors.white, fontSize: 14.5)),
      onTap: onTap,
      minTileHeight: 48,
      contentPadding: const EdgeInsets.symmetric(horizontal: 24),
    );
  }
}
