import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../models/transaction.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import '../jobs/job_common.dart';

enum _PayState { form, waiting, success, failed }

/// Écran 7 — Paiement sécurisé (séquestre).
class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({super.key, required this.jobId, this.milestoneId});
  final String jobId;

  /// Étape à payer (sinon : prochaine étape `pending`, ou montant total).
  final String? milestoneId;

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen>
    with JobSubscription<PaymentScreen> {
  String _method = PaymentMethod.mtn;
  final _phone = TextEditingController();
  _PayState _state = _PayState.form;
  Transaction? _tx;
  Timer? _poll;
  int _pollCount = 0;
  bool _submitting = false;
  String? _failure;

  @override
  String get jobId => widget.jobId;

  @override
  void initState() {
    super.initState();
    final phone = ref.read(authProvider).user?.phone ?? '';
    _phone.text = phone.startsWith('+237') ? phone.substring(4) : phone;
    initJobSubscription();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _phone.dispose();
    disposeJobSubscription();
    super.dispose();
  }

  /// Étape visée (paiement par étapes).
  Milestone? _targetMilestone(Job job) {
    if (!job.hasMilestones) return null;
    final wanted = _paidMilestoneId ?? widget.milestoneId;
    if (wanted != null) {
      for (final m in job.milestones) {
        if (m.id == wanted) return m;
      }
    }
    return job.nextPendingMilestone;
  }

  /// Étape effectivement payée depuis cet écran.
  String? _paidMilestoneId;

  /// Vrai quand ce qui est payé ici est sécurisé.
  bool _isSecured(Job job) {
    if (job.hasMilestones) {
      if (_paidMilestoneId == null) return false;
      final m = _targetMilestone(job);
      return m != null && m.status != MilestoneStatus.pending;
    }
    return job.fundsSecured ||
        JobStatus.securedStatuses.contains(job.status) ||
        job.paymentStatus == 'held';
  }

  @override
  void onJobChanged(Job job) {
    if (_state == _PayState.success || !_isSecured(job)) return;
    _poll?.cancel();
    setState(() => _state = _PayState.success);
  }

  Future<void> _pay() async {
    if (_submitting) return; // anti double-tap
    final target = job == null ? null : _targetMilestone(job!);
    _paidMilestoneId = target?.id;
    final phone = normalizeCameroonPhone(_phone.text);
    if (_method != PaymentMethod.card && phone == null) {
      showSnack(context, 'Numéro Mobile Money invalide.', error: true);
      return;
    }
    setState(() {
      _submitting = true;
      _failure = null;
    });
    try {
      final res = await ref.read(apiProvider).payJob(
            widget.jobId,
            method: _method,
            phone: phone ?? ref.read(authProvider).user?.phone ?? '',
            milestoneId: target?.id,
          );
      if (!mounted) return;
      _tx = res.transaction;
      if (res.checkoutUrl != null && res.checkoutUrl!.isNotEmpty) {
        await launchUrl(Uri.parse(res.checkoutUrl!), mode: LaunchMode.externalApplication);
      }
      if (_tx!.isSuccess) {
        setState(() => _state = _PayState.success);
        loadJob(silent: true);
      } else if (_tx!.isFailed) {
        setState(() {
          _state = _PayState.failed;
          _failure = 'Le paiement a été refusé.';
        });
      } else {
        setState(() => _state = _PayState.waiting);
        _startPolling();
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _state = _PayState.failed;
        _failure = errorMessage(e);
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _startPolling() {
    _poll?.cancel();
    _pollCount = 0;
    _poll = Timer.periodic(const Duration(seconds: 2), (_) async {
      _pollCount++;
      if (_tx == null) return;
      try {
        final tx = await ref.read(apiProvider).transaction(_tx!.id);
        if (!mounted) return;
        _tx = tx;
        if (tx.isSuccess) {
          _poll?.cancel();
          setState(() => _state = _PayState.success);
          loadJob(silent: true);
        } else if (tx.isFailed) {
          _poll?.cancel();
          setState(() {
            _state = _PayState.failed;
            _failure = 'Le paiement a échoué. Vérifiez votre solde ou réessayez.';
          });
        }
      } catch (_) {}
      if (_pollCount > 60 && _state == _PayState.waiting) {
        _poll?.cancel();
        setState(() {
          _state = _PayState.failed;
          _failure = 'Délai dépassé. Si vous avez validé le paiement, il sera pris en compte.';
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = jobStateView();
    return Scaffold(
      appBar: AppBar(title: const Text('Paiement sécurisé')),
      body: state ??
          switch (_state) {
            _PayState.form || _PayState.failed => _buildForm(job!),
            _PayState.waiting => _buildWaiting(),
            _PayState.success => _buildSuccess(job!),
          },
    );
  }

  Widget _buildForm(Job job) {
    final milestone = _targetMilestone(job);
    final price = milestone?.amount ?? job.effectivePrice;
    final fee = milestone != null
        ? (milestone.serviceFee > 0 ? milestone.serviceFee : estimateServiceFee(price))
        : (job.serviceFee > 0 ? job.serviceFee : estimateServiceFee(price));
    final total = milestone != null ? price + fee : (job.total > 0 ? job.total : price + fee);
    final receives = milestone != null ? price : job.payout;
    final alreadyPaid = job.hasMilestones
        ? milestone == null
        : (job.fundsSecured || job.paymentStatus == 'held' || job.paymentStatus == 'released');
    final payable = job.hasMilestones
        ? milestone != null &&
            !JobStatus.terminal.contains(job.status) &&
            job.status != JobStatus.requested &&
            job.status != JobStatus.disputed
        : job.status == JobStatus.accepted;
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TaskoCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CategoryIcon(icon: job.category.icon, size: 40),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(job.title,
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                        ),
                      ],
                    ),
                    if (milestone != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        'Étape ${job.milestoneIndex(milestone)}/${job.milestones.length} : ${milestone.title}',
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, color: TaskoColors.primary),
                      ),
                    ],
                    if (job.provider != null) ...[
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          TaskoAvatar(
                              name: job.provider!.fullName,
                              url: job.provider!.avatarUrl,
                              size: 30),
                          const SizedBox(width: 8),
                          Expanded(child: Text(job.provider!.fullName)),
                          if (job.provider!.ratingAvg != null)
                            RatingLabel(rating: job.provider!.ratingAvg!, fontSize: 13),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 12),
              AmountSummary(
                price: price,
                serviceFee: fee,
                total: total,
                providerReceives: receives,
                title: 'Récapitulatif avant paiement',
              ),
              const SizedBox(height: 12),
              const InfoBox(
                icon: Icons.lock_outline,
                text: 'Votre argent est bloqué en sécurité chez Tasko. Le prestataire n’est payé '
                    'qu’à la fin, quand vous validez. En cas de problème, vous êtes protégé.',
              ),
              const SizedBox(height: 18),
              const Text('Comment payez-vous ?',
                  style: TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 15, color: TaskoColors.primaryDark)),
              const SizedBox(height: 8),
              PaymentMethodPicker(value: _method, onChanged: (m) => setState(() => _method = m)),
              if (_method != PaymentMethod.card) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(9),
                  ],
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    labelText: 'Numéro ${PaymentMethod.label(_method)}',
                    prefixText: '+237 ',
                    prefixIcon: const Icon(Icons.phone_android),
                    errorText:
                        _phone.text.length == 9 && normalizeCameroonPhone(_phone.text) == null
                            ? 'Numéro invalide : il doit commencer par 6 ou 2.'
                            : null,
                  ),
                ),
              ],
              if (_failure != null) ...[
                const SizedBox(height: 12),
                InfoBox(
                  icon: Icons.error_outline,
                  color: TaskoColors.danger,
                  text: '$_failure Vous pouvez réessayer.',
                ),
              ],
              if (!payable && !alreadyPaid)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: InfoBox(
                    icon: Icons.hourglass_top,
                    color: StatusColors.waiting,
                    text: 'Le paiement sera possible une fois la demande acceptée '
                        '(statut actuel : ${JobStatus.label(job.status)}).',
                  ),
                ),
            ],
          ),
        ),
        BottomActionBar(children: [
          TaskoButton(
            label: alreadyPaid ? 'Déjà payé : suivre la mission' : 'Payer ${formatMoney(total)}',
            icon: alreadyPaid ? Icons.near_me : Icons.lock_outline,
            loading: _submitting,
            onPressed: alreadyPaid
                ? () => context.pushReplacement(jobRouteFor(job, asProvider: false))
                : (payable ? _pay : null),
          ),
        ]),
      ],
    );
  }

  Widget _buildWaiting() {
    return Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(
            width: 72,
            height: 72,
            child: CircularProgressIndicator(strokeWidth: 5, color: TaskoColors.primary),
          ),
          const SizedBox(height: 24),
          const Text('Confirmez le paiement sur votre téléphone',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text(
            _method == PaymentMethod.card
                ? 'Finalisez le paiement dans la page qui s’est ouverte.'
                : 'Composez votre code secret ${PaymentMethod.label(_method)} pour valider '
                    '${_tx == null ? '' : formatMoney(_tx!.amount)}.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: TaskoColors.textMuted),
          ),
          const SizedBox(height: 24),
          TextButton(
            onPressed: () {
              _poll?.cancel();
              setState(() => _state = _PayState.form);
            },
            child: const Text('Changer de moyen de paiement'),
          ),
        ],
      ),
    );
  }

  Widget _buildSuccess(Job job) {
    final code = job.startCode;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 12),
        Center(
          child: Container(
            width: 96,
            height: 96,
            decoration: const BoxDecoration(color: TaskoColors.primary, shape: BoxShape.circle),
            child: const Icon(Icons.check_rounded, color: Colors.white, size: 60),
          ),
        ),
        const SizedBox(height: 20),
        const Text('Paiement réussi !',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        Text(
          '${formatMoney(_tx?.amount ?? job.clientTotal)} sont bloqués en sécurité chez Tasko. '
          'Le prestataire sera payé à la fin, après votre validation.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: TaskoColors.textMuted, fontSize: 15, height: 1.4),
        ),
        if (code != null) ...[
          const SizedBox(height: 20),
          StartCodeCard(code: code),
        ],
        const SizedBox(height: 28),
        TaskoButton(
          label: 'Suivre la mission',
          icon: Icons.near_me,
          onPressed: () => context.pushReplacement(jobRouteFor(job, asProvider: false)),
        ),
      ],
    );
  }
}

/// Choix du moyen de paiement (MoMo / Orange Money / Carte).
class PaymentMethodPicker extends StatelessWidget {
  const PaymentMethodPicker({super.key, required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget option(String method, Widget logo, String subtitle) {
      final selected = value == method;
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: InkWell(
          borderRadius: BorderRadius.circular(TaskoRadius.button),
          onTap: () => onChanged(method),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(TaskoRadius.button),
              border: Border.all(
                color: selected ? TaskoColors.primary : TaskoColors.border,
                width: selected ? 1.6 : 1,
              ),
              color: selected ? TaskoColors.chip : Colors.white,
            ),
            child: Row(
              children: [
                logo,
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(PaymentMethod.label(method),
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      Text(subtitle,
                          style: const TextStyle(fontSize: 11.5, color: TaskoColors.textMuted)),
                    ],
                  ),
                ),
                Icon(
                  selected ? Icons.radio_button_checked : Icons.radio_button_off,
                  color: selected ? TaskoColors.primary : TaskoColors.textMuted,
                ),
              ],
            ),
          ),
        ),
      );
    }

    Widget logo(Color bg, String text, Color fg) => Container(
          width: 44,
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
          child: Text(text,
              style: TextStyle(color: fg, fontWeight: FontWeight.w800, fontSize: 11)),
        );

    return Column(
      children: [
        option(PaymentMethod.mtn, logo(TaskoColors.mtn, 'MoMo', TaskoColors.primaryDark),
            'Paiement via MTN Mobile Money'),
        option(PaymentMethod.orange, logo(TaskoColors.orange, 'OM', Colors.white),
            'Paiement via Orange Money'),
        option(
          PaymentMethod.card,
          Container(
            width: 44,
            height: 32,
            decoration: BoxDecoration(
              color: TaskoColors.primaryDark,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.credit_card, color: Colors.white, size: 20),
          ),
          'Visa / Mastercard',
        ),
      ],
    );
  }
}
