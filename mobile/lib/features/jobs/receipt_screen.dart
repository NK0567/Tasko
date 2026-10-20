import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/transaction.dart';
import '../../models/wallet.dart';
import '../../widgets/common.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/tasko_logo.dart';
import '../../widgets/ux.dart';

final receiptProvider = FutureProvider.autoDispose.family<Receipt, String>(
  (ref, jobId) => ref.watch(apiProvider).receipt(jobId),
);

/// Texte brut d'un reçu (partage WhatsApp / SMS / e-mail / copie).
String receiptAsText(Receipt r) {
  final b = StringBuffer()
    ..writeln('Reçu Tasko ${r.number}')
    ..writeln('Émis le ${formatDateTime(r.issuedAt)}')
    ..writeln('Client : ${r.clientName}${r.clientBusiness == null ? '' : ' (${r.clientBusiness})'}')
    ..writeln('Prestataire : ${r.providerName}${r.providerCode == null ? '' : ' — ${r.providerCode}'}');
  for (final l in r.lines) {
    b.writeln('${l.label} : ${formatMoney(l.amount)}');
  }
  b
    ..writeln('Frais Tasko : ${formatMoney(r.serviceFee)}')
    ..writeln('Total : ${formatMoney(r.total)}');
  if (r.paymentMethod != null) b.writeln('Paiement : ${PaymentMethod.label(r.paymentMethod!)}');
  if (r.paymentRef != null) b.writeln('Référence : ${r.paymentRef}');
  return b.toString().replaceAll(' ', ' ');
}

/// Reçu d'une mission terminée, avec partage.
class ReceiptScreen extends ConsumerWidget {
  const ReceiptScreen({super.key, required this.jobId});
  final String jobId;

  Future<void> _share(BuildContext context, Receipt r) async {
    final text = receiptAsText(r);
    final encoded = Uri.encodeComponent(text);
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.chat_outlined, color: TaskoColors.primary),
              title: const Text('Envoyer par WhatsApp'),
              onTap: () => Navigator.pop(ctx, 'wa'),
            ),
            ListTile(
              leading: const Icon(Icons.sms_outlined, color: TaskoColors.primary),
              title: const Text('Envoyer par SMS'),
              onTap: () => Navigator.pop(ctx, 'sms'),
            ),
            ListTile(
              leading: const Icon(Icons.email_outlined, color: TaskoColors.primary),
              title: const Text('Envoyer par e-mail'),
              onTap: () => Navigator.pop(ctx, 'mail'),
            ),
            ListTile(
              leading: const Icon(Icons.copy, color: TaskoColors.primary),
              title: const Text('Copier le texte du reçu'),
              onTap: () => Navigator.pop(ctx, 'copy'),
            ),
          ],
        ),
      ),
    );
    if (choice == null) return;
    if (choice == 'copy') {
      await Clipboard.setData(ClipboardData(text: text));
      if (context.mounted) showSnack(context, 'Reçu copié.');
      return;
    }
    final uri = switch (choice) {
      'wa' => Uri.parse('https://wa.me/?text=$encoded'),
      'sms' => Uri.parse('sms:?body=$encoded'),
      _ => Uri.parse('mailto:?subject=${Uri.encodeComponent('Reçu Tasko ${r.number}')}&body=$encoded'),
    };
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication).catchError((_) => false);
    if (!ok && context.mounted) {
      await Clipboard.setData(ClipboardData(text: text));
      if (context.mounted) showSnack(context, 'Partage indisponible : le reçu a été copié.');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = ref.watch(receiptProvider(jobId));
    return Scaffold(
      appBar: AppBar(title: const Text('Reçu')),
      body: value.when(
        loading: () => const SkeletonList(count: 3, itemHeight: 140),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(receiptProvider(jobId))),
        data: (r) => Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  TaskoCard(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const TaskoLogo(size: 26),
                            const Spacer(),
                            if (r.statusLabel.isNotEmpty)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: TaskoColors.chip,
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Text(r.statusLabel,
                                    style: const TextStyle(
                                        color: TaskoColors.primary, fontWeight: FontWeight.w600)),
                              ),
                          ],
                        ),
                        const SizedBox(height: 14),
                        Text('Reçu n° ${r.number}',
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
                        Text('Émis le ${formatDateTime(r.issuedAt)}',
                            style: const TextStyle(color: TaskoColors.textMuted, fontSize: 13.5)),
                        const Divider(height: 24),
                        _Party(label: 'Client', name: r.clientName, extra: r.clientBusiness),
                        const SizedBox(height: 8),
                        _Party(label: 'Prestataire', name: r.providerName, extra: r.providerCode),
                        const Divider(height: 24),
                        for (final l in r.lines) AmountRow(label: l.label, amount: l.amount),
                        AmountRow(label: 'Frais Tasko', amount: r.serviceFee),
                        const Divider(),
                        AmountRow(label: 'Total payé', amount: r.total, bold: true),
                        const SizedBox(height: 10),
                        if (r.paymentMethod != null)
                          Text('Moyen de paiement : ${PaymentMethod.label(r.paymentMethod!)}',
                              style: const TextStyle(fontSize: 13.5)),
                        if (r.paymentRef != null)
                          SelectableText('Référence de paiement : ${r.paymentRef}',
                              style: const TextStyle(fontSize: 13.5)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            BottomActionBar(children: [
              TaskoButton(
                label: 'Partager le reçu',
                icon: Icons.share_outlined,
                onPressed: () => _share(context, r),
              ),
            ]),
          ],
        ),
      ),
    );
  }
}

class _Party extends StatelessWidget {
  const _Party({required this.label, required this.name, this.extra});
  final String label;
  final String name;
  final String? extra;

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(label, style: const TextStyle(color: TaskoColors.textMuted, fontSize: 14)),
          ),
          Expanded(
            child: Text(
              extra == null || extra!.isEmpty ? name : '$name\n$extra',
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
            ),
          ),
        ],
      );
}
