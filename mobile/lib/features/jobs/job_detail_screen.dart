import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../models/job_rules.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import '../chat/chat_actions.dart';
import 'job_common.dart';
import 'job_sheets.dart';

/// Détail / récapitulatif d'une mission (client ou prestataire).
class JobDetailScreen extends ConsumerStatefulWidget {
  const JobDetailScreen({super.key, required this.jobId});
  final String jobId;

  @override
  ConsumerState<JobDetailScreen> createState() => _JobDetailScreenState();
}

class _JobDetailScreenState extends ConsumerState<JobDetailScreen>
    with JobSubscription<JobDetailScreen> {
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

  Future<void> _run(Future<void> Function() action,
      {String? success, String Function(Object e)? onError}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      if (mounted && success != null) showSnack(context, success);
    } catch (e) {
      if (mounted) showSnack(context, (onError ?? errorMessage)(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _accept(Job job) async {
    final controller =
        TextEditingController(text: formatMoney(job.effectivePrice, withCurrency: false));
    final price = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Accepter la mission'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Budget du client : ${formatMoney(job.budget)}'),
            const SizedBox(height: 12),
            AmountField(controller: controller, label: 'Votre prix'),
            const SizedBox(height: 8),
            const Text('Vous ne partirez qu’après le paiement du client : votre argent est garanti.',
                style: TextStyle(fontSize: 13, color: TaskoColors.textMuted)),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Retour')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, parseAmount(controller.text)),
            child: const Text('Accepter'),
          ),
        ],
      ),
    );
    if (price == null || price <= 0) return;
    await _run(
      () async {
        final j = await ref.read(apiProvider).acceptJob(job.id, price: price);
        if (mounted) context.pushReplacement(jobRouteFor(j, asProvider: true));
      },
      success: 'Mission acceptée ! Attendez le paiement du client avant de partir.',
      onError: acceptErrorMessage,
    );
  }

  Future<void> _review(Job job) async {
    var rating = 5;
    final comment = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Laisser un avis'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              RatingStars(
                rating: rating.toDouble(),
                size: 34,
                onChanged: (v) => setLocal(() => rating = v),
              ),
              TextField(
                controller: comment,
                maxLines: 3,
                decoration: const InputDecoration(hintText: 'Votre commentaire'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Retour')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Publier')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    await _run(() async {
      await ref.read(apiProvider).reviewJob(job.id, rating: rating, comment: comment.text.trim());
      await loadJob(silent: true);
    }, success: 'Merci pour votre avis !');
  }

  Future<void> _cancel(Job job, CancellationPolicy policy) async {
    final reason = await showCancelSheet(context, policy);
    if (reason == null) return;
    await _run(() async {
      await ref.read(apiProvider).cancelJob(job.id, reason: reason.isEmpty ? null : reason);
      await loadJob(silent: true);
    }, success: 'Demande annulée.');
  }

  @override
  Widget build(BuildContext context) {
    final state = jobStateView();
    return Scaffold(
      appBar: AppBar(title: const Text('Détail de la mission')),
      body: state ?? _buildBody(job!),
    );
  }

  List<Widget> _actions(Job job, bool isClient, CancellationPolicy policy) {
    final actions = <Widget>[];
    if (isClient) {
      final route = jobRouteFor(job, asProvider: false);
      final (label, icon) = switch (job.status) {
        JobStatus.requested when job.isTender => ('Voir les devis reçus', Icons.request_quote_outlined),
        JobStatus.requested => ('Voir la recherche', Icons.radar),
        JobStatus.accepted when job.isProviderOffer => ('Voir la proposition', Icons.handshake_outlined),
        JobStatus.accepted => ('Payer ${formatMoney(job.clientTotal)}', Icons.lock_outline),
        JobStatus.done => ('Vérifier et payer le prestataire', Icons.verified),
        JobStatus.disputed => ('Ouvrir le salon de médiation', Icons.forum_outlined),
        _ when job.isLive => ('Suivre la mission', Icons.near_me),
        _ => ('', Icons.circle),
      };
      if (label.isNotEmpty && route != '/jobs/${job.id}') {
        actions.add(TaskoButton(label: label, icon: icon, onPressed: () => context.push(route)));
      }
      if (job.status == JobStatus.completed) {
        actions.add(TaskoButton(
          label: 'Voir le reçu',
          icon: Icons.receipt_long_outlined,
          onPressed: () => context.push('/jobs/${job.id}/receipt'),
        ));
        if (job.review == null) {
          actions.add(TextButton.icon(
            onPressed: _busy ? null : () => _review(job),
            style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
            icon: const Icon(Icons.star_outline),
            label: const Text('Laisser un avis'),
          ));
        }
      }
      if (policy.kind == CancelKind.free) {
        actions.add(TextButton.icon(
          onPressed: _busy ? null : () => _cancel(job, policy),
          style: TextButton.styleFrom(
              foregroundColor: TaskoColors.danger, minimumSize: const Size(48, 48)),
          icon: const Icon(Icons.cancel_outlined),
          label: const Text('Annuler la demande'),
        ));
      }
    } else {
      if (job.status == JobStatus.requested && job.isTender) {
        actions.add(TaskoButton(
          label: 'Voir l’appel d’offres',
          icon: Icons.request_quote_outlined,
          onPressed: () => context.push('/tenders/${job.id}'),
        ));
      } else if (job.status == JobStatus.requested) {
        actions.add(Row(
          children: [
            Expanded(
              child: TaskoButton(
                label: 'Refuser',
                icon: Icons.close,
                variant: TaskoButtonVariant.danger,
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                          await ref.read(apiProvider).declineJob(job.id);
                          if (mounted) context.pop();
                        }),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: TaskoButton(
                label: 'Accepter',
                icon: Icons.check,
                loading: _busy,
                onPressed: () => _accept(job),
              ),
            ),
          ],
        ));
      } else if (job.isActive || job.status == JobStatus.disputed) {
        actions.add(TaskoButton(
          label: 'Ouvrir la mission',
          icon: Icons.work_outline,
          onPressed: () => context.push(jobRouteFor(job, asProvider: true)),
        ));
      } else if (job.status == JobStatus.completed) {
        actions.add(TaskoButton(
          label: 'Voir le reçu',
          icon: Icons.receipt_long_outlined,
          variant: TaskoButtonVariant.outline,
          onPressed: () => context.push('/jobs/${job.id}/receipt'),
        ));
      }
    }
    return actions;
  }

  Widget _buildBody(Job job) {
    final myId = ref.watch(authProvider).user?.id;
    final isClient = job.client.id == myId;
    final other = isClient ? job.provider : job.client;
    final photo = AppConfig.mediaUrl(job.photoUrl);
    final policy = isClient
        ? clientCancellationPolicy(job,
            feeEnRoute: ref.watch(settingsValueProvider).cancellationFeeEnRoute)
        : providerCancellationPolicy(job);
    final actions = _actions(job, isClient, policy);
    final proof = job.completionProof;

    return Column(
      children: [
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => loadJob(silent: true),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  children: [
                    CategoryIcon(icon: job.category.icon, size: 52),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(job.title,
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
                          Text(
                            [job.category.parentName ?? job.category.name, JobMode.label(job.mode)]
                                .join(' · '),
                            style: const TextStyle(color: TaskoColors.textMuted, fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                if (JobStatus.progressStep(job.status) >= 0) ...[
                  JobProgressBar(status: job.status),
                  const SizedBox(height: 12),
                ],
                NextStepCard(job: job, asProvider: !isClient),
                if (!isClient && job.client.trust != null &&
                    (job.status == JobStatus.requested || job.status == JobStatus.accepted)) ...[
                  const SizedBox(height: 12),
                  ClientTrustCard(trust: job.client.trust!, name: job.client.fullName),
                ],
                const SizedBox(height: 14),
                if (job.description.isNotEmpty)
                  Text(job.description, style: const TextStyle(height: 1.5, fontSize: 15)),
                if (photo != null) ...[
                  const SizedBox(height: 12),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(TaskoRadius.card),
                    child: CachedNetworkImage(
                      imageUrl: photo,
                      height: 180,
                      fit: BoxFit.cover,
                      errorWidget: (_, _, _) => const SizedBox.shrink(),
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                _InfoRow(Icons.place_outlined, job.address.isEmpty ? '—' : job.address),
                _InfoRow(
                  Icons.schedule,
                  job.urgency == Urgency.scheduled && job.scheduledAt != null
                      ? 'Prévu le ${formatDateTime(job.scheduledAt)}'
                      : Urgency.label(job.urgency),
                ),
                _InfoRow(Icons.calendar_today_outlined, 'Créée le ${formatDateTime(job.createdAt)}'),
                _InfoRow(Icons.account_balance_wallet_outlined, PaymentStatus.label(job.paymentStatus)),
                if (job.property != null)
                  _InfoRow(Icons.apartment, 'Bien : ${job.property!.name}'),
                if (job.cancelReason != null)
                  _InfoRow(Icons.info_outline, 'Motif d’annulation : ${job.cancelReason}'),
                if (other != null) ...[
                  const SizedBox(height: 12),
                  TaskoCard(
                    child: Column(
                      children: [
                        Row(
                          children: [
                            TaskoAvatar(name: other.fullName, url: other.avatarUrl),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(other.fullName,
                                      style: const TextStyle(fontWeight: FontWeight.w600)),
                                  Text(
                                    isClient
                                        ? [other.headline ?? 'Prestataire', ?other.publicCode]
                                            .join(' · ')
                                        : 'Client',
                                    style:
                                        const TextStyle(fontSize: 13, color: TaskoColors.textMuted),
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
                                    openChatWith(context, ref, userId: other.id, jobId: job.id),
                                icon: const Icon(Icons.chat_bubble_outline),
                                label: const Text('Message'),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(child: CallButton(phone: other.phone)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
                if (job.hasMilestones) ...[
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => context.push('/jobs/${job.id}/milestones'),
                    icon: const Icon(Icons.format_list_numbered),
                    label: Text('${job.milestones.length} étapes de paiement'),
                  ),
                ],
                if (proof != null && proof.photos.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  const Text('Photos de fin de mission',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  ProofPhotosGrid(urls: proof.photos),
                ],
                if (job.dispute != null) ...[
                  const SizedBox(height: 12),
                  InfoBox(
                    icon: Icons.gavel_rounded,
                    color: job.dispute!.isOpen ? StatusColors.problem : StatusColors.closed,
                    title: job.dispute!.isOpen ? 'Litige en cours' : 'Litige clos',
                    text: job.dispute!.reason.isEmpty ? 'Voir le salon de médiation.' : job.dispute!.reason,
                    trailing: TextButton(
                      onPressed: () => context.push('/disputes/${job.dispute!.id}'),
                      child: const Text('Ouvrir'),
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                AmountSummary(
                  price: job.effectivePrice,
                  serviceFee: job.serviceFee,
                  total: job.clientTotal,
                  providerReceives: job.payout,
                  asProvider: !isClient,
                ),
                if (policy.kind != CancelKind.none && job.status != JobStatus.requested) ...[
                  const SizedBox(height: 12),
                  CancellationPolicyCard(policy: policy),
                ],
                if (job.review != null) ...[
                  const SizedBox(height: 12),
                  TaskoCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Avis', style: TextStyle(fontWeight: FontWeight.w600)),
                        RatingStars(rating: job.review!.rating.toDouble()),
                        if (job.review!.comment.isNotEmpty) Text(job.review!.comment),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (actions.isNotEmpty) BottomActionBar(children: actions),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow(this.icon, this.text);
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Icon(icon, size: 18, color: TaskoColors.primary),
            const SizedBox(width: 10),
            Expanded(child: Text(text, style: const TextStyle(fontSize: 14))),
          ],
        ),
      );
}
