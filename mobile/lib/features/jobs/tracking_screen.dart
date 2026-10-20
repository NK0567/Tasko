import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../core/formatters.dart';
import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../models/job_rules.dart';
import '../../models/json.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/map_widgets.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import '../chat/chat_actions.dart';
import 'job_common.dart';
import 'job_sheets.dart';

/// Écran 8 — Suivi en temps réel côté client : code de démarrage, règles
/// d'annulation, prestataire absent.
class TrackingScreen extends ConsumerStatefulWidget {
  const TrackingScreen({super.key, required this.jobId});
  final String jobId;

  @override
  ConsumerState<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends ConsumerState<TrackingScreen>
    with JobSubscription<TrackingScreen> {
  final _map = MapController();
  LatLng? _providerPos;
  int? _etaMin;
  double? _distanceKm;
  bool _fitted = false;
  bool _busy = false;

  @override
  String get jobId => widget.jobId;

  @override
  void initState() {
    super.initState();
    initJobSubscription();
    listenSocket('provider:location', (data) {
      if (asString(data['job_id']) != widget.jobId) return;
      final lat = asDoubleOrNull(data['lat']);
      final lng = asDoubleOrNull(data['lng']);
      if (lat == null || lng == null) return;
      setState(() {
        _providerPos = LatLng(lat, lng);
        _etaMin = asIntOrNull(data['eta_min']) ?? _etaMin;
        _distanceKm = asDoubleOrNull(data['distance_km']) ?? _distanceKm;
      });
    });
  }

  @override
  void dispose() {
    disposeJobSubscription();
    super.dispose();
  }

  @override
  void onJobChanged(Job job) {
    if (_providerPos == null && job.provider?.lat != null && job.provider?.lng != null) {
      setState(() => _providerPos = LatLng(job.provider!.lat!, job.provider!.lng!));
    }
  }

  LatLng? get _dest => job?.lat == null || job?.lng == null ? null : LatLng(job!.lat!, job!.lng!);

  void _fit() {
    final dest = _dest;
    final prov = _providerPos;
    if (dest == null) return;
    try {
      if (prov == null) {
        _map.move(dest, 15);
      } else {
        _map.fitCamera(CameraFit.coordinates(
          coordinates: [dest, prov],
          padding: const EdgeInsets.all(60),
          maxZoom: 16,
        ));
      }
      _fitted = true;
    } catch (_) {}
  }

  Future<void> _cancel(Job current) async {
    final policy = clientCancellationPolicy(
      current,
      feeEnRoute: ref.read(settingsValueProvider).cancellationFeeEnRoute,
    );
    if (!policy.canCancel) {
      showSnack(context, policy.description, error: true);
      return;
    }
    final reason = await showCancelSheet(context, policy);
    if (reason == null || !mounted || _busy) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).cancelJob(current.id, reason: reason.isEmpty ? null : reason);
      if (!mounted) return;
      showSnack(
        context,
        policy.kind == CancelKind.fee
            ? 'Mission annulée. Vous êtes remboursé de ${formatMoney(current.clientTotal - policy.fee)}.'
            : 'Mission annulée. Votre remboursement est en cours.',
      );
      context.go('/home');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reportNoShow(Job current) async {
    final hours = ref.read(settingsValueProvider).noShowResponseHours;
    final ok = await confirmAction(
      context,
      title: 'Le prestataire n’est pas venu ?',
      message: 'Nous prévenons le prestataire. Il a $hours h pour répondre. '
          'Sans réponse, vous êtes remboursé automatiquement.\n\n'
          'L’argent reste bloqué chez Tasko : ni le client ni le prestataire ne peuvent le récupérer seuls.',
      confirmLabel: 'Signaler son absence',
      danger: true,
    );
    if (!ok || !mounted || _busy) return;
    setState(() => _busy = true);
    try {
      final j = await ref.read(apiProvider).reportNoShow(current.id);
      if (!mounted) return;
      setState(() => job = j);
      showSnack(context, 'Absence signalée. Un médiateur Tasko suit votre dossier.');
      if (j.dispute != null) context.push('/disputes/${j.dispute!.id}');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = jobStateView();
    final j = job;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ma mission'),
        actions: [
          if (j != null)
            PopupMenuButton<String>(
              tooltip: 'Plus d’options',
              onSelected: (v) {
                if (v == 'details') context.push('/jobs/${j.id}');
                if (v == 'dispute') context.push('/jobs/${j.id}/dispute');
              },
              itemBuilder: (_) => [
                const PopupMenuItem(
                  value: 'details',
                  child: ListTile(leading: Icon(Icons.info_outline), title: Text('Détails')),
                ),
                if (canOpenDispute(j))
                  const PopupMenuItem(
                    value: 'dispute',
                    child: ListTile(
                      leading: Icon(Icons.report_problem_outlined, color: TaskoColors.danger),
                      title: Text('Signaler un problème'),
                    ),
                  ),
              ],
            ),
        ],
      ),
      body: state ?? _buildBody(j!),
    );
  }

  Widget _buildBody(Job job) {
    final dest = _dest ?? const LatLng(3.8480, 11.5021);
    final prov = _providerPos;
    final distance = _distanceKm ?? (prov == null ? null : LocationService.distanceKm(prov, dest));
    final eta = _etaMin ?? (distance == null ? null : (distance / 20 * 60).ceil() + 2);
    final provider = job.provider;
    final policy = clientCancellationPolicy(
      job,
      feeEnRoute: ref.watch(settingsValueProvider).cancellationFeeEnRoute,
    );
    final arrivalNotice = arrivalDeadlineNotice(job);
    final showNoShow = noShowButtonVisible(job);
    final showCode = job.startCode != null &&
        {JobStatus.funded, JobStatus.enRoute, JobStatus.arrived}.contains(job.status);

    if (!_fitted) WidgetsBinding.instance.addPostFrameCallback((_) => _fit());

    return Column(
      children: [
        SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.28,
          child: Stack(
            children: [
              FlutterMap(
                mapController: _map,
                options: MapOptions(initialCenter: dest, initialZoom: 14),
                children: [
                  osmTileLayer(),
                  if (prov != null)
                    PolylineLayer(polylines: [
                      Polyline(
                        points: [prov, dest],
                        color: TaskoColors.info,
                        strokeWidth: 4.5,
                        pattern: StrokePattern.dashed(segments: const [12, 8]),
                      ),
                    ]),
                  MarkerLayer(markers: [
                    Marker(
                      point: dest,
                      width: 44,
                      height: 44,
                      alignment: Alignment.topCenter,
                      child: const DestinationPin(size: 44),
                    ),
                    if (prov != null && provider != null)
                      Marker(
                        point: prov,
                        width: 56,
                        height: 60,
                        alignment: Alignment.topCenter,
                        child: AvatarPin(name: provider.fullName, url: provider.avatarUrl),
                      ),
                  ]),
                  osmAttribution(),
                ],
              ),
              Positioned(
                right: 12,
                top: 12,
                child: FloatingActionButton.small(
                  heroTag: 'fit',
                  tooltip: 'Recentrer la carte',
                  backgroundColor: Colors.white,
                  foregroundColor: TaskoColors.primary,
                  onPressed: _fit,
                  child: const Icon(Icons.center_focus_strong),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => loadJob(silent: true),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
              children: [
                if (provider != null) ...[
                  Row(
                    children: [
                      TaskoAvatar(name: provider.fullName, url: provider.avatarUrl, size: 50),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(provider.fullName,
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                            Text(provider.headline ?? job.category.name,
                                style: const TextStyle(fontSize: 14, color: TaskoColors.textMuted)),
                            Text(
                              _statusLine(job.status, distance, eta),
                              style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: TaskoColors.primary),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () =>
                              openChatWith(context, ref, userId: provider.id, jobId: job.id),
                          icon: const Icon(Icons.chat_bubble_outline),
                          label: const Text('Message'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(child: CallButton(phone: provider.phone)),
                    ],
                  ),
                  const SizedBox(height: 14),
                ],
                JobProgressBar(status: job.status),
                const SizedBox(height: 14),
                NextStepCard(job: job, asProvider: false),
                if (showCode) ...[
                  const SizedBox(height: 12),
                  StartCodeCard(code: job.startCode!),
                ],
                if (arrivalNotice != null) ...[
                  const SizedBox(height: 12),
                  InfoBox(icon: Icons.schedule, text: arrivalNotice),
                ],
                if (showNoShow) ...[
                  const SizedBox(height: 12),
                  InfoBox(
                    icon: Icons.person_off_outlined,
                    color: StatusColors.problem,
                    title: 'Le prestataire n’est toujours pas là ?',
                    text: 'Signalez-le : il a ${ref.watch(settingsValueProvider).noShowResponseHours} h pour répondre, '
                        'sinon vous êtes remboursé automatiquement.',
                  ),
                  const SizedBox(height: 8),
                  TaskoButton(
                    label: 'Le prestataire n’est pas venu',
                    icon: Icons.person_off_outlined,
                    variant: TaskoButtonVariant.danger,
                    loading: _busy,
                    onPressed: () => _reportNoShow(job),
                  ),
                ],
                if (job.status == JobStatus.funded || job.status == JobStatus.enRoute) ...[
                  const SizedBox(height: 12),
                  const InfoBox(
                    icon: Icons.lock_outline,
                    text: 'Votre argent est bloqué en sécurité chez Tasko. '
                        'Le prestataire ne sera payé qu’à la fin, après votre validation.',
                  ),
                ],
                if (job.hasMilestones) ...[
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => context.push('/jobs/${job.id}/milestones'),
                    icon: const Icon(Icons.format_list_numbered),
                    label: const Text('Voir les étapes de paiement'),
                  ),
                ],
                if (policy.kind != CancelKind.none) ...[
                  const SizedBox(height: 16),
                  CancellationPolicyCard(policy: policy),
                  if (policy.canCancel)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: _busy ? null : () => _cancel(job),
                        style: TextButton.styleFrom(
                          foregroundColor: TaskoColors.danger,
                          minimumSize: const Size(48, 48),
                        ),
                        icon: const Icon(Icons.cancel_outlined),
                        label: const Text('Annuler la mission'),
                      ),
                    ),
                ],
                const SizedBox(height: 12),
                AmountSummary(
                  price: job.effectivePrice,
                  serviceFee: job.serviceFee,
                  total: job.clientTotal,
                  providerReceives: job.payout,
                ),
              ],
            ),
          ),
        ),
        if (_primary(job) != null) BottomActionBar(children: [_primary(job)!]),
      ],
    );
  }

  Widget? _primary(Job job) {
    switch (job.status) {
      case JobStatus.done:
        return TaskoButton(
          label: 'Vérifier et payer le prestataire',
          icon: Icons.verified,
          onPressed: () => context.pushReplacement('/jobs/${job.id}/done'),
        );
      case JobStatus.disputed:
        if (job.dispute == null) return null;
        return TaskoButton(
          label: 'Ouvrir le salon de médiation',
          icon: Icons.forum_outlined,
          onPressed: () => context.push('/disputes/${job.dispute!.id}'),
        );
      case JobStatus.completed:
      case JobStatus.cancelled:
        return TaskoButton(
          label: 'Voir le récapitulatif',
          icon: Icons.receipt_long_outlined,
          variant: TaskoButtonVariant.light,
          onPressed: () => context.pushReplacement('/jobs/${job.id}'),
        );
      default:
        return null;
    }
  }

  String _statusLine(String status, double? distance, int? eta) => switch (status) {
        JobStatus.funded => 'Va bientôt partir',
        JobStatus.enRoute =>
          'En route vers vous${distance == null ? '' : ' · ${formatDistance(distance)}'}${eta == null ? '' : ' · $eta min'}',
        JobStatus.arrived => 'Est arrivé chez vous',
        JobStatus.inProgress => 'Travaille sur votre mission',
        JobStatus.done => 'A terminé la mission',
        _ => JobStatus.label(status),
      };
}
