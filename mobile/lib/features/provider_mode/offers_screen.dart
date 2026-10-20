import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/transaction.dart';
import '../../widgets/common.dart';
import '../../widgets/tasko_button.dart';
import '../payment/payment_screen.dart';

/// Offres Tasko Pro (abonnement) et Boost (mise en avant).
class OffersScreen extends ConsumerStatefulWidget {
  const OffersScreen({super.key});

  @override
  ConsumerState<OffersScreen> createState() => _OffersScreenState();
}

enum _Offer { pro, boostDay, boostMonth }

class _OffersScreenState extends ConsumerState<OffersScreen> {

  /// Tarifs issus de `/settings/public` (défauts du contrat hors ligne).
  Map<_Offer, int> get _prices {
    final s = ref.watch(settingsValueProvider);
    return {_Offer.pro: s.proPlanPrice, _Offer.boostDay: s.boostDayPrice, _Offer.boostMonth: s.boostMonthPrice};
  }

  _Offer _offer = _Offer.pro;
  String _method = PaymentMethod.mtn;
  final _phone = TextEditingController();
  bool _paying = false;
  String? _status;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    final p = user?.provider?.momoNumber ?? user?.phone ?? '';
    _phone.text = p.startsWith('+237') ? p.substring(4) : p;
    if (user?.provider?.momoOperator == 'orange') _method = PaymentMethod.orange;
  }

  @override
  void dispose() {
    _poll?.cancel();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _pay() async {
    if (_paying) return; // anti double-tap
    final phone = normalizeCameroonPhone(_phone.text);
    if (_method != PaymentMethod.card && phone == null) {
      showSnack(context, 'Numéro Mobile Money invalide.', error: true);
      return;
    }
    setState(() {
      _paying = true;
      _status = null;
    });
    try {
      final api = ref.read(apiProvider);
      final tx = _offer == _Offer.pro
          ? await api.subscribePro(method: _method, phone: phone ?? '')
          : await api.boost(
              duration: _offer == _Offer.boostDay ? 'day' : 'month',
              method: _method,
              phone: phone ?? '',
            );
      _watch(tx);
    } catch (e) {
      if (mounted) {
        setState(() => _paying = false);
        showSnack(context, errorMessage(e), error: true);
      }
    }
  }

  void _watch(Transaction tx) {
    if (tx.isSuccess) return _done(true);
    if (tx.isFailed) return _done(false);
    setState(() => _status = 'Confirmez le paiement sur votre téléphone…');
    var count = 0;
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 2), (_) async {
      count++;
      try {
        final t = await ref.read(apiProvider).transaction(tx.id);
        if (t.isSuccess) _done(true);
        if (t.isFailed) _done(false);
      } catch (_) {}
      if (count > 45) _done(false);
    });
  }

  void _done(bool ok) {
    _poll?.cancel();
    if (!mounted) return;
    setState(() {
      _paying = false;
      _status = ok ? null : 'Le paiement n’a pas abouti.';
    });
    if (ok) {
      ref.read(authProvider.notifier).refreshMe();
      showSnack(context, _offer == _Offer.pro ? 'Bienvenue dans Tasko Pro !' : 'Boost activé !');
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(authProvider).user?.provider;
    return Scaffold(
      appBar: AppBar(title: const Text('Tasko Pro & Boost')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (profile?.isPro ?? false)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: TaskoCard(
                color: TaskoColors.accent.withValues(alpha: 0.15),
                child: Text(
                  'Vous êtes Tasko Pro${profile?.proUntil == null ? '' : ' jusqu’au ${formatDate(profile!.proUntil)}'}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
            ),
          _OfferCard(
            selected: _offer == _Offer.pro,
            onTap: () => setState(() => _offer = _Offer.pro),
            icon: Icons.workspace_premium,
            color: TaskoColors.accent,
            title: 'Tasko Pro',
            price: '${formatMoney(_prices[_Offer.pro])} / mois',
            perks: const [
              'Badge PRO sur votre profil',
              'Meilleur classement dans les recherches',
              'Statistiques détaillées de vos missions',
            ],
          ),
          const SizedBox(height: 10),
          _OfferCard(
            selected: _offer == _Offer.boostDay,
            onTap: () => setState(() => _offer = _Offer.boostDay),
            icon: Icons.rocket_launch,
            color: TaskoColors.primary,
            title: 'Boost 24 h',
            price: formatMoney(_prices[_Offer.boostDay]),
            perks: const ['Mis en avant en tête des résultats pendant 24 h'],
          ),
          const SizedBox(height: 10),
          _OfferCard(
            selected: _offer == _Offer.boostMonth,
            onTap: () => setState(() => _offer = _Offer.boostMonth),
            icon: Icons.trending_up,
            color: TaskoColors.info,
            title: 'Boost 30 jours',
            price: formatMoney(_prices[_Offer.boostMonth]),
            perks: const ['Mis en avant pendant un mois', 'Idéal pour lancer votre activité'],
          ),
          const SizedBox(height: 20),
          const SectionHeader(title: 'Moyen de paiement'),
          const SizedBox(height: 8),
          PaymentMethodPicker(value: _method, onChanged: (m) => setState(() => _method = m)),
          if (_method != PaymentMethod.card) ...[
            const SizedBox(height: 10),
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
          ],
          if (_status != null) ...[
            const SizedBox(height: 12),
            Text(_status!, textAlign: TextAlign.center),
          ],
          const SizedBox(height: 20),
          TaskoButton(
            label: 'Payer ${formatMoney(_prices[_offer])}',
            icon: Icons.lock_outline,
            loading: _paying,
            onPressed: _pay,
          ),
          const SizedBox(height: 8),
          const Text(
            'Le montant débité est confirmé par Tasko au moment du paiement.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11.5, color: TaskoColors.textMuted),
          ),
        ],
      ),
    );
  }
}

class _OfferCard extends StatelessWidget {
  const _OfferCard({
    required this.selected,
    required this.onTap,
    required this.icon,
    required this.color,
    required this.title,
    required this.price,
    required this.perks,
  });

  final bool selected;
  final VoidCallback onTap;
  final IconData icon;
  final Color color;
  final String title;
  final String price;
  final List<String> perks;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(TaskoRadius.card),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(TaskoRadius.card),
          border: Border.all(color: selected ? color : TaskoColors.border, width: selected ? 2 : 1),
          color: selected ? color.withValues(alpha: 0.07) : Colors.white,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              backgroundColor: color.withValues(alpha: 0.18),
              child: Icon(icon, color: color),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(title,
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      ),
                      Text(price,
                          style: TextStyle(fontWeight: FontWeight.w700, color: color == TaskoColors.accent ? TaskoColors.primaryDark : color)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  for (final p in perks)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.check, size: 16, color: TaskoColors.primary),
                          const SizedBox(width: 6),
                          Expanded(child: Text(p, style: const TextStyle(fontSize: 12.5))),
                        ],
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
