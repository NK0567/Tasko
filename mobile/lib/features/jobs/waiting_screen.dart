import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/icon_map.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/tasko_button.dart';
import 'job_common.dart';

/// Attente d'acceptation : animation radar + écoute `job:updated`.
class WaitingScreen extends ConsumerStatefulWidget {
  const WaitingScreen({super.key, required this.jobId});
  final String jobId;

  @override
  ConsumerState<WaitingScreen> createState() => _WaitingScreenState();
}

class _WaitingScreenState extends ConsumerState<WaitingScreen>
    with SingleTickerProviderStateMixin, JobSubscription<WaitingScreen> {
  late final AnimationController _radar;
  Timer? _poll;
  bool _cancelling = false;
  bool _navigated = false;

  @override
  String get jobId => widget.jobId;

  @override
  void initState() {
    super.initState();
    _radar = AnimationController(vsync: this, duration: const Duration(seconds: 3))..repeat();
    initJobSubscription();
    // Filet de sécurité si le socket est indisponible.
    _poll = Timer.periodic(const Duration(seconds: 6), (_) => loadJob(silent: true));
  }

  @override
  void dispose() {
    _radar.dispose();
    _poll?.cancel();
    disposeJobSubscription();
    super.dispose();
  }

  @override
  void onJobChanged(Job job) {
    if (_navigated || job.status == JobStatus.requested) return;
    if (job.status == JobStatus.cancelled) return;
    _navigated = true;
    _poll?.cancel();
    if (job.status == JobStatus.accepted && job.provider != null) {
      showSnack(context, '${job.provider!.fullName} a accepté votre demande !');
    }
    context.pushReplacement(jobRouteFor(job, asProvider: false));
  }

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Annuler la demande ?'),
        content: const Text('Les prestataires ne verront plus votre demande.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Non')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Oui, annuler', style: TextStyle(color: TaskoColors.danger)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _cancelling = true);
    try {
      await ref.read(apiProvider).cancelJob(widget.jobId, reason: 'Annulée par le client');
      if (mounted) {
        showSnack(context, 'Demande annulée.');
        context.go('/home');
      }
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = jobStateView();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Recherche en cours'),
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
    final cancelled = job.status == JobStatus.cancelled;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const SizedBox(height: 12),
            SizedBox(
              width: 260,
              height: 260,
              child: AnimatedBuilder(
                animation: _radar,
                builder: (_, _) => CustomPaint(
                  painter: _RadarPainter(cancelled ? 0 : _radar.value),
                  child: Center(
                    child: Container(
                      width: 84,
                      height: 84,
                      decoration: BoxDecoration(
                        color: TaskoColors.primary,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: TaskoColors.primary.withValues(alpha: 0.4),
                            blurRadius: 20,
                          ),
                        ],
                      ),
                      child: Icon(iconForKey(job.category.icon), color: Colors.white, size: 40),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              cancelled
                  ? 'Demande annulée'
                  : job.provider != null
                      ? 'En attente de ${job.provider!.fullName}…'
                      : 'Nous alertons les prestataires proches…',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: TaskoColors.primaryDark,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              cancelled
                  ? 'Cette demande n’est plus active.'
                  : 'Vous serez notifié dès qu’un prestataire accepte. Vous ne payez qu’après acceptation.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: TaskoColors.textMuted),
            ),
            const SizedBox(height: 20),
            TaskoCard(
              child: Row(
                children: [
                  CategoryIcon(icon: job.category.icon, size: 44),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(job.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text(
                          '${Urgency.label(job.urgency)} · ${job.address}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted),
                        ),
                      ],
                    ),
                  ),
                  Text(formatMoney(job.budget),
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, color: TaskoColors.primary)),
                ],
              ),
            ),
            if (job.provider != null) ...[
              const SizedBox(height: 10),
              TaskoCard(
                child: Row(
                  children: [
                    TaskoAvatar(name: job.provider!.fullName, url: job.provider!.avatarUrl),
                    const SizedBox(width: 10),
                    Expanded(child: Text('Demande directe à ${job.provider!.fullName}')),
                  ],
                ),
              ),
            ],
            const Spacer(),
            if (!cancelled)
              TaskoButton(
                label: 'Annuler la demande',
                variant: TaskoButtonVariant.danger,
                loading: _cancelling,
                onPressed: _cancel,
              )
            else
              TaskoButton(label: 'Retour à l’accueil', onPressed: () => context.go('/home')),
          ],
        ),
      ),
    );
  }
}

class _RadarPainter extends CustomPainter {
  _RadarPainter(this.t);
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final maxR = size.width / 2;
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..color = TaskoColors.primary.withValues(alpha: 0.15)
      ..strokeWidth = 1.2;
    for (var i = 1; i <= 3; i++) {
      canvas.drawCircle(center, maxR * i / 3, ring);
    }
    for (var i = 0; i < 3; i++) {
      final p = (t + i / 3) % 1.0;
      canvas.drawCircle(
        center,
        maxR * p,
        Paint()..color = TaskoColors.primary.withValues(alpha: 0.18 * (1 - p)),
      );
    }
    // Faisceau rotatif.
    final sweep = Paint()
      ..shader = SweepGradient(
        startAngle: 0,
        endAngle: math.pi / 2,
        colors: [
          TaskoColors.primaryLight.withValues(alpha: 0.0),
          TaskoColors.primaryLight.withValues(alpha: 0.35),
        ],
        transform: GradientRotation(t * 2 * math.pi),
      ).createShader(Rect.fromCircle(center: center, radius: maxR));
    canvas.drawCircle(center, maxR, sweep);
    // Points « prestataires » qui clignotent.
    final dots = [const Offset(0.7, 0.3), const Offset(0.25, 0.65), const Offset(0.78, 0.74)];
    for (var i = 0; i < dots.length; i++) {
      final a = (math.sin((t * 2 * math.pi) + i * 2) + 1) / 2;
      canvas.drawCircle(
        Offset(dots[i].dx * size.width, dots[i].dy * size.height),
        5,
        Paint()..color = TaskoColors.accent.withValues(alpha: 0.4 + 0.6 * a),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _RadarPainter old) => old.t != t;
}
