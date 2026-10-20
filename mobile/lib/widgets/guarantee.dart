import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/config.dart';
import '../core/formatters.dart';
import '../core/providers.dart';
import '../core/theme.dart';
import '../models/job.dart';
import '../models/job_rules.dart';
import 'common.dart';

/// Encadré d'information (icône + texte), décliné en couleurs.
class InfoBox extends StatelessWidget {
  const InfoBox({
    super.key,
    required this.icon,
    required this.text,
    this.color = TaskoColors.primary,
    this.title,
    this.trailing,
  });

  final IconData icon;
  final String text;
  final String? title;
  final Color color;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ExcludeSemantics(child: Icon(icon, color: color, size: 22)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (title != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Text(title!,
                        style: TextStyle(fontWeight: FontWeight.w700, color: color, fontSize: 13.5)),
                  ),
                Text(text, style: const TextStyle(fontSize: 13, height: 1.35)),
              ],
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 8), trailing!],
        ],
      ),
    );
  }
}

/// Gros bandeau vert « X FCFA sécurisés par Tasko — vous serez payé à la fin ».
class SecuredFundsBanner extends StatelessWidget {
  const SecuredFundsBanner({super.key, required this.amount, this.milestoneLabel});
  final int amount;

  /// Ex. « Jalon 2/3 » pour un paiement par étapes.
  final String? milestoneLabel;

  @override
  Widget build(BuildContext context) {
    final title = milestoneLabel == null
        ? '${formatMoney(amount)} sécurisés par Tasko'
        : '$milestoneLabel : ${formatMoney(amount)} sécurisés';
    return Semantics(
      container: true,
      label: '$title. Vous serez payé à la fin.',
      child: ExcludeSemantics(
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [TaskoColors.primary, TaskoColors.primaryLight]),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.18),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.savings_outlined, color: Colors.white, size: 26),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
                    const SizedBox(height: 2),
                    const Text(
                      'L’argent est bloqué chez Tasko : vous pouvez y aller, vous serez payé à la fin.',
                      style: TextStyle(color: Colors.white, fontSize: 12.5, height: 1.3),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.verified_user, color: TaskoColors.accent, size: 26),
            ],
          ),
        ),
      ),
    );
  }
}

/// Carte « Votre code de démarrage : 4821 » (client uniquement).
class StartCodeCard extends StatelessWidget {
  const StartCodeCard({super.key, required this.code});
  final String code;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'Votre code de démarrage : ${code.split('').join(' ')}. '
          'Donnez-le au prestataire à son arrivée, pas avant.',
      child: ExcludeSemantics(
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: TaskoColors.accent.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: TaskoColors.accent),
          ),
          child: Column(
            children: [
              const Row(
                children: [
                  Icon(Icons.pin_outlined, color: TaskoColors.primaryDark),
                  SizedBox(width: 8),
                  Text('Votre code de démarrage',
                      style: TextStyle(fontWeight: FontWeight.w700, color: TaskoColors.primaryDark)),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (final d in code.split(''))
                    Container(
                      width: 44,
                      height: 52,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: TaskoColors.border),
                      ),
                      child: Text(d,
                          style: const TextStyle(
                              fontSize: 26,
                              fontWeight: FontWeight.w800,
                              color: TaskoColors.primaryDark)),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                'Donnez-le au prestataire à son arrivée, pas avant. Il en a besoin pour démarrer la mission.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12.5, height: 1.3),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Texte de compte à rebours rafraîchi chaque seconde.
class CountdownText extends StatefulWidget {
  const CountdownText({super.key, required this.target, this.style, this.prefix = ''});
  final DateTime target;
  final TextStyle? style;
  final String prefix;

  @override
  State<CountdownText> createState() => _CountdownTextState();
}

class _CountdownTextState extends State<CountdownText> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final remaining = widget.target.difference(DateTime.now());
    return Text('${widget.prefix}${formatCountdown(remaining)}', style: widget.style);
  }
}

/// Carte « Paiement libéré automatiquement le JJ/MM à HH:MM ».
class AutoReleaseCard extends StatelessWidget {
  const AutoReleaseCard({super.key, required this.releaseAt, required this.forProvider});
  final DateTime releaseAt;
  final bool forProvider;

  @override
  Widget build(BuildContext context) {
    final when = formatShortDateTime(releaseAt);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: TaskoColors.chip,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: TaskoColors.chipBorder),
      ),
      child: Row(
        children: [
          const ExcludeSemantics(
            child: Icon(Icons.timer_outlined, color: TaskoColors.primary, size: 30),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  forProvider
                      ? 'Paiement libéré automatiquement le $when si le client ne réagit pas'
                      : 'Sans action de votre part, le paiement sera libéré le $when',
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5),
                ),
                const SizedBox(height: 4),
                CountdownText(
                  target: releaseAt,
                  prefix: 'Libération dans ',
                  style: const TextStyle(
                      color: TaskoColors.primary, fontWeight: FontWeight.w700, fontSize: 15),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Réputation du client visible par le prestataire avant d'accepter (RG-G7).
class ClientTrustCard extends StatelessWidget {
  const ClientTrustCard({super.key, required this.trust, this.name});
  final ClientTrust trust;
  final String? name;

  @override
  Widget build(BuildContext context) {
    final warn = trust.hasLostDisputes;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: warn ? TaskoColors.danger.withValues(alpha: 0.06) : TaskoColors.surfaceMuted,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
            color: warn ? TaskoColors.danger.withValues(alpha: 0.35) : TaskoColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.shield_outlined, size: 18, color: TaskoColors.primaryDark),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  name == null ? 'Fiabilité du client' : 'Fiabilité de $name',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
                ),
              ),
              if (trust.isNew)
                const _MiniChip(label: 'Nouveau client', color: TaskoColors.info),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _TrustStat(
                icon: Icons.star_rounded,
                color: TaskoColors.accent,
                value: trust.ratingCount == 0 ? '—' : formatRating(trust.ratingAvg),
                label: '${trust.ratingCount} avis',
              ),
              _TrustStat(
                icon: Icons.verified_outlined,
                color: TaskoColors.primary,
                value: '${trust.jobsPaid}',
                label: 'jobs payés',
              ),
              _TrustStat(
                icon: Icons.gavel_rounded,
                color: warn ? TaskoColors.danger : TaskoColors.textMuted,
                value: '${trust.disputesLost}',
                label: 'litiges perdus',
              ),
            ],
          ),
          if (warn) ...[
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.warning_amber_rounded, color: TaskoColors.danger, size: 18),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    trust.isFlagged
                        ? 'Attention : ce client a perdu ${trust.disputesLost} litiges. Il est signalé à l’équipe Tasko.'
                        : 'Attention : ce client a déjà perdu ${trust.disputesLost} litige${trust.disputesLost > 1 ? 's' : ''}. '
                            'Votre paiement reste garanti : l’argent est déjà bloqué chez Tasko.',
                    style: const TextStyle(fontSize: 12, color: TaskoColors.danger, height: 1.3),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _TrustStat extends StatelessWidget {
  const _TrustStat({
    required this.icon,
    required this.color,
    required this.value,
    required this.label,
  });
  final IconData icon;
  final Color color;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Semantics(
          label: '$value $label',
          child: ExcludeSemantics(
            child: Row(
              children: [
                Icon(icon, size: 18, color: color),
                const SizedBox(width: 4),
                Flexible(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text(label,
                          style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      );
}

class _MiniChip extends StatelessWidget {
  const _MiniChip({required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(label,
            style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
      );
}

/// Règles d'annulation affichées clairement selon le statut.
class CancellationPolicyCard extends StatelessWidget {
  const CancellationPolicyCard({super.key, required this.policy});
  final CancellationPolicy policy;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = switch (policy.kind) {
      CancelKind.free => (Icons.check_circle_outline, TaskoColors.primary),
      CancelKind.refund => (Icons.replay_circle_filled_outlined, TaskoColors.primary),
      CancelKind.fee => (Icons.directions_run, TaskoColors.warning),
      CancelKind.forbidden => (Icons.block, TaskoColors.danger),
      CancelKind.none => (Icons.info_outline, TaskoColors.textMuted),
    };
    return InfoBox(icon: icon, color: color, title: policy.title, text: policy.description);
  }
}

/// Grille de photos (preuves) ; un appui agrandit la photo.
class ProofPhotosGrid extends StatelessWidget {
  const ProofPhotosGrid({super.key, required this.urls, this.size = 92});
  final List<String> urls;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (urls.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (var i = 0; i < urls.length; i++)
          Semantics(
            button: true,
            label: 'Photo de preuve ${i + 1}, agrandir',
            child: InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: () => showPhotoViewer(context, urls, initial: i),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: CachedNetworkImage(
                  imageUrl: AppConfig.mediaUrl(urls[i]) ?? '',
                  width: size,
                  height: size,
                  fit: BoxFit.cover,
                  placeholder: (_, _) =>
                      Container(width: size, height: size, color: TaskoColors.surfaceMuted),
                  errorWidget: (_, _, _) => Container(
                    width: size,
                    height: size,
                    color: TaskoColors.surfaceMuted,
                    child: const Icon(Icons.broken_image_outlined, color: TaskoColors.textMuted),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Visionneuse plein écran.
Future<void> showPhotoViewer(BuildContext context, List<String> urls, {int initial = 0}) {
  return showDialog<void>(
    context: context,
    builder: (ctx) => Dialog.fullscreen(
      backgroundColor: Colors.black,
      child: Stack(
        children: [
          PageView(
            controller: PageController(initialPage: initial),
            children: [
              for (final u in urls)
                InteractiveViewer(
                  child: Center(
                    child: CachedNetworkImage(
                      imageUrl: AppConfig.mediaUrl(u) ?? '',
                      fit: BoxFit.contain,
                      errorWidget: (_, _, _) =>
                          const Icon(Icons.broken_image_outlined, color: Colors.white54, size: 48),
                    ),
                  ),
                ),
            ],
          ),
          Positioned(
            top: 12,
            right: 12,
            child: SafeArea(
              child: IconButton.filled(
                tooltip: 'Fermer',
                style: IconButton.styleFrom(backgroundColor: Colors.white24),
                onPressed: () => Navigator.pop(ctx),
                icon: const Icon(Icons.close, color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

/// Ajout de photos envoyées immédiatement sur `POST /uploads`.
class PhotoUploader extends ConsumerStatefulWidget {
  const PhotoUploader({
    super.key,
    required this.urls,
    required this.onChanged,
    this.max = 6,
    this.label = 'Ajouter une photo',
    this.onBusyChanged,
  });

  final List<String> urls;
  final ValueChanged<List<String>> onChanged;
  final int max;
  final String label;

  /// Notifie quand un envoi est en cours (pour bloquer la validation).
  final ValueChanged<bool>? onBusyChanged;

  @override
  ConsumerState<PhotoUploader> createState() => _PhotoUploaderState();
}

class _PhotoUploaderState extends ConsumerState<PhotoUploader> {
  bool _uploading = false;

  void _setBusy(bool v) {
    setState(() => _uploading = v);
    widget.onBusyChanged?.call(v);
  }

  Future<void> _add() async {
    try {
      final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 1600,
        imageQuality: 80,
      );
      if (file == null) return;
      _setBusy(true);
      final url = await ref.read(apiProvider).upload(await file.readAsBytes(), file.name);
      if (url.isEmpty) throw StateError('upload');
      widget.onChanged([...widget.urls, url]);
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) _setBusy(false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (var i = 0; i < widget.urls.length; i++)
          Stack(
            clipBehavior: Clip.none,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: CachedNetworkImage(
                  imageUrl: AppConfig.mediaUrl(widget.urls[i]) ?? '',
                  width: 76,
                  height: 76,
                  fit: BoxFit.cover,
                  errorWidget: (_, _, _) => Container(
                    width: 76,
                    height: 76,
                    color: TaskoColors.surfaceMuted,
                    child: const Icon(Icons.image_outlined, color: TaskoColors.textMuted),
                  ),
                ),
              ),
              Positioned(
                right: -10,
                top: -10,
                child: IconButton(
                  tooltip: 'Retirer la photo ${i + 1}',
                  visualDensity: VisualDensity.compact,
                  onPressed: () {
                    final copy = [...widget.urls]..removeAt(i);
                    widget.onChanged(copy);
                  },
                  icon: const CircleAvatar(
                    radius: 11,
                    backgroundColor: TaskoColors.danger,
                    child: Icon(Icons.close, size: 14, color: Colors.white),
                  ),
                ),
              ),
            ],
          ),
        if (widget.urls.length < widget.max)
          Semantics(
            button: true,
            label: widget.label,
            child: InkWell(
              onTap: _uploading ? null : _add,
              borderRadius: BorderRadius.circular(10),
              child: Container(
                width: 76,
                height: 76,
                decoration: BoxDecoration(
                  color: TaskoColors.surfaceMuted,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: TaskoColors.border),
                ),
                child: _uploading
                    ? const Center(
                        child: SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.4),
                        ),
                      )
                    : const Icon(Icons.add_a_photo_outlined, color: TaskoColors.primary),
              ),
            ),
          ),
      ],
    );
  }
}

/// Bouton « Appeler » : désactivé (avec explication) tant que le numéro est masqué.
class CallButton extends StatelessWidget {
  const CallButton({super.key, required this.phone, this.compact = false});
  final String? phone;
  final bool compact;

  static const hiddenReason =
      'Numéro visible après le paiement sécurisé. Utilisez la messagerie Tasko en attendant.';

  @override
  Widget build(BuildContext context) {
    final available = phone != null && phone!.isNotEmpty;
    void onTap() {
      if (available) {
        launchUrl(Uri.parse('tel:$phone'));
      } else {
        showSnack(context, hiddenReason);
      }
    }

    final bg = available ? TaskoColors.primary : TaskoColors.border;
    final fg = available ? Colors.white : TaskoColors.textMuted;
    final tooltip = available ? 'Appeler' : hiddenReason;
    if (compact) {
      return IconButton.filled(
        tooltip: tooltip,
        style: IconButton.styleFrom(backgroundColor: bg, minimumSize: const Size(48, 48)),
        onPressed: onTap,
        icon: Icon(available ? Icons.call : Icons.phone_locked_outlined, color: fg),
      );
    }
    return Tooltip(
      message: tooltip,
      child: ElevatedButton.icon(
        onPressed: onTap,
        style: ElevatedButton.styleFrom(
          backgroundColor: bg,
          foregroundColor: fg,
          minimumSize: const Size(0, 48),
          padding: const EdgeInsets.symmetric(horizontal: 14),
        ),
        icon: Icon(available ? Icons.call : Icons.phone_locked_outlined, size: 18),
        label: const Text('Appeler'),
      ),
    );
  }
}
