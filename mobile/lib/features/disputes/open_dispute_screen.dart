import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/dispute.dart';
import '../../models/job.dart';
import '../../models/job_rules.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import '../jobs/job_common.dart';
import '../jobs/job_sheets.dart';

/// Ouverture d'un litige : motif, explication, photos.
class OpenDisputeScreen extends ConsumerStatefulWidget {
  const OpenDisputeScreen({super.key, required this.jobId, this.milestoneId});
  final String jobId;
  final String? milestoneId;

  @override
  ConsumerState<OpenDisputeScreen> createState() => _OpenDisputeScreenState();
}

class _OpenDisputeScreenState extends ConsumerState<OpenDisputeScreen>
    with JobSubscription<OpenDisputeScreen> {
  int? _reason;
  final _details = TextEditingController();
  List<String> _photos = const [];
  bool _uploading = false;
  bool _submitting = false;
  String? _error;

  @override
  String get jobId => widget.jobId;

  @override
  void initState() {
    super.initState();
    initJobSubscription();
  }

  @override
  void dispose() {
    _details.dispose();
    disposeJobSubscription();
    super.dispose();
  }

  Future<void> _submit(Job job) async {
    if (_submitting) return;
    if (_reason == null) {
      setState(() => _error = 'Choisissez le problème rencontré.');
      return;
    }
    if (_details.text.trim().length < 10) {
      setState(() => _error = 'Expliquez le problème en quelques mots (10 caractères minimum).');
      return;
    }
    final (kind, label) = kDisputeReasons[_reason!];
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final j = await ref.read(apiProvider).disputeJob(
            job.id,
            '$label — ${_details.text.trim()}',
            kind: kind,
            photos: _photos,
            milestoneId: widget.milestoneId,
          );
      if (!mounted) return;
      showSnack(context, 'Problème signalé. Un médiateur Tasko va vous répondre.');
      if (j.dispute != null) {
        context.pushReplacement('/disputes/${j.dispute!.id}');
      } else {
        context.pushReplacement('/jobs/${j.id}');
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = jobStateView();
    return Scaffold(
      appBar: AppBar(title: const Text('Signaler un problème')),
      body: state ?? _body(job!),
    );
  }

  Widget _body(Job job) {
    if (!canOpenDispute(job)) {
      return EmptyView(
        title: 'Signalement impossible',
        message: job.dispute != null
            ? 'Un litige est déjà ouvert pour cette mission.'
            : 'Un problème peut être signalé entre le paiement et la fin du délai de validation.',
        actionLabel: job.dispute != null ? 'Ouvrir le salon de médiation' : 'Retour',
        onAction: () => job.dispute != null
            ? context.pushReplacement('/disputes/${job.dispute!.id}')
            : context.pop(),
      );
    }
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const EscrowLockedNote(),
              const SizedBox(height: 16),
              const Text('Quel est le problème ?',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              const SizedBox(height: 6),
              RadioGroup<int>(
                groupValue: _reason,
                onChanged: (v) => setState(() {
                  _reason = v;
                  _error = null;
                }),
                child: Column(
                  children: [
                    for (var i = 0; i < kDisputeReasons.length; i++)
                      RadioListTile<int>(
                        value: i,
                        contentPadding: EdgeInsets.zero,
                        title: Text(kDisputeReasons[i].$2, style: const TextStyle(fontSize: 15)),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _details,
                minLines: 3,
                maxLines: 6,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Expliquez ce qui s’est passé',
                  hintText: 'Ex. : la fuite continue après l’intervention.',
                ),
              ),
              const SizedBox(height: 16),
              const Text('Photos (preuves)', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              const SizedBox(height: 8),
              PhotoUploader(
                urls: _photos,
                label: 'Ajouter une photo de preuve',
                onChanged: (v) => setState(() => _photos = v),
                onBusyChanged: (v) => setState(() => _uploading = v),
              ),
              const SizedBox(height: 16),
              const InfoBox(
                icon: Icons.forum_outlined,
                text: 'Un salon de discussion à trois s’ouvre : vous, l’autre partie et un médiateur Tasko. '
                    'Tout y est horodaté et ne peut pas être modifié.',
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: const TextStyle(color: TaskoColors.danger, fontSize: 14)),
              ],
            ],
          ),
        ),
        BottomActionBar(children: [
          TaskoButton(
            label: 'Envoyer le signalement',
            icon: Icons.report_problem_outlined,
            loading: _submitting,
            onPressed: _uploading ? null : () => _submit(job),
          ),
        ]),
      ],
    );
  }
}
