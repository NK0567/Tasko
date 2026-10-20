import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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
import 'job_common.dart';

/// Écran 8b — Le prestataire a terminé : photos de preuve, compte à rebours avant
/// libération automatique, « Valider et libérer le paiement » / « Signaler un problème ».
class JobDoneScreen extends ConsumerStatefulWidget {
  const JobDoneScreen({super.key, required this.jobId});
  final String jobId;

  @override
  ConsumerState<JobDoneScreen> createState() => _JobDoneScreenState();
}

class _JobDoneScreenState extends ConsumerState<JobDoneScreen>
    with SingleTickerProviderStateMixin, JobSubscription<JobDoneScreen> {
  late final AnimationController _anim;
  int _rating = 5;
  final _comment = TextEditingController();
  bool _submitting = false;

  @override
  String get jobId => widget.jobId;

  @override
  void initState() {
    super.initState();
    _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800));
    initJobSubscription();
  }

  @override
  void dispose() {
    _anim.dispose();
    _comment.dispose();
    disposeJobSubscription();
    super.dispose();
  }

  @override
  void onJobChanged(Job job) {
    if (job.status == JobStatus.completed && !_anim.isAnimating && _anim.value == 0) {
      _anim.forward();
    }
  }

  Future<void> _validate(Job job) async {
    if (_submitting) return;
    final ok = await confirmAction(
      context,
      title: 'Valider et payer ?',
      message: '${formatMoney(job.payout)} seront versés à ${job.provider?.fullName ?? 'votre prestataire'}. '
          'Cette action est définitive.',
      confirmLabel: 'Oui, payer le prestataire',
    );
    if (!ok || !mounted) return;
    setState(() => _submitting = true);
    try {
      final j = await ref.read(apiProvider).completeJob(
            widget.jobId,
            rating: _rating,
            comment: _comment.text.trim(),
          );
      if (!mounted) return;
      setState(() => this.job = j);
      _anim
        ..reset()
        ..forward();
      showSnack(context, 'Merci ! Le prestataire a été payé.');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = jobStateView();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Vérifier le travail'),
        leading: IconButton(
          tooltip: 'Fermer',
          icon: const Icon(Icons.close),
          onPressed: () => context.go('/home'),
        ),
      ),
      body: state ?? _buildBody(job!),
    );
  }

  Widget _buildBody(Job job) {
    final completed = job.status == JobStatus.completed;
    final canValidate = {
      JobStatus.funded,
      JobStatus.enRoute,
      JobStatus.arrived,
      JobStatus.inProgress,
      JobStatus.done,
    }.contains(job.status);
    final proof = job.completionProof;

    return Stack(
      children: [
        Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
                children: [
                  if (completed) ...[
                    SizedBox(height: 130, child: _CheckAnimation(anim: _anim)),
                    const Text('Mission validée !',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w700,
                            color: TaskoColors.primaryDark)),
                    const SizedBox(height: 6),
                    Text(
                      job.completedBy == 'auto'
                          ? 'Le paiement a été versé automatiquement au prestataire.'
                          : 'Le prestataire a été payé. Merci pour votre confiance !',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: TaskoColors.textMuted, fontSize: 15),
                    ),
                    const SizedBox(height: 16),
                  ] else ...[
                    JobProgressBar(status: job.status),
                    const SizedBox(height: 14),
                    NextStepCard(job: job, asProvider: false),
                    const SizedBox(height: 12),
                  ],
                  if (job.provider != null)
                    TaskoCard(
                      child: Row(
                        children: [
                          TaskoAvatar(name: job.provider!.fullName, url: job.provider!.avatarUrl),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(job.provider!.fullName,
                                    style: const TextStyle(fontWeight: FontWeight.w600)),
                                Text(job.title,
                                    style: const TextStyle(
                                        fontSize: 13, color: TaskoColors.textMuted)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (!completed && job.status == JobStatus.done && job.autoReleaseAt != null) ...[
                    const SizedBox(height: 12),
                    AutoReleaseCard(releaseAt: job.autoReleaseAt!, forProvider: false),
                  ],
                  if (proof != null && !proof.isEmpty) ...[
                    const SizedBox(height: 16),
                    const Text('Preuves envoyées par le prestataire',
                        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                    const SizedBox(height: 8),
                    ProofPhotosGrid(urls: proof.photos),
                    if (proof.note != null) ...[
                      const SizedBox(height: 8),
                      InfoBox(icon: Icons.sticky_note_2_outlined, text: proof.note!),
                    ],
                  ] else if (job.status == JobStatus.done) ...[
                    const SizedBox(height: 12),
                    const InfoBox(
                      icon: Icons.photo_camera_outlined,
                      color: StatusColors.waiting,
                      text: 'Le prestataire n’a pas envoyé de photo. Vérifiez le travail sur place.',
                    ),
                  ],
                  if (canValidate) ...[
                    const SizedBox(height: 16),
                    TaskoCard(
                      child: Column(
                        children: [
                          const Text('Notez votre prestataire',
                              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                          const SizedBox(height: 6),
                          Semantics(
                            label: 'Note : $_rating étoiles sur 5',
                            child: RatingStars(
                              rating: _rating.toDouble(),
                              size: 38,
                              onChanged: (v) => setState(() => _rating = v),
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _comment,
                            maxLines: 3,
                            textCapitalization: TextCapitalization.sentences,
                            decoration: const InputDecoration(
                              hintText: 'Un commentaire ? (optionnel)',
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (job.status != JobStatus.done)
                      const Padding(
                        padding: EdgeInsets.only(top: 10),
                        child: InfoBox(
                          icon: Icons.warning_amber_rounded,
                          color: StatusColors.waiting,
                          text: 'Le prestataire n’a pas encore dit qu’il a terminé. '
                              'Validez seulement si le travail est fait.',
                        ),
                      ),
                  ] else if (job.review != null) ...[
                    const SizedBox(height: 16),
                    Center(child: RatingStars(rating: job.review!.rating.toDouble(), size: 28)),
                  ],
                  const SizedBox(height: 16),
                  AmountSummary(
                    price: job.effectivePrice,
                    serviceFee: job.serviceFee,
                    total: job.clientTotal,
                    providerReceives: job.payout,
                  ),
                ],
              ),
            ),
            BottomActionBar(
              children: [
                if (canValidate) ...[
                  TaskoButton(
                    label: 'Valider et libérer le paiement',
                    icon: Icons.verified,
                    loading: _submitting,
                    onPressed: () => _validate(job),
                  ),
                  if (canOpenDispute(job))
                    TextButton.icon(
                      onPressed: _submitting ? null : () => context.push('/jobs/${job.id}/dispute'),
                      style: TextButton.styleFrom(
                        foregroundColor: TaskoColors.danger,
                        minimumSize: const Size(48, 48),
                      ),
                      icon: const Icon(Icons.report_problem_outlined),
                      label: const Text('Signaler un problème'),
                    ),
                ] else if (completed) ...[
                  TaskoButton(
                    label: 'Voir le reçu',
                    icon: Icons.receipt_long_outlined,
                    onPressed: () => context.push('/jobs/${job.id}/receipt'),
                  ),
                  TextButton(
                    onPressed: () => context.go('/home'),
                    style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                    child: const Text('Retour à l’accueil'),
                  ),
                ] else
                  TaskoButton(
                    label: 'Voir la mission',
                    icon: Icons.info_outline,
                    variant: TaskoButtonVariant.light,
                    onPressed: () => context.pushReplacement(jobRouteFor(job, asProvider: false)),
                  ),
              ],
            ),
          ],
        ),
        IgnorePointer(
          child: AnimatedBuilder(
            animation: _anim,
            builder: (_, _) => CustomPaint(
              size: Size.infinite,
              painter: ConfettiPainter(_anim.value),
            ),
          ),
        ),
      ],
    );
  }
}

class _CheckAnimation extends StatelessWidget {
  const _CheckAnimation({required this.anim});
  final AnimationController anim;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: anim,
      builder: (_, _) {
        final scale = anim.value == 0
            ? 1.0
            : Curves.elasticOut.transform((anim.value * 1.4).clamp(0.0, 1.0));
        return Center(
          child: Transform.scale(
            scale: scale,
            child: Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(
                color: TaskoColors.primary,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(color: TaskoColors.primary.withValues(alpha: 0.35), blurRadius: 24),
                ],
              ),
              child: const Icon(Icons.check_rounded, color: Colors.white, size: 62),
            ),
          ),
        );
      },
    );
  }
}

/// Confettis simples (déterministes) tombant depuis le haut.
class ConfettiPainter extends CustomPainter {
  ConfettiPainter(this.t);
  final double t;

  static const _colors = [
    TaskoColors.accent,
    TaskoColors.primary,
    TaskoColors.info,
    Color(0xFFE91E63),
    TaskoColors.primaryLight,
  ];

  @override
  void paint(Canvas canvas, Size size) {
    if (t <= 0 || t >= 1) return;
    final rnd = math.Random(7);
    final opacity = (1 - t).clamp(0.0, 1.0);
    for (var i = 0; i < 70; i++) {
      final x0 = rnd.nextDouble() * size.width;
      final speed = 0.5 + rnd.nextDouble();
      final drift = (rnd.nextDouble() - 0.5) * 80;
      final y = -20 + t * speed * size.height * 0.9;
      final x = x0 + math.sin(t * 6 + i) * 12 + drift * t;
      final paint = Paint()..color = _colors[i % _colors.length].withValues(alpha: opacity);
      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(t * 8 + i);
      canvas.drawRRect(
        RRect.fromRectAndRadius(const Rect.fromLTWH(-4, -2, 8, 4), const Radius.circular(1)),
        paint,
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant ConfettiPainter old) => old.t != t;
}
