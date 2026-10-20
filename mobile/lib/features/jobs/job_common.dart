import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/socket_service.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../models/json.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/ux.dart';

/// Route à ouvrir pour une mission selon son statut et le rôle.
String jobRouteFor(Job job, {required bool asProvider}) {
  final id = job.id;
  if (job.status == JobStatus.disputed && job.dispute != null) {
    return '/disputes/${job.dispute!.id}';
  }
  if (asProvider) {
    if (job.isTender && job.status == JobStatus.requested) return '/tenders/$id';
    if (job.status == JobStatus.accepted || JobStatus.live.contains(job.status) ||
        job.status == JobStatus.done) {
      return '/provider-mode/mission/$id';
    }
    return '/jobs/$id';
  }
  if (job.hasMilestones &&
      (JobStatus.live.contains(job.status) || job.status == JobStatus.done)) {
    return '/jobs/$id/milestones';
  }
  return switch (job.status) {
    JobStatus.requested => job.isTender ? '/jobs/$id/tender' : '/jobs/$id/waiting',
    JobStatus.accepted => job.isProviderOffer ? '/jobs/$id/proposal' : '/jobs/$id/pay',
    JobStatus.funded || JobStatus.enRoute || JobStatus.arrived || JobStatus.inProgress =>
      '/jobs/$id/track',
    JobStatus.done => '/jobs/$id/done',
    _ => '/jobs/$id',
  };
}

/// Ouvre une mission par son id (notifications) avec le bon écran selon le rôle réel.
Future<void> openJobById(BuildContext context, WidgetRef ref, String jobId) async {
  try {
    final job = await ref.read(apiProvider).job(jobId);
    final myId = ref.read(authProvider).user?.id;
    final asProvider = job.provider?.id == myId && job.client.id != myId;
    if (context.mounted) context.push(jobRouteFor(job, asProvider: asProvider));
  } catch (e) {
    if (context.mounted) showSnack(context, errorMessage(e), error: true);
  }
}

/// Mixin : charge une mission, rejoint sa room Socket.IO et écoute `job:updated`.
mixin JobSubscription<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  String get jobId;
  Job? job;
  Object? jobError;
  bool jobLoading = true;
  final List<StreamSubscription<dynamic>> _jobSubs = [];

  /// Appelé à chaque mise à jour (chargement initial compris).
  void onJobChanged(Job job) {}

  void initJobSubscription() {
    SocketService.instance.retainJob(jobId);
    // Après une coupure réseau : des événements ont pu être manqués → resynchronisation.
    _jobSubs.add(SocketService.instance.reconnected.listen((_) {
      if (mounted) loadJob(silent: true);
    }));
    _jobSubs.add(SocketService.instance.on('job:updated').listen((data) {
      if (asString(data['id']) != jobId) return;
      final j = Job.fromJson(data);
      if (!mounted) return;
      setState(() => job = j);
      onJobChanged(j);
    }));
    loadJob();
  }

  void listenSocket(String event, void Function(Json data) handler) {
    _jobSubs.add(SocketService.instance.on(event).listen((d) {
      if (mounted) handler(d);
    }));
  }

  Future<void> loadJob({bool silent = false}) async {
    if (!silent) {
      setState(() {
        jobLoading = true;
        jobError = null;
      });
    }
    try {
      final j = await ref.read(apiProvider).job(jobId);
      if (!mounted) return;
      setState(() {
        job = j;
        jobLoading = false;
        jobError = null;
      });
      onJobChanged(j);
    } catch (e) {
      if (!mounted) return;
      if (!silent) {
        setState(() {
          jobError = e;
          jobLoading = false;
        });
      }
    }
  }

  void disposeJobSubscription() {
    for (final s in _jobSubs) {
      s.cancel();
    }
    _jobSubs.clear();
    SocketService.instance.releaseJob(jobId);
  }

  /// Rendu standard chargement / erreur.
  Widget? jobStateView() {
    if (job != null) return null;
    if (jobLoading) return const SkeletonList(count: 3, itemHeight: 120);
    return ErrorView(error: jobError ?? 'Erreur', onRetry: loadJob);
  }
}

/// Carte de mission (Mes jobs, demandes à proximité…).
class JobCard extends StatelessWidget {
  const JobCard({super.key, required this.job, this.onTap, this.asProvider = false, this.trailing});
  final Job job;
  final VoidCallback? onTap;
  final bool asProvider;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final other = asProvider
        ? job.client.fullName
        : (job.provider?.fullName ??
            (job.isTender
                ? '${job.bidsCount} devis reçu${job.bidsCount > 1 ? 's' : ''}'
                : 'Recherche d’un prestataire…'));
    return TaskoCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CategoryIcon(icon: job.category.icon, size: 44),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(job.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(
                      [
                        job.category.parentName ?? job.category.name,
                        if (job.isTender) 'Appel d’offres',
                        if (job.isDirect) 'Demande directe',
                        if (job.property != null) job.property!.name,
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted),
                    ),
                  ],
                ),
              ),
              StatusBadge(status: job.status),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              TaskoAvatar(
                name: asProvider ? job.client.fullName : job.provider?.fullName,
                url: asProvider ? job.client.avatarUrl : job.provider?.avatarUrl,
                size: 26,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(other,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13)),
              ),
              if (job.isTender && job.effectivePrice == 0)
                Text(job.budgetRangeLabel ?? 'Sur devis',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: TaskoColors.primary))
              else
                MoneyText(
                  asProvider ? job.payout : job.clientTotal,
                  style: const TextStyle(fontWeight: FontWeight.w700, color: TaskoColors.primary),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              const Icon(Icons.place_outlined, size: 14, color: TaskoColors.textMuted),
              const SizedBox(width: 3),
              Expanded(
                child: Text(
                  [
                    if (job.address.isNotEmpty) job.address,
                    if (job.distanceKm != null) formatDistance(job.distanceKm),
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted),
                ),
              ),
              Text(formatRelative(job.createdAt),
                  style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted)),
            ],
          ),
          if (trailing != null) ...[const SizedBox(height: 10), trailing!],
        ],
      ),
    );
  }
}
