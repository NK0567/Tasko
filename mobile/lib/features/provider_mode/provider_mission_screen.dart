import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../core/formatters.dart';
import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/socket_service.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../models/job_rules.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/map_widgets.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import '../chat/chat_actions.dart';
import '../jobs/job_common.dart';
import '../jobs/job_sheets.dart';

/// Mission côté prestataire : garantie de paiement, progression, code de
/// démarrage, preuves de fin et diffusion de la position.
class ProviderMissionScreen extends ConsumerStatefulWidget {
  const ProviderMissionScreen({super.key, required this.jobId});
  final String jobId;

  @override
  ConsumerState<ProviderMissionScreen> createState() => _ProviderMissionScreenState();
}

class _ProviderMissionScreenState extends ConsumerState<ProviderMissionScreen>
    with JobSubscription<ProviderMissionScreen> {
  final _map = MapController();
  LatLng? _myPos;
  StreamSubscription<LatLng>? _gpsSub;
  Timer? _sendTimer;
  Timer? _simTimer;
  bool _simulated = false;
  double _simProgress = 0;
  LatLng? _simStart;
  bool _updating = false;

  @override
  String get jobId => widget.jobId;

  @override
  void initState() {
    super.initState();
    initJobSubscription();
    _startLocation();
  }

  @override
  void dispose() {
    _gpsSub?.cancel();
    _sendTimer?.cancel();
    _simTimer?.cancel();
    disposeJobSubscription();
    super.dispose();
  }

  LatLng? get _dest => job?.lat == null || job?.lng == null ? null : LatLng(job!.lat!, job!.lng!);

  bool get _shouldBroadcast =>
      job != null &&
      job!.fundsSecured &&
      {JobStatus.funded, JobStatus.enRoute, JobStatus.arrived, JobStatus.inProgress}
          .contains(job!.status);

  /// GPS réel si disponible ; sinon (web / pas de GPS) simulation de trajet vers le client.
  Future<void> _startLocation() async {
    final stream = kIsWeb ? null : await LocationService.stream();
    if (stream != null) {
      final first = await LocationService.current();
      if (!mounted) return;
      if (!first.isFallback) {
        setState(() => _myPos = first.latLng);
        _gpsSub = stream.listen((p) {
          if (mounted) setState(() => _myPos = p);
        });
        _sendTimer = Timer.periodic(const Duration(seconds: 5), (_) => _broadcast());
        return;
      }
    }
    if (!mounted) return;
    _simulated = true;
    _simTimer = Timer.periodic(const Duration(seconds: 3), (_) => _simulateStep());
  }

  void _simulateStep() {
    final dest = _dest;
    if (dest == null || job == null || !mounted) return;
    _simStart ??= LatLng(dest.latitude + 0.013, dest.longitude - 0.012);
    final status = job!.status;
    if (status == JobStatus.enRoute) {
      _simProgress = (_simProgress + 0.06).clamp(0.0, 0.97);
    } else if (status == JobStatus.arrived ||
        status == JobStatus.inProgress ||
        status == JobStatus.done) {
      _simProgress = 1;
    }
    setState(() => _myPos = LocationService.interpolate(_simStart!, dest, _simProgress));
    _broadcast();
  }

  void _broadcast() {
    final p = _myPos;
    if (p == null || !_shouldBroadcast) return;
    SocketService.instance.sendLocation(p.latitude, p.longitude);
  }

  Future<void> _advance(Job current, String next) async {
    if (_updating) return;
    final api = ref.read(apiProvider);
    if (next == JobStatus.inProgress && ref.read(settingsValueProvider).requireStartCode) {
      final ok = await showStartCodeSheet(context, onSubmit: (code) async {
        try {
          final j = await api.updateJobStatus(current.id, next, startCode: code);
          if (mounted) setState(() => job = j);
          return null;
        } catch (e) {
          return errorMessage(e);
        }
      });
      if (ok && mounted) showSnack(context, 'Code correct : la mission commence. Bon travail !');
      return;
    }
    FinishResult? proof;
    if (next == JobStatus.done) {
      proof = await showFinishSheet(context);
      if (proof == null) return;
    }
    if (!mounted) return;
    setState(() => _updating = true);
    try {
      final j = await api.updateJobStatus(
        current.id,
        next,
        proofPhotos: proof?.photos,
        note: proof?.note,
      );
      if (!mounted) return;
      setState(() => job = j);
      _broadcast();
      showSnack(
        context,
        switch (next) {
          JobStatus.enRoute => 'Le client sait que vous arrivez.',
          JobStatus.arrived => 'Le client est prévenu de votre arrivée.',
          JobStatus.done => 'Bravo ! Le client va vérifier votre travail.',
          _ => 'Statut mis à jour.',
        },
      );
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  Future<void> _cancel(Job current) async {
    final policy = providerCancellationPolicy(current);
    if (!policy.canCancel) {
      showSnack(context, policy.description, error: true);
      return;
    }
    final reason = await showCancelSheet(context, policy, confirmLabel: 'Oui, je me retire');
    if (reason == null || !mounted) return;
    setState(() => _updating = true);
    try {
      await ref.read(apiProvider).cancelJob(current.id, reason: reason.isEmpty ? null : reason);
      if (!mounted) return;
      showSnack(context, 'Mission annulée. Le client est remboursé.');
      context.go('/home');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  void _fit() {
    final dest = _dest;
    if (dest == null) return;
    try {
      if (_myPos == null) {
        _map.move(dest, 15);
      } else {
        _map.fitCamera(CameraFit.coordinates(
          coordinates: [dest, _myPos!],
          padding: const EdgeInsets.all(60),
          maxZoom: 16,
        ));
      }
    } catch (_) {}
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
                switch (v) {
                  case 'details':
                    context.push('/jobs/${j.id}');
                  case 'cancel':
                    _cancel(j);
                  case 'dispute':
                    context.push('/jobs/${j.id}/dispute');
                }
              },
              itemBuilder: (_) => [
                const PopupMenuItem(
                  value: 'details',
                  child: ListTile(leading: Icon(Icons.info_outline), title: Text('Détails')),
                ),
                if (providerCancellationPolicy(j).canCancel)
                  const PopupMenuItem(
                    value: 'cancel',
                    child: ListTile(
                      leading: Icon(Icons.cancel_outlined, color: TaskoColors.danger),
                      title: Text('Annuler la mission'),
                    ),
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
    final distance = _myPos == null ? null : LocationService.distanceKm(_myPos!, dest);
    final eta = distance == null ? null : (distance / 20 * 60).ceil() + 2;
    final showMap = !{JobStatus.completed, JobStatus.cancelled}.contains(job.status);

    return Column(
      children: [
        if (showMap)
          SizedBox(
            height: MediaQuery.sizeOf(context).height * 0.28,
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _map,
                  options: MapOptions(initialCenter: dest, initialZoom: 14, onMapReady: _fit),
                  children: [
                    osmTileLayer(),
                    if (_myPos != null)
                      PolylineLayer(polylines: [
                        Polyline(
                          points: [_myPos!, dest],
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
                      if (_myPos != null)
                        Marker(point: _myPos!, width: 44, height: 44, child: const MyPositionDot()),
                    ]),
                    osmAttribution(),
                  ],
                ),
                Positioned(
                  right: 12,
                  top: 12,
                  child: FloatingActionButton.small(
                    heroTag: 'fit-provider',
                    tooltip: 'Recentrer la carte',
                    backgroundColor: Colors.white,
                    foregroundColor: TaskoColors.primary,
                    onPressed: _fit,
                    child: const Icon(Icons.center_focus_strong),
                  ),
                ),
                if (_simulated && _shouldBroadcast)
                  Positioned(
                    left: 12,
                    top: 12,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: TaskoColors.accent,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: const Text('Démo : déplacement simulé',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
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
                _ClientHeader(job: job, distance: distance, eta: eta),
                const SizedBox(height: 14),
                JobProgressBar(status: job.status),
                const SizedBox(height: 14),
                NextStepCard(job: job, asProvider: true),
                const SizedBox(height: 12),
                ..._guarantee(job),
                if (job.client.trust != null && job.status == JobStatus.accepted) ...[
                  const SizedBox(height: 12),
                  ClientTrustCard(trust: job.client.trust!, name: job.client.fullName),
                ],
                if (job.hasMilestones) ...[
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => context.push('/jobs/${job.id}/milestones'),
                    icon: const Icon(Icons.format_list_numbered),
                    label: Text('Voir les ${job.milestones.length} étapes de paiement'),
                  ),
                ],
                const SizedBox(height: 12),
                AmountSummary(
                  price: job.effectivePrice,
                  serviceFee: job.serviceFee,
                  total: job.clientTotal,
                  providerReceives: job.payout,
                  asProvider: true,
                ),
              ],
            ),
          ),
        ),
        BottomActionBar(children: [_primaryAction(job)]),
      ],
    );
  }

  /// Bloc « garantie de paiement » selon l'état.
  List<Widget> _guarantee(Job job) {
    final s = job.status;
    if (s == JobStatus.accepted ||
        (!job.fundsSecured && JobStatus.nextProviderStatus(s) != null)) {
      return const [
        InfoBox(
          icon: Icons.hourglass_top_rounded,
          color: StatusColors.waiting,
          title: 'En attente du paiement sécurisé du client',
          text: 'Ne partez pas encore. Dès que le client a payé, l’argent est bloqué chez Tasko '
              'et vous êtes prévenu.',
        ),
      ];
    }
    if (job.fundsSecured &&
        {JobStatus.funded, JobStatus.enRoute, JobStatus.arrived, JobStatus.inProgress}.contains(s)) {
      final current = job.currentMilestone;
      return [
        SecuredFundsBanner(
          amount: job.securedAmount,
          milestoneLabel: current == null
              ? null
              : 'Étape ${job.milestoneIndex(current)}/${job.milestones.length}',
        ),
      ];
    }
    if (s == JobStatus.done) {
      return [
        if (job.autoReleaseAt != null)
          AutoReleaseCard(releaseAt: job.autoReleaseAt!, forProvider: true)
        else
          const InfoBox(
            icon: Icons.timer_outlined,
            text: 'Le client vérifie votre travail. Sans réponse de sa part, vous serez payé automatiquement.',
          ),
        if (job.completionProof != null && job.completionProof!.photos.isNotEmpty) ...[
          const SizedBox(height: 10),
          const Text('Vos photos de preuve', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          ProofPhotosGrid(urls: job.completionProof!.photos),
        ],
      ];
    }
    if (s == JobStatus.completed) {
      return [
        InfoBox(
          icon: Icons.celebration_outlined,
          title: 'Vous avez été payé',
          text: '${formatMoney(job.payout)} versés sur votre Mobile Money'
              '${job.completedBy == 'auto' ? ' (libération automatique)' : ''}.',
        ),
      ];
    }
    if (s == JobStatus.disputed && job.dispute != null && job.dispute!.isNoShow && job.dispute!.isOpen) {
      final before = job.dispute!.respondBefore;
      return [
        InfoBox(
          icon: Icons.notification_important_outlined,
          color: StatusColors.problem,
          title: before == null
              ? 'Le client signale votre absence — répondez vite'
              : 'Le client signale votre absence — répondez avant ${formatShortDateTime(before)}',
          text: 'Expliquez-vous dans le salon de médiation. Sans réponse, le client est remboursé '
              'automatiquement. L’argent reste bloqué chez Tasko : ni le client ni le prestataire '
              'ne peuvent le récupérer seuls.',
        ),
      ];
    }
    if (s == JobStatus.disputed) {
      return const [
        InfoBox(
          icon: Icons.gavel_rounded,
          color: StatusColors.problem,
          title: 'Litige en cours',
          text: 'L’argent reste bloqué chez Tasko : ni le client ni le prestataire ne peuvent le récupérer seuls.',
        ),
      ];
    }
    if (s == JobStatus.cancelled) {
      final parts = [
        if (job.cancelReason != null) 'Motif : ${job.cancelReason}.',
        if (job.cancellationFee > 0)
          'Vous recevez ${formatMoney(job.cancellationFee)} de frais de déplacement.',
      ];
      return [
        InfoBox(
          icon: Icons.cancel_outlined,
          color: StatusColors.closed,
          title: 'Mission annulée',
          text: parts.isEmpty ? 'Cette mission a été annulée.' : parts.join(' '),
        ),
      ];
    }
    return const [];
  }

  Widget _primaryAction(Job job) {
    final s = job.status;
    final next = JobStatus.nextProviderStatus(s);
    if (s == JobStatus.accepted || (next != null && !providerCanStart(job))) {
      return const TaskoButton(
        label: 'Je pars chez le client',
        icon: Icons.lock_clock,
        onPressed: null,
      );
    }
    if (next == JobStatus.done && job.hasMilestones) {
      return TaskoButton(
        label: 'Déclarer une étape terminée',
        icon: Icons.format_list_numbered,
        onPressed: () => context.push('/jobs/${job.id}/milestones'),
      );
    }
    if (next != null) {
      return TaskoButton(
        label: JobStatus.providerActionLabel(next),
        icon: switch (next) {
          JobStatus.enRoute => Icons.directions_run,
          JobStatus.arrived => Icons.place,
          JobStatus.inProgress => Icons.pin_outlined,
          _ => Icons.check_circle,
        },
        loading: _updating,
        onPressed: () => _advance(job, next),
      );
    }
    if (s == JobStatus.disputed && job.dispute != null) {
      return TaskoButton(
        label: 'Ouvrir le salon de médiation',
        icon: Icons.forum_outlined,
        onPressed: () => context.push('/disputes/${job.dispute!.id}'),
      );
    }
    if (s == JobStatus.completed) {
      return TaskoButton(
        label: 'Voir le reçu',
        icon: Icons.receipt_long_outlined,
        variant: TaskoButtonVariant.outline,
        onPressed: () => context.push('/jobs/${job.id}/receipt'),
      );
    }
    return TaskoButton(
      label: 'Retour au tableau de bord',
      icon: Icons.dashboard_outlined,
      variant: TaskoButtonVariant.light,
      onPressed: () => context.go('/home'),
    );
  }
}

class _ClientHeader extends ConsumerWidget {
  const _ClientHeader({required this.job, this.distance, this.eta});
  final Job job;
  final double? distance;
  final int? eta;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            TaskoAvatar(name: job.client.fullName, url: job.client.avatarUrl, size: 48),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(job.client.fullName,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                  Text(job.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 14, color: TaskoColors.textMuted)),
                  Text(
                    [
                      if (job.address.isNotEmpty) job.address,
                      if (distance != null) formatDistance(distance),
                      if (eta != null && job.status == JobStatus.enRoute) '$eta min',
                    ].join(' · '),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13, color: TaskoColors.primary),
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
                onPressed: () => openChatWith(context, ref, userId: job.client.id, jobId: job.id),
                icon: const Icon(Icons.chat_bubble_outline),
                label: const Text('Message'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(child: CallButton(phone: job.client.phone)),
          ],
        ),
      ],
    );
  }
}
