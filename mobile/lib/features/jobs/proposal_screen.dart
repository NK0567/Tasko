import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/milestones.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import 'job_common.dart';

/// Client : « Bika Services vous propose … — Payer pour confirmer / Refuser ».
class ProposalScreen extends ConsumerStatefulWidget {
  const ProposalScreen({super.key, required this.jobId});
  final String jobId;

  @override
  ConsumerState<ProposalScreen> createState() => _ProposalScreenState();
}

class _ProposalScreenState extends ConsumerState<ProposalScreen>
    with JobSubscription<ProposalScreen> {
  bool _busy = false;

  @override
  String get jobId => widget.jobId;

  @override
  void initState() {
    super.initState();
    initJobSubscription();
  }

  @override
  void dispose() {
    disposeJobSubscription();
    super.dispose();
  }

  Future<void> _refuse(Job job) async {
    final ok = await confirmAction(
      context,
      title: 'Refuser la proposition ?',
      message: '${job.provider?.fullName ?? 'Le prestataire'} sera prévenu. Vous n’avez rien payé.',
      confirmLabel: 'Oui, refuser',
      danger: true,
    );
    if (!ok || !mounted || _busy) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).cancelJob(job.id, reason: 'Proposition refusée par le client');
      if (!mounted) return;
      showSnack(context, 'Proposition refusée.');
      context.go('/home');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = jobStateView();
    return Scaffold(
      appBar: AppBar(title: const Text('Proposition de mission')),
      body: state ?? _body(job!),
    );
  }

  Widget _body(Job job) {
    final p = job.provider;
    final providerName = p?.fullName ?? 'Votre prestataire';
    if (job.status != JobStatus.accepted) {
      return EmptyView(
        title: job.status == JobStatus.cancelled
            ? 'Proposition refusée ou annulée'
            : 'Proposition déjà confirmée',
        message: JobStatus.nextStep(job, asProvider: false),
        actionLabel: 'Voir la mission',
        onAction: () => context.pushReplacement(jobRouteFor(job, asProvider: false)),
      );
    }
    final firstMilestone = job.nextPendingMilestone;
    final toPay = firstMilestone != null ? firstMilestone.total : job.clientTotal;
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  TaskoAvatar(name: providerName, url: p?.avatarUrl, size: 56),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('$providerName vous propose',
                            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                        Text(
                          [
                            if (p?.headline != null) p!.headline!,
                            if (p?.publicCode != null) p!.publicCode!,
                          ].join(' · '),
                          style: const TextStyle(fontSize: 14, color: TaskoColors.textMuted),
                        ),
                        if (p?.ratingAvg != null) RatingLabel(rating: p!.ratingAvg!, fontSize: 13),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              TaskoCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(job.title,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    const SizedBox(height: 4),
                    Text(formatMoney(job.effectivePrice),
                        style: const TextStyle(
                            fontSize: 22, fontWeight: FontWeight.w800, color: TaskoColors.primary)),
                    if (job.description.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(job.description, style: const TextStyle(fontSize: 15, height: 1.4)),
                    ],
                    if (job.address.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Row(children: [
                        const Icon(Icons.place_outlined, size: 18, color: TaskoColors.primary),
                        const SizedBox(width: 6),
                        Expanded(child: Text(job.address)),
                      ]),
                    ],
                    if (job.scheduledAt != null) ...[
                      const SizedBox(height: 6),
                      Row(children: [
                        const Icon(Icons.event, size: 18, color: TaskoColors.primary),
                        const SizedBox(width: 6),
                        Text('Le ${formatDateTime(job.scheduledAt)}'),
                      ]),
                    ],
                  ],
                ),
              ),
              if (job.hasMilestones) ...[
                const SizedBox(height: 16),
                const Text('Paiement en plusieurs étapes',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                const SizedBox(height: 4),
                const Text('Vous payez chaque étape avant qu’elle commence.',
                    style: TextStyle(fontSize: 14, color: TaskoColors.textMuted)),
                const SizedBox(height: 10),
                MilestoneTimeline(milestones: job.milestones),
              ],
              const SizedBox(height: 16),
              AmountSummary(
                price: job.effectivePrice,
                serviceFee: job.serviceFee,
                total: job.clientTotal,
                providerReceives: job.payout,
              ),
              const SizedBox(height: 12),
              const InfoBox(
                icon: Icons.lock_outline,
                text: 'En payant, l’argent est bloqué en sécurité chez Tasko. '
                    'Le prestataire n’est payé qu’à la fin, après votre validation.',
              ),
            ],
          ),
        ),
        BottomActionBar(children: [
          TaskoButton(
            label: firstMilestone != null
                ? 'Payer l’étape 1 (${formatMoney(toPay)})'
                : 'Payer ${formatMoney(toPay)} pour confirmer',
            icon: Icons.lock_outline,
            onPressed: _busy ? null : () => context.push('/jobs/${job.id}/pay'),
          ),
          TextButton.icon(
            onPressed: _busy ? null : () => _refuse(job),
            style: TextButton.styleFrom(
                foregroundColor: TaskoColors.danger, minimumSize: const Size(48, 48)),
            icon: const Icon(Icons.close),
            label: const Text('Refuser la proposition'),
          ),
        ]),
      ],
    );
  }
}
