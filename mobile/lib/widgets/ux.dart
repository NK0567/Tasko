import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/formatters.dart';
import '../core/providers.dart';
import '../core/socket_service.dart';
import '../core/theme.dart';
import '../models/job.dart';
import 'common.dart';

/// Frise de progression d'une mission :
/// Payé → En route → Sur place → En cours → Terminé → Payé au prestataire.
class JobProgressBar extends StatelessWidget {
  const JobProgressBar({super.key, required this.status});
  final String status;

  static const labels = ['Payé', 'En route', 'Sur place', 'En cours', 'Terminé', 'Versé'];

  @override
  Widget build(BuildContext context) {
    final step = JobStatus.progressStep(status);
    final current = step < 0 ? 'pas encore payé' : labels[step];
    return Semantics(
      label: 'Progression de la mission : étape ${step + 1} sur ${labels.length}, $current',
      child: ExcludeSemantics(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < labels.length; i++)
              Expanded(
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Container(
                            height: 3,
                            color: i == 0
                                ? Colors.transparent
                                : (i <= step ? StatusColors.ok : TaskoColors.border),
                          ),
                        ),
                        Container(
                          width: i == step ? 22 : 16,
                          height: i == step ? 22 : 16,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: i <= step ? StatusColors.ok : Colors.white,
                            border: Border.all(
                              color: i <= step ? StatusColors.ok : TaskoColors.border,
                              width: 2.5,
                            ),
                          ),
                          child: i < step
                              ? const Icon(Icons.check, size: 11, color: Colors.white)
                              : null,
                        ),
                        Expanded(
                          child: Container(
                            height: 3,
                            color: i == labels.length - 1
                                ? Colors.transparent
                                : (i < step ? StatusColors.ok : TaskoColors.border),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      labels[i],
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: i == step ? FontWeight.w700 : FontWeight.w400,
                        color: i <= step ? TaskoColors.primaryDark : TaskoColors.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Carte « Et maintenant ? » : statut humain + ce qu'il faut faire / attendre.
class NextStepCard extends StatelessWidget {
  const NextStepCard({super.key, required this.job, required this.asProvider});
  final Job job;
  final bool asProvider;

  @override
  Widget build(BuildContext context) {
    final color = JobStatus.color(job.status);
    final text = JobStatus.nextStep(job, asProvider: asProvider);
    return Semantics(
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(14),
          border: Border(left: BorderSide(color: color, width: 4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                StatusBadge(status: job.status),
                const SizedBox(width: 8),
                const Text('Et maintenant ?',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
              ],
            ),
            if (text.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(text, style: const TextStyle(fontSize: 15, height: 1.35)),
            ],
          ],
        ),
      ),
    );
  }
}

/// Récapitulatif explicite des montants, identique sur tous les écrans :
/// « Vous payez 5 250 FCFA dont 250 FCFA de frais Tasko ; le prestataire reçoit 5 000 FCFA ».
class AmountSummary extends StatelessWidget {
  const AmountSummary({
    super.key,
    required this.price,
    required this.serviceFee,
    this.total,
    this.providerReceives,
    this.asProvider = false,
    this.title,
  });

  final int price;
  final int serviceFee;
  final int? total;
  final int? providerReceives;
  final bool asProvider;
  final String? title;

  @override
  Widget build(BuildContext context) {
    final t = total ?? price + serviceFee;
    final receives = providerReceives ?? price;
    final commission = price - receives;
    return TaskoCard(
      color: TaskoColors.surfaceMuted,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(title!, style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
          if (asProvider) ...[
            AmountRow(label: 'Prix de la mission', amount: price),
            if (commission > 0) AmountRow(label: 'Commission Tasko', amount: commission),
            const Divider(),
            AmountRow(label: 'Vous recevez', amount: receives, bold: true),
          ] else ...[
            AmountRow(label: 'Prix de la mission', amount: price),
            AmountRow(label: 'Frais Tasko', amount: serviceFee),
            const Divider(),
            AmountRow(label: 'Vous payez', amount: t, bold: true),
          ],
          const SizedBox(height: 4),
          Text(
            asProvider
                ? 'Le client paie ${formatMoney(t)}. Vous recevez ${formatMoney(receives)}.'
                : 'Vous payez ${formatMoney(t)} dont ${formatMoney(serviceFee)} de frais Tasko ; '
                    'le prestataire reçoit ${formatMoney(receives)}.',
            style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted, height: 1.35),
          ),
        ],
      ),
    );
  }
}

/// Saisie de montant avec séparateur de milliers (« 25 000 »).
class ThousandsInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final digits = newValue.text.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.isEmpty) return const TextEditingValue();
    final trimmed = digits.length > 12 ? digits.substring(0, 12) : digits;
    final formatted = formatMoney(int.parse(trimmed), withCurrency: false);
    return TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(offset: formatted.length),
    );
  }
}

/// Valeur entière d'un champ formaté par [ThousandsInputFormatter].
int parseAmount(String text) => int.tryParse(text.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0;

/// Champ montant prêt à l'emploi (clavier numérique, milliers, « FCFA »).
class AmountField extends StatelessWidget {
  const AmountField({
    super.key,
    required this.controller,
    this.label,
    this.hint,
    this.onChanged,
    this.validator,
    this.autofocus = false,
  });

  final TextEditingController controller;
  final String? label;
  final String? hint;
  final ValueChanged<String>? onChanged;
  final FormFieldValidator<String>? validator;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      autofocus: autofocus,
      keyboardType: TextInputType.number,
      inputFormatters: [ThousandsInputFormatter()],
      autovalidateMode: AutovalidateMode.onUserInteraction,
      validator: validator,
      onChanged: onChanged,
      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        suffixText: 'FCFA',
        prefixIcon: const Icon(Icons.payments_outlined),
      ),
    );
  }
}

/// Bulle d'aide « premiers pas » : fermable, mémorisée (une fois par clé).
class TipBanner extends ConsumerStatefulWidget {
  const TipBanner({super.key, required this.id, required this.text, this.icon = Icons.touch_app});
  final String id;
  final String text;
  final IconData icon;

  @override
  ConsumerState<TipBanner> createState() => _TipBannerState();
}

class _TipBannerState extends ConsumerState<TipBanner> {
  late bool _visible =
      !(ref.read(prefsProvider).getBool('tasko.tip.${widget.id}') ?? false);

  void _close() {
    ref.read(prefsProvider).setBool('tasko.tip.${widget.id}', true);
    setState(() => _visible = false);
  }

  @override
  Widget build(BuildContext context) {
    if (!_visible) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: TaskoColors.info.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 4, 6),
          child: Row(
            children: [
              Icon(widget.icon, color: TaskoColors.info),
              const SizedBox(width: 10),
              Expanded(child: Text(widget.text, style: const TextStyle(fontSize: 14))),
              TextButton(
                onPressed: _close,
                style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                child: const Text('Compris'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Bandeau « Pas de connexion » quand le temps réel est coupé.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: SocketService.instance.offline,
      builder: (context, offline, _) {
        if (!offline) return const SizedBox.shrink();
        return Semantics(
          liveRegion: true,
          child: Container(
            width: double.infinity,
            color: TaskoColors.primaryDark,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: const Row(
              children: [
                Icon(Icons.cloud_off, color: Colors.white, size: 18),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Pas de connexion — vos données se mettront à jour automatiquement.',
                    style: TextStyle(color: Colors.white, fontSize: 13),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Barre d'action principale en bas d'écran (zone du pouce).
class BottomActionBar extends StatelessWidget {
  const BottomActionBar({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: TaskoColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Column(mainAxisSize: MainAxisSize.min, children: children),
      ),
    );
  }
}

/// Squelette de chargement (pas d'écran blanc).
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 4, this.itemHeight = 92});
  final int count;
  final double itemHeight;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Chargement',
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        physics: const NeverScrollableScrollPhysics(),
        itemCount: count,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, _) => Container(
          height: itemHeight,
          decoration: BoxDecoration(
            color: TaskoColors.surfaceMuted,
            borderRadius: BorderRadius.circular(TaskoRadius.card),
          ),
        ),
      ),
    );
  }
}

/// Confirmation d'une action (rouge si dangereuse). Renvoie `true` si confirmé.
Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool danger = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(message, style: const TextStyle(fontSize: 15, height: 1.4)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Retour')),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: danger ? TaskoColors.danger : TaskoColors.primary,
            minimumSize: const Size(48, 48),
          ),
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return ok == true;
}
