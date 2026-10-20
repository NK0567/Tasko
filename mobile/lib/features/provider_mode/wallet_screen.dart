import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/transaction.dart';
import '../../models/wallet.dart';
import '../../widgets/common.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import '../menu/menu_screens.dart';

final walletProvider =
    FutureProvider.autoDispose<Wallet>((ref) => ref.watch(apiProvider).wallet());

/// Portefeuille prestataire : argent bloqué, disponible, en attente, historique, retrait.
class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});

  Future<void> _withdraw(BuildContext context, WidgetRef ref, Wallet w) async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _WithdrawSheet(available: w.available),
    );
    if (ok == true) {
      ref.invalidate(walletProvider);
      if (context.mounted) showSnack(context, 'Retrait demandé : vous recevrez l’argent sur votre Mobile Money.');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = ref.watch(walletProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Mon portefeuille')),
      body: value.when(
        skipLoadingOnRefresh: true,
        loading: () => const SkeletonList(count: 4),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(walletProvider)),
        data: (w) => Column(
          children: [
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => ref.refresh(walletProvider.future),
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _BalanceCard(
                      icon: Icons.account_balance_wallet,
                      color: StatusColors.ok,
                      label: 'Disponible',
                      amount: w.available,
                      hint: 'Argent à vous, que vous pouvez retirer maintenant.',
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: _BalanceCard(
                            icon: Icons.lock_clock,
                            color: StatusColors.waiting,
                            label: 'Bloqué pour vos missions',
                            amount: w.held,
                            small: true,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _BalanceCard(
                            icon: Icons.savings_outlined,
                            color: TaskoColors.info,
                            label: 'Total déjà versé',
                            amount: w.paidOutTotal,
                            small: true,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    const SectionHeader(title: 'Paiements en attente de libération'),
                    const SizedBox(height: 6),
                    if (w.pendingRelease.isEmpty)
                      const Text('Aucun paiement en attente.',
                          style: TextStyle(color: TaskoColors.textMuted, fontSize: 14))
                    else
                      for (final p in w.pendingRelease)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: TaskoCard(
                            onTap: () => context.push('/provider-mode/mission/${p.jobId}'),
                            child: Row(
                              children: [
                                const Icon(Icons.timer_outlined, color: StatusColors.waiting),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(p.title,
                                          style: const TextStyle(fontWeight: FontWeight.w600)),
                                      Text(
                                        p.autoReleaseAt == null
                                            ? 'En attente de validation du client'
                                            : 'Versé automatiquement le ${formatShortDateTime(p.autoReleaseAt)}',
                                        style: const TextStyle(
                                            fontSize: 13, color: TaskoColors.textMuted),
                                      ),
                                    ],
                                  ),
                                ),
                                MoneyText(p.amount, color: TaskoColors.primary),
                              ],
                            ),
                          ),
                        ),
                    const SizedBox(height: 18),
                    const SectionHeader(title: 'Historique'),
                    const SizedBox(height: 6),
                    if (w.items.isEmpty)
                      const Text('Aucun mouvement pour le moment.',
                          style: TextStyle(color: TaskoColors.textMuted, fontSize: 14))
                    else
                      for (final t in w.items)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: TransactionTile(tx: t),
                        ),
                  ],
                ),
              ),
            ),
            BottomActionBar(children: [
              TaskoButton(
                label: w.available > 0
                    ? 'Retirer ${formatMoney(w.available)} vers mon MoMo'
                    : 'Retirer vers mon MoMo',
                icon: Icons.south_west,
                onPressed: w.available > 0 ? () => _withdraw(context, ref, w) : null,
              ),
              if (w.available == 0)
                const Padding(
                  padding: EdgeInsets.only(top: 6),
                  child: Text(
                    'Vos gains sont versés automatiquement sur votre Mobile Money à chaque mission validée.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: TaskoColors.textMuted),
                  ),
                ),
            ]),
          ],
        ),
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({
    required this.icon,
    required this.color,
    required this.label,
    required this.amount,
    this.hint,
    this.small = false,
  });

  final IconData icon;
  final Color color;
  final String label;
  final int amount;
  final String? hint;
  final bool small;

  @override
  Widget build(BuildContext context) {
    return TaskoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color),
              const SizedBox(width: 8),
              Expanded(
                child: Text(label,
                    style: const TextStyle(fontSize: 14, color: TaskoColors.textMuted)),
              ),
            ],
          ),
          const SizedBox(height: 6),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(formatMoney(amount),
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: small ? 17 : 26)),
          ),
          if (hint != null)
            Text(hint!, style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted)),
        ],
      ),
    );
  }
}

class _WithdrawSheet extends ConsumerStatefulWidget {
  const _WithdrawSheet({required this.available});
  final int available;

  @override
  ConsumerState<_WithdrawSheet> createState() => _WithdrawSheetState();
}

class _WithdrawSheetState extends ConsumerState<_WithdrawSheet> {
  late final _amount =
      TextEditingController(text: formatMoney(widget.available, withCurrency: false));
  final _phone = TextEditingController();
  String _method = PaymentMethod.mtn;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final p = ref.read(authProvider).user?.provider;
    final momo = p?.momoNumber ?? ref.read(authProvider).user?.phone ?? '';
    _phone.text = momo.startsWith('+237') ? momo.substring(4) : momo;
    if (p?.momoOperator == 'orange') _method = PaymentMethod.orange;
  }

  @override
  void dispose() {
    _amount.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final amount = parseAmount(_amount.text);
    final phone = normalizeCameroonPhone(_phone.text);
    String? err;
    if (amount <= 0) err = 'Indiquez un montant.';
    if (amount > widget.available) err = 'Maximum : ${formatMoney(widget.available)}.';
    if (phone == null) err ??= 'Numéro Mobile Money invalide.';
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiProvider).withdraw(amount: amount, method: _method, phone: phone!);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Retirer vers mon Mobile Money',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 19)),
              const SizedBox(height: 12),
              AmountField(controller: _amount, label: 'Montant à retirer'),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: PaymentMethod.mtn, label: Text('MTN MoMo')),
                  ButtonSegment(value: PaymentMethod.orange, label: Text('Orange Money')),
                ],
                selected: {_method},
                onSelectionChanged: (s) => setState(() => _method = s.first),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(9),
                ],
                decoration: const InputDecoration(
                  labelText: 'Numéro Mobile Money',
                  prefixText: '+237 ',
                ),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(_error!, style: const TextStyle(color: TaskoColors.danger)),
                ),
              const SizedBox(height: 16),
              TaskoButton(
                label: 'Confirmer le retrait',
                icon: Icons.south_west,
                loading: _busy,
                onPressed: _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
