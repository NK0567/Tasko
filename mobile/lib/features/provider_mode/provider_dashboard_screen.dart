import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/icon_map.dart';
import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/socket_service.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../models/transaction.dart';
import '../../models/json.dart';
import '../../models/notification.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/ux.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/tasko_logo.dart';
import '../home/shell_widgets.dart';
import '../jobs/job_common.dart';
import '../jobs/my_jobs_screen.dart';

final earningsProvider =
    FutureProvider.autoDispose<Earnings>((ref) => ref.watch(apiProvider).earnings());

final nearbyJobsProvider = FutureProvider.autoDispose<List<Job>>((ref) async {
  final pos = await ref.watch(positionProvider.future);
  return ref.watch(apiProvider).nearbyJobs(lat: pos.lat, lng: pos.lng);
});

/// Tableau de bord prestataire.
class ProviderDashboardScreen extends ConsumerStatefulWidget {
  const ProviderDashboardScreen({super.key});

  @override
  ConsumerState<ProviderDashboardScreen> createState() => _ProviderDashboardScreenState();
}

class _ProviderDashboardScreenState extends ConsumerState<ProviderDashboardScreen> {
  StreamSubscription<dynamic>? _newJobSub;
  StreamSubscription<dynamic>? _updatedSub;
  StreamSubscription<dynamic>? _closedSub;
  StreamSubscription<dynamic>? _reconnectSub;
  StreamSubscription<dynamic>? _noShowSub;
  bool _toggling = false;
  bool _popupOpen = false;
  Timer? _locationTimer;

  @override
  void initState() {
    super.initState();
    _newJobSub = SocketService.instance.on('job:new').listen((data) {
      if (!mounted) return;
      ref.invalidate(nearbyJobsProvider);
      _showNewJobPopup(Job.fromJson(data));
    });
    _updatedSub = SocketService.instance.on('job:updated').listen((_) {
      if (!mounted) return;
      ref.invalidate(nearbyJobsProvider);
      ref.invalidate(jobsListProvider);
      ref.invalidate(earningsProvider);
    });
    // Mission attribuée à un autre / annulée : elle disparaît des demandes proches.
    _closedSub = SocketService.instance.on('job:closed').listen((_) {
      if (mounted) ref.invalidate(nearbyJobsProvider);
    });
    // Alerte urgente : le client signale l'absence du prestataire (RG-G11).
    _noShowSub = SocketService.instance.on('notification:new').listen((data) {
      if (!mounted) return;
      final n = AppNotification.fromJson(data);
      final noShow = asString(n.data['kind']) == 'no_show' ||
          n.title.toLowerCase().contains('absence');
      if (n.disputeId != null && noShow) _showNoShowAlert(n);
    });
    // Après une coupure : resynchronisation complète.
    _reconnectSub = SocketService.instance.reconnected.listen((_) {
      if (!mounted) return;
      ref.invalidate(nearbyJobsProvider);
      ref.invalidate(jobsListProvider);
      ref.invalidate(earningsProvider);
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncLocationTimer());
  }

  @override
  void dispose() {
    _newJobSub?.cancel();
    _updatedSub?.cancel();
    _closedSub?.cancel();
    _reconnectSub?.cancel();
    _noShowSub?.cancel();
    _locationTimer?.cancel();
    super.dispose();
  }

  bool get _online => ref.read(authProvider).user?.provider?.isOnline ?? false;

  /// En ligne : on publie la position toutes les 60 s pour le matching.
  void _syncLocationTimer() {
    _locationTimer?.cancel();
    if (!_online) return;
    _publishLocation();
    _locationTimer = Timer.periodic(const Duration(seconds: 60), (_) => _publishLocation());
  }

  Future<void> _publishLocation() async {
    try {
      final pos = await LocationService.current();
      await ref.read(apiProvider).sendLocation(pos.lat, pos.lng);
    } catch (_) {}
  }

  Future<void> _toggleOnline(bool value) async {
    setState(() => _toggling = true);
    try {
      if (value) await _publishLocation();
      final user = await ref.read(apiProvider).setOnline(value);
      ref.read(authProvider.notifier).setUser(user);
      _syncLocationTimer();
      ref.invalidate(nearbyJobsProvider);
      if (mounted) {
        showSnack(context, value ? 'Vous êtes en ligne : les missions arrivent !' : 'Vous êtes hors ligne.');
      }
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _toggling = false);
    }
  }

  final Set<String> _accepting = {};

  Future<void> _accept(Job job) async {
    if (_accepting.contains(job.id)) return; // anti double-tap
    setState(() => _accepting.add(job.id));
    try {
      final j = await ref.read(apiProvider).acceptJob(job.id, price: job.budget);
      ref.invalidate(nearbyJobsProvider);
      ref.invalidate(jobsListProvider);
      if (mounted) {
        showSnack(context, 'Mission acceptée ! Attendez le paiement du client avant de partir.');
        context.push(jobRouteFor(j, asProvider: true));
      }
    } catch (e) {
      if (isAlreadyAssigned(e)) ref.invalidate(nearbyJobsProvider);
      if (mounted) showSnack(context, acceptErrorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _accepting.remove(job.id));
    }
  }

  Future<void> _decline(Job job) async {
    try {
      await ref.read(apiProvider).declineJob(job.id);
      ref.invalidate(nearbyJobsProvider);
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    }
  }

  Future<void> _showNoShowAlert(AppNotification n) async {
    final open = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.notification_important, color: TaskoColors.danger, size: 40),
        title: const Text('Le client signale votre absence'),
        content: Text(
          '${n.body.isEmpty ? '' : '${n.body}\n\n'}Répondez vite dans le salon de médiation : '
          'sans réponse, le client sera remboursé automatiquement.',
          style: const TextStyle(fontSize: 15, height: 1.4),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Plus tard')),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: TaskoColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            icon: const Icon(Icons.forum_outlined),
            label: const Text('Répondre maintenant'),
          ),
        ],
      ),
    );
    if (open == true && mounted) context.push('/disputes/${n.disputeId}');
  }

  Future<void> _showNewJobPopup(Job job) async {
    if (_popupOpen) return;
    _popupOpen = true;
    final result = await showDialog<NewJobChoice>(
      context: context,
      builder: (ctx) => NewJobDialog(job: job),
    );
    _popupOpen = false;
    if (!mounted) return;
    switch (result) {
      case NewJobChoice.accept:
        await _accept(job);
      case NewJobChoice.decline:
        await _decline(job);
      case NewJobChoice.closed:
        ref.invalidate(nearbyJobsProvider);
        showSnack(context, 'Mission déjà attribuée à un autre prestataire.');
      case null:
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    final online = user?.provider?.isOnline ?? false;
    final earnings = ref.watch(earningsProvider);
    final nearby = ref.watch(nearbyJobsProvider);
    final active = ref.watch(jobsListProvider((as: 'provider', status: 'active')));

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(earningsProvider);
            ref.invalidate(nearbyJobsProvider);
            ref.invalidate(jobsListProvider);
            await ref.read(authProvider.notifier).refreshMe();
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              const Row(
                children: [
                  MenuButton(),
                  TaskoLogo(size: 28),
                  SizedBox(width: 8),
                  _ProBadge(),
                  Spacer(),
                  NotificationBell(),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                'Bonjour ${user?.fullName.split(' ').first ?? ''}',
                style: const TextStyle(
                    fontSize: 20, fontWeight: FontWeight.w700, color: TaskoColors.primaryDark),
              ),
              const SizedBox(height: 12),
              const TipBanner(
                id: 'provider.online',
                text: 'Touchez l’interrupteur pour passer en ligne et recevoir les missions proches.',
              ),
              _OnlineSwitch(online: online, loading: _toggling, onChanged: _toggleOnline),
              const SizedBox(height: 12),
              const _QuickActions(),
              const SizedBox(height: 16),
              earnings.when(
                data: (e) => _EarningsRow(earnings: e),
                loading: () => const SizedBox(height: 96, child: LoadingView()),
                error: (e, _) => ErrorView(
                  compact: true,
                  error: e,
                  onRetry: () => ref.invalidate(earningsProvider),
                ),
              ),
              const SizedBox(height: 20),
              active.when(
                data: (list) => list.isEmpty
                    ? const SizedBox.shrink()
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SectionHeader(title: 'Mes missions actives'),
                          const SizedBox(height: 8),
                          for (final j in list)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: JobCard(
                                job: j,
                                asProvider: true,
                                onTap: () => context.push(jobRouteFor(j, asProvider: true)),
                              ),
                            ),
                          const SizedBox(height: 10),
                        ],
                      ),
                loading: () => const SizedBox.shrink(),
                error: (_, _) => const SizedBox.shrink(),
              ),
              SectionHeader(
                title: 'Demandes à proximité',
                action: 'Actualiser',
                onAction: () => ref.invalidate(nearbyJobsProvider),
              ),
              const SizedBox(height: 8),
              if (!online)
                const EmptyView(
                  compact: true,
                  title: 'Vous êtes hors ligne',
                  message: 'Passez en ligne pour recevoir les nouvelles demandes en temps réel.',
                )
              else
                nearby.when(
                  data: (list) => list.isEmpty
                      ? const EmptyView(
                          compact: true,
                          title: 'Aucune demande pour le moment',
                          message: 'Restez en ligne : nous vous alertons dès qu’une mission arrive.',
                        )
                      : Column(
                          children: [
                            for (final j in list)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: JobCard(
                                  job: j,
                                  asProvider: true,
                                  onTap: () => context.push('/jobs/${j.id}'),
                                  trailing: Row(
                                    children: [
                                      Expanded(
                                        child: TaskoButton(
                                          label: 'Refuser',
                                          icon: Icons.close,
                                          height: 48,
                                          variant: TaskoButtonVariant.danger,
                                          onPressed: () => _decline(j),
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: TaskoButton(
                                          label: 'Accepter',
                                          icon: Icons.check,
                                          height: 48,
                                          loading: _accepting.contains(j.id),
                                          onPressed: () => _accept(j),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ),
                  loading: () => const SizedBox(height: 120, child: LoadingView()),
                  error: (e, _) => ErrorView(
                    compact: true,
                    error: e,
                    onRetry: () => ref.invalidate(nearbyJobsProvider),
                  ),
                ),
              const SizedBox(height: 16),
              _OffersBanner(onTap: () => context.push('/provider-mode/offers')),
              const SizedBox(height: 10),
              TaskoButton(
                label: 'Ce que je sais faire',
                variant: TaskoButtonVariant.light,
                icon: Icons.handyman_outlined,
                onPressed: () => context.push('/provider-mode/skills'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProBadge extends ConsumerWidget {
  const _ProBadge();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isPro = ref.watch(authProvider).user?.provider?.isPro ?? false;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: isPro ? TaskoColors.accent : TaskoColors.chip,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        isPro ? 'PRO' : 'Prestataire',
        style: const TextStyle(
            fontSize: 10.5, fontWeight: FontWeight.w700, color: TaskoColors.primaryDark),
      ),
    );
  }
}

class _OnlineSwitch extends StatelessWidget {
  const _OnlineSwitch({required this.online, required this.loading, required this.onChanged});
  final bool online;
  final bool loading;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: LinearGradient(
          colors: online
              ? [TaskoColors.primary, TaskoColors.primaryLight]
              : [const Color(0xFF5B6B63), const Color(0xFF7D8C84)],
        ),
      ),
      child: Row(
        children: [
          Icon(online ? Icons.wifi_tethering : Icons.wifi_tethering_off,
              color: Colors.white, size: 36),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  online ? 'En ligne' : 'Hors ligne',
                  style: const TextStyle(
                      color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700),
                ),
                Text(
                  online ? 'Vous recevez les demandes proches' : 'Activez pour recevoir des missions',
                  style: const TextStyle(color: Colors.white70, fontSize: 12.5),
                ),
              ],
            ),
          ),
          loading
              ? const SizedBox(
                  width: 28,
                  height: 28,
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3),
                )
              : Transform.scale(
                  scale: 1.35,
                  child: Switch(
                    value: online,
                    onChanged: onChanged,
                    activeThumbColor: TaskoColors.primary,
                    activeTrackColor: Colors.white,
                    inactiveThumbColor: Colors.white,
                    inactiveTrackColor: Colors.white24,
                  ),
                ),
        ],
      ),
    );
  }
}

class _EarningsRow extends StatelessWidget {
  const _EarningsRow({required this.earnings});
  final Earnings earnings;

  @override
  Widget build(BuildContext context) {
    Widget card(String label, int amount, IconData icon, Color color) => Expanded(
          child: TaskoCard(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, color: color, size: 22),
                const SizedBox(height: 8),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(formatMoney(amount),
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                ),
                Text(label, style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted)),
              ],
            ),
          ),
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Mes gains'),
        const SizedBox(height: 8),
        Row(
          children: [
            card('Bloqué (en cours)', earnings.balanceHeld, Icons.lock_clock, TaskoColors.warning),
            const SizedBox(width: 8),
            card('Ce mois', earnings.monthEarned, Icons.calendar_month, TaskoColors.primary),
            const SizedBox(width: 8),
            card('Total gagné', earnings.totalEarned, Icons.savings_outlined, TaskoColors.info),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          '${earnings.jobsCompleted} mission(s) terminée(s)',
          style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted),
        ),
      ],
    );
  }
}

class _OffersBanner extends StatelessWidget {
  const _OffersBanner({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TaskoCard(
      color: TaskoColors.primaryDark,
      onTap: onTap,
      child: const Row(
        children: [
          Icon(Icons.workspace_premium, color: TaskoColors.accent, size: 36),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Tasko Pro & Boost',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                Text('Plus de visibilité, plus de missions.',
                    style: TextStyle(color: Colors.white70, fontSize: 12.5)),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: Colors.white),
        ],
      ),
    );
  }
}

/// Choix dans la pop-up de nouvelle mission.
enum NewJobChoice { accept, decline, closed }

/// Pop-up « Nouvelle mission à proximité » ; se ferme seule à la réception de
/// `job:closed` (mission attribuée à un autre prestataire).
class NewJobDialog extends StatefulWidget {
  const NewJobDialog({super.key, required this.job});
  final Job job;

  @override
  State<NewJobDialog> createState() => _NewJobDialogState();
}

class _NewJobDialogState extends State<NewJobDialog> {
  StreamSubscription<dynamic>? _closed;

  @override
  void initState() {
    super.initState();
    _closed = SocketService.instance.on('job:closed').listen((data) {
      if (!mounted || asString(data['job_id']) != widget.job.id) return;
      Navigator.of(context).pop(NewJobChoice.closed);
    });
  }

  @override
  void dispose() {
    _closed?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final job = widget.job;
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: TaskoColors.accent.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.notifications_active_outlined, size: 16, color: TaskoColors.primaryDark),
                  SizedBox(width: 6),
                  Text('Nouvelle mission à proximité',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                ],
              ),
            ),
            const SizedBox(height: 16),
            CircleAvatar(
              radius: 32,
              backgroundColor: TaskoColors.chip,
              child: Icon(iconForKey(job.category.icon), color: TaskoColors.primary, size: 34),
            ),
            const SizedBox(height: 10),
            Text(job.category.name,
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            if (job.description.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(job.description,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: TaskoColors.textMuted)),
            ],
            const SizedBox(height: 12),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 14,
              runSpacing: 6,
              children: [
                if (job.distanceKm != null)
                  _Info(Icons.place_outlined, formatDistance(job.distanceKm)),
                _Info(Icons.bolt, Urgency.label(job.urgency)),
                _Info(Icons.payments_outlined, formatMoney(job.budget)),
              ],
            ),
            if (job.address.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(job.address,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted)),
            ],
            if (job.client.trust != null) ...[
              const SizedBox(height: 12),
              ClientTrustCard(trust: job.client.trust!, name: job.client.fullName),
            ],
            const SizedBox(height: 8),
            const Text(
              'Vous ne partirez qu’une fois que le client aura payé : votre paiement est garanti.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: TaskoColors.textMuted),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: TaskoButton(
                    label: 'Refuser',
                    icon: Icons.close,
                    variant: TaskoButtonVariant.danger,
                    onPressed: () => Navigator.pop(context, NewJobChoice.decline),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TaskoButton(
                    label: 'Accepter',
                    icon: Icons.check,
                    onPressed: () => Navigator.pop(context, NewJobChoice.accept),
                  ),
                ),
              ],
            ),
            TextButton(
              onPressed: () => Navigator.pop(context),
              style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
              child: const Text('Plus tard'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Info extends StatelessWidget {
  const _Info(this.icon, this.text);
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: TaskoColors.primary),
          const SizedBox(width: 3),
          Text(text, style: const TextStyle(fontWeight: FontWeight.w600)),
        ],
      );
}

/// Raccourcis prestataire : appels d'offres, portefeuille, proposer une mission.
class _QuickActions extends StatelessWidget {
  const _QuickActions();

  @override
  Widget build(BuildContext context) {
    Widget tile(IconData icon, String label, String route) => Expanded(
          child: Semantics(
            button: true,
            label: label,
            child: Material(
              color: TaskoColors.chip,
              borderRadius: BorderRadius.circular(14),
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () => context.push(route),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 76),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
                    child: ExcludeSemantics(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(icon, color: TaskoColors.primary),
                          const SizedBox(height: 4),
                          Text(label,
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
    return Row(
      children: [
        tile(Icons.request_quote_outlined, 'Appels d’offres', '/tenders'),
        const SizedBox(width: 8),
        tile(Icons.account_balance_wallet_outlined, 'Mon portefeuille', '/provider-mode/wallet'),
        const SizedBox(width: 8),
        tile(Icons.handshake_outlined, 'Proposer une mission', '/provider-mode/propose'),
      ],
    );
  }
}
