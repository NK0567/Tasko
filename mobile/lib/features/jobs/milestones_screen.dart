import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/milestones.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import 'job_common.dart';
import 'job_sheets.dart';

/// Étapes de paiement d'une mission (chantiers, gros contrats).
class MilestonesScreen extends ConsumerStatefulWidget {
  const MilestonesScreen({super.key, required this.jobId});
  final String jobId;

  @override
  ConsumerState<MilestonesScreen> createState() => _MilestonesScreenState();
}

class _MilestonesScreenState extends ConsumerState<MilestonesScreen>
    with JobSubscription<MilestonesScreen> {
  String? _busyId;

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

  bool get _isClient => job?.client.id == ref.read(authProvider).user?.id;

  Future<void> _submit(Job j, Milestone m) async {
    if (_busyId != null) return;
    final proof = await showFinishSheet(
      context,
      title: 'Étape « ${m.title} » terminée',
      confirmLabel: 'Déclarer l’étape terminée',
    );
    if (proof == null || !mounted) return;
    setState(() => _busyId = m.id);
    try {
      final updated = await ref
          .read(apiProvider)
          .submitMilestone(j.id, m.id, proofPhotos: proof.photos, note: proof.note);
      if (!mounted) return;
      setState(() => job = updated);
      showSnack(context, 'Étape déclarée terminée. Le client va la vérifier.');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _release(Job j, Milestone m) async {
    if (_busyId != null) return;
    final ok = await confirmAction(
      context,
      title: 'Valider l’étape ?',
      message: '${formatMoney(m.amount)} seront versés au prestataire pour « ${m.title} ». '
          'Cette action est définitive.',
      confirmLabel: 'Oui, valider et payer',
    );
    if (!ok || !mounted) return;
    setState(() => _busyId = m.id);
    try {
      final updated = await ref.read(apiProvider).releaseMilestone(j.id, m.id);
      if (!mounted) return;
      setState(() => job = updated);
      showSnack(context, 'Étape validée : le prestataire est payé.');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = jobStateView();
    return Scaffold(
      appBar: AppBar(title: const Text('Étapes de paiement')),
      body: state ?? _body(job!),
    );
  }

  Widget _body(Job j) {
    final client = _isClient;
    final released = j.milestones
        .where((m) => m.status == MilestoneStatus.released)
        .fold<int>(0, (s, m) => s + m.amount);
    final next = j.nextPendingMilestone;
    return Column(
      children: [
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => loadJob(silent: true),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(j.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
                const SizedBox(height: 4),
                Text(
                  '${formatMoney(released)} payés sur ${formatMoney(j.effectivePrice)}',
                  style: const TextStyle(fontSize: 14, color: TaskoColors.textMuted),
                ),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: LinearProgressIndicator(
                    minHeight: 8,
                    value: j.effectivePrice == 0 ? 0 : released / j.effectivePrice,
                    color: StatusColors.ok,
                    backgroundColor: TaskoColors.border,
                  ),
                ),
                const SizedBox(height: 14),
                NextStepCard(job: j, asProvider: !client),
                const SizedBox(height: 14),
                const InfoBox(
                  icon: Icons.lock_outline,
                  text: 'Chaque étape est payée avant de commencer : l’argent reste bloqué chez Tasko '
                      'jusqu’à la validation de l’étape.',
                ),
                const SizedBox(height: 16),
                MilestoneTimeline(
                  milestones: j.milestones,
                  actionsBuilder: (m, index) => _actions(j, m, client),
                ),
              ],
            ),
          ),
        ),
        if (client && next != null && j.status != JobStatus.disputed &&
            !JobStatus.terminal.contains(j.status) && j.status != JobStatus.requested)
          BottomActionBar(children: [
            TaskoButton(
              label: 'Payer l’étape ${j.milestoneIndex(next)} (${formatMoney(next.total > 0 ? next.total : next.amount)})',
              icon: Icons.lock_outline,
              onPressed: () => context.push('/jobs/${j.id}/pay?milestone_id=${next.id}'),
            ),
          ]),
      ],
    );
  }

  Widget? _actions(Job j, Milestone m, bool client) {
    final busy = _busyId == m.id;
    switch (m.status) {
      case MilestoneStatus.pending:
        return Text(
          client ? 'À payer avant de commencer cette étape.' : 'En attente du paiement du client pour cette étape.',
          style: const TextStyle(fontSize: 13.5, color: StatusColors.waiting),
        );
      case MilestoneStatus.funded:
        if (client) {
          return const Text('Argent bloqué chez Tasko. Le prestataire travaille sur cette étape.',
              style: TextStyle(fontSize: 13.5, color: StatusColors.ok));
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SecuredFundsBanner(
              amount: m.amount,
              milestoneLabel: 'Étape ${j.milestoneIndex(m)}/${j.milestones.length}',
            ),
            const SizedBox(height: 8),
            TaskoButton(
              label: 'Déclarer l’étape terminée',
              icon: Icons.check_circle_outline,
              height: 48,
              loading: busy,
              onPressed: () => _submit(j, m),
            ),
          ],
        );
      case MilestoneStatus.submitted:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (m.proofPhotos.isNotEmpty) ProofPhotosGrid(urls: m.proofPhotos, size: 76),
            if (m.note != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(m.note!, style: const TextStyle(fontSize: 14)),
              ),
            if (m.autoReleaseAt != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: CountdownText(
                  target: m.autoReleaseAt!,
                  prefix: 'Paiement automatique dans ',
                  style: const TextStyle(color: StatusColors.waiting, fontWeight: FontWeight.w600),
                ),
              ),
            if (client) ...[
              const SizedBox(height: 8),
              TaskoButton(
                label: 'Valider l’étape',
                icon: Icons.verified,
                height: 48,
                loading: busy,
                onPressed: () => _release(j, m),
              ),
              TextButton.icon(
                onPressed: busy
                    ? null
                    : () => context.push('/jobs/${j.id}/dispute?milestone_id=${m.id}'),
                style: TextButton.styleFrom(
                    foregroundColor: TaskoColors.danger, minimumSize: const Size(48, 48)),
                icon: const Icon(Icons.report_problem_outlined),
                label: const Text('Signaler un problème'),
              ),
            ] else
              const Text('Le client vérifie cette étape.',
                  style: TextStyle(fontSize: 13.5, color: TaskoColors.textMuted)),
          ],
        );
      default:
        return null;
    }
  }
}
