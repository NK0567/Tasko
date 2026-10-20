import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/socket_service.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../models/json.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/milestones.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import '../jobs/job_common.dart';

final tendersProvider = FutureProvider.autoDispose.family<List<Job>, String>(
  (ref, q) => ref.watch(apiProvider).tenders(q: q.isEmpty ? null : q),
);

// ---------------------------------------------------------------------------
// Prestataire : liste des appels d'offres
// ---------------------------------------------------------------------------

/// Liste des appels d'offres ouverts (onglet « Appels d'offres »).
class TendersList extends ConsumerStatefulWidget {
  const TendersList({super.key});

  @override
  ConsumerState<TendersList> createState() => _TendersListState();
}

class _TendersListState extends ConsumerState<TendersList> {
  final _search = TextEditingController();
  String _q = '';
  Timer? _debounce;

  @override
  void dispose() {
    _search.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final value = ref.watch(tendersProvider(_q));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 450), () {
                if (mounted) setState(() => _q = v.trim());
              });
            },
            decoration: const InputDecoration(
              hintText: 'Rechercher un appel d’offres',
              prefixIcon: Icon(Icons.search),
            ),
          ),
        ),
        Expanded(
          child: value.when(
            skipLoadingOnRefresh: true,
            loading: () => const SkeletonList(),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(tendersProvider(_q))),
            data: (list) => list.isEmpty
                ? EmptyView(
                    title: 'Aucun appel d’offres ouvert',
                    message: 'Les grands travaux et contrats de votre ville apparaîtront ici. '
                        'Complétez vos compétences pour en recevoir plus.',
                    actionLabel: 'Mes compétences',
                    onAction: () => context.push('/provider-mode/skills'),
                  )
                : RefreshIndicator(
                    onRefresh: () => ref.refresh(tendersProvider(_q).future),
                    child: ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: list.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (_, i) => TenderCard(
                        job: list[i],
                        onTap: () async {
                          await context.push('/tenders/${list[i].id}');
                          ref.invalidate(tendersProvider(_q));
                        },
                      ),
                    ),
                  ),
          ),
        ),
      ],
    );
  }
}

/// Écran autonome « Appels d'offres » (route `/tenders`).
class TendersScreen extends StatelessWidget {
  const TendersScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Appels d’offres')),
        body: const TendersList(),
      );
}

class TenderCard extends StatelessWidget {
  const TenderCard({super.key, required this.job, this.onTap});
  final Job job;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final bid = job.myBid;
    return TaskoCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CategoryIcon(icon: job.category.icon, size: 44),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(job.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                    Text(
                      [job.category.name, if (job.address.isNotEmpty) job.address].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 12,
            runSpacing: 6,
            children: [
              _Meta(Icons.payments_outlined, job.budgetRangeLabel ?? 'Budget libre'),
              _Meta(Icons.groups_outlined, '${job.bidsCount} devis'),
              if (job.bidDeadline != null)
                _Meta(Icons.timer_outlined, 'Jusqu’au ${formatShortDateTime(job.bidDeadline)}'),
              if (job.visibility == 'invited') const _Meta(Icons.mail_outline, 'Sur invitation'),
            ],
          ),
          if (bid != null) ...[
            const SizedBox(height: 8),
            Text(
              'Votre devis : ${formatMoney(bid.amount)} · ${BidStatus.label(bid.status)}',
              style: TextStyle(
                  fontWeight: FontWeight.w600, color: BidStatus.color(bid.status), fontSize: 14),
            ),
          ],
        ],
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta(this.icon, this.text);
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: TaskoColors.primary),
          const SizedBox(width: 4),
          Text(text, style: const TextStyle(fontSize: 13)),
        ],
      );
}

// ---------------------------------------------------------------------------
// Prestataire : détail + devis
// ---------------------------------------------------------------------------

class TenderDetailScreen extends ConsumerStatefulWidget {
  const TenderDetailScreen({super.key, required this.jobId});
  final String jobId;

  @override
  ConsumerState<TenderDetailScreen> createState() => _TenderDetailScreenState();
}

class _TenderDetailScreenState extends ConsumerState<TenderDetailScreen>
    with JobSubscription<TenderDetailScreen> {
  Bid? _myBid;
  bool _busy = false;

  @override
  String get jobId => widget.jobId;

  @override
  void initState() {
    super.initState();
    initJobSubscription();
    listenSocket('bid:updated', (data) {
      final b = Bid.fromJson(data);
      if (b.jobId != widget.jobId) return;
      setState(() => _myBid = b);
      if (b.status == BidStatus.accepted) {
        showSnack(context, 'Bravo ! Votre devis a été retenu.');
        loadJob(silent: true);
      } else if (b.status == BidStatus.rejected) {
        showSnack(context, 'Le client a choisi un autre devis.');
      }
    });
    _loadBid();
  }

  @override
  void dispose() {
    disposeJobSubscription();
    super.dispose();
  }

  @override
  void onJobChanged(Job job) {
    if (job.myBid != null) _myBid = job.myBid;
  }

  Future<void> _loadBid() async {
    try {
      final list = await ref.read(apiProvider).bids(widget.jobId);
      final me = ref.read(authProvider).user?.id;
      final mine = list.where((b) => b.provider?.id == me || list.length == 1).firstOrNull;
      if (mounted && mine != null) setState(() => _myBid = mine);
    } catch (_) {}
  }

  Future<void> _edit(Job job) async {
    final bid = await showModalBottomSheet<Bid>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => BidFormSheet(job: job, initial: _myBid),
    );
    if (bid != null && mounted) {
      setState(() => _myBid = bid);
      showSnack(context, 'Devis envoyé au client.');
    }
  }

  Future<void> _withdraw(Job job) async {
    final bid = _myBid;
    if (bid == null || _busy) return;
    final ok = await confirmAction(
      context,
      title: 'Retirer votre devis ?',
      message: 'Le client ne le verra plus. Vous pourrez en envoyer un nouveau tant que l’appel d’offres est ouvert.',
      confirmLabel: 'Oui, retirer',
      danger: true,
    );
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).withdrawBid(job.id, bid.id);
      if (!mounted) return;
      setState(() => _myBid = null);
      showSnack(context, 'Devis retiré.');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = jobStateView();
    return Scaffold(
      appBar: AppBar(title: const Text('Appel d’offres')),
      body: state ?? _body(job!),
    );
  }

  Widget _body(Job job) {
    final open = job.tenderOpen();
    final bid = _myBid != null && _myBid!.status != BidStatus.withdrawn ? _myBid : null;
    final me = ref.watch(authProvider).user?.id;
    final won = job.provider?.id == me && job.provider != null;
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(job.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
              const SizedBox(height: 4),
              Text('${job.category.name} · publié par ${job.client.fullName}',
                  style: const TextStyle(color: TaskoColors.textMuted, fontSize: 14)),
              const SizedBox(height: 12),
              if (job.bidDeadline != null)
                InfoBox(
                  icon: Icons.timer_outlined,
                  color: open ? StatusColors.waiting : StatusColors.closed,
                  title: open
                      ? 'Devis acceptés jusqu’au ${formatShortDateTime(job.bidDeadline)}'
                      : 'Appel d’offres clos',
                  text: open
                      ? 'Le client compare les devis puis choisit. Vous serez prévenu.'
                      : 'Plus aucun devis n’est accepté.',
                  trailing: open
                      ? CountdownText(
                          target: job.bidDeadline!,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))
                      : null,
                ),
              const SizedBox(height: 12),
              if (job.description.isNotEmpty)
                Text(job.description, style: const TextStyle(fontSize: 15, height: 1.45)),
              const SizedBox(height: 12),
              Wrap(
                spacing: 14,
                runSpacing: 8,
                children: [
                  _Meta(Icons.payments_outlined, job.budgetRangeLabel ?? 'Budget libre'),
                  _Meta(Icons.groups_outlined, '${job.bidsCount} devis reçus'),
                  if (job.address.isNotEmpty) _Meta(Icons.place_outlined, job.address),
                  if (job.property != null) _Meta(Icons.apartment, job.property!.name),
                ],
              ),
              if (job.hasMilestones) ...[
                const SizedBox(height: 14),
                const Text('Étapes souhaitées par le client',
                    style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                MilestoneTimeline(milestones: job.milestones),
              ],
              if (job.client.trust != null) ...[
                const SizedBox(height: 14),
                ClientTrustCard(trust: job.client.trust!, name: job.client.fullName),
              ],
              const SizedBox(height: 14),
              if (bid != null)
                TaskoCard(
                  color: TaskoColors.chip,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Text('Votre devis',
                              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                          const Spacer(),
                          Text(BidStatus.label(bid.status),
                              style: TextStyle(
                                  color: BidStatus.color(bid.status), fontWeight: FontWeight.w600)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(formatMoney(bid.amount),
                          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                      if (bid.durationDays != null)
                        Text('Délai : ${bid.durationDays} jour${bid.durationDays! > 1 ? 's' : ''}'),
                      if (bid.message.isNotEmpty) Text(bid.message),
                      if (bid.milestones.isNotEmpty)
                        Text('${bid.milestones.length} étapes de paiement proposées',
                            style: const TextStyle(color: TaskoColors.textMuted)),
                      if (bid.isPending && open)
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton.icon(
                            onPressed: _busy ? null : () => _withdraw(job),
                            style: TextButton.styleFrom(
                                foregroundColor: TaskoColors.danger,
                                minimumSize: const Size(48, 48)),
                            icon: const Icon(Icons.undo),
                            label: const Text('Retirer mon devis'),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        BottomActionBar(children: [
          if (won)
            TaskoButton(
              label: 'Ouvrir la mission',
              icon: Icons.work_outline,
              onPressed: () => context.pushReplacement(jobRouteFor(job, asProvider: true)),
            )
          else
            TaskoButton(
              label: bid == null ? 'Envoyer mon devis' : 'Modifier mon devis',
              icon: bid == null ? Icons.send : Icons.edit_outlined,
              onPressed: open && (bid == null || bid.isPending) ? () => _edit(job) : null,
            ),
        ]),
      ],
    );
  }
}

/// Formulaire de devis : montant, délai, message, pièces jointes, étapes.
class BidFormSheet extends ConsumerStatefulWidget {
  const BidFormSheet({super.key, required this.job, this.initial});
  final Job job;
  final Bid? initial;

  @override
  ConsumerState<BidFormSheet> createState() => _BidFormSheetState();
}

class _BidFormSheetState extends ConsumerState<BidFormSheet> {
  late final _amount = TextEditingController(
      text: widget.initial == null ? '' : formatMoney(widget.initial!.amount, withCurrency: false));
  late final _days =
      TextEditingController(text: widget.initial?.durationDays?.toString() ?? '');
  late final _message = TextEditingController(text: widget.initial?.message ?? '');
  late List<String> _attachments = [...?widget.initial?.attachments];
  late List<MilestoneDraft> _milestones = [...?widget.initial?.milestones];
  bool _uploading = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    _days.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final amount = parseAmount(_amount.text);
    String? err;
    if (amount <= 0) err = 'Indiquez votre prix.';
    final sum = _milestones.fold<int>(0, (s, m) => s + m.amount);
    if (_milestones.isNotEmpty && sum != amount) {
      err ??= 'Le total des étapes (${formatMoney(sum)}) doit être égal à votre prix.';
    }
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final bid = await ref.read(apiProvider).submitBid(
            widget.job.id,
            amount: amount,
            durationDays: int.tryParse(_days.text),
            message: _message.text.trim(),
            attachments: _attachments,
            milestones: _milestones,
          );
      if (mounted) Navigator.pop(context, bid);
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
              Text(widget.initial == null ? 'Votre devis' : 'Modifier votre devis',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 19)),
              if (widget.job.budgetRangeLabel != null)
                Text('Budget indicatif du client : ${widget.job.budgetRangeLabel}',
                    style: const TextStyle(color: TaskoColors.textMuted, fontSize: 14)),
              const SizedBox(height: 14),
              AmountField(
                controller: _amount,
                label: 'Votre prix total',
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _days,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: 'Délai de réalisation',
                  suffixText: 'jours',
                  prefixIcon: Icon(Icons.schedule),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _message,
                minLines: 3,
                maxLines: 6,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Message au client',
                  hintText: 'Votre expérience, ce qui est compris dans le prix…',
                ),
              ),
              const SizedBox(height: 14),
              const Text('Pièces jointes (photos de devis, réalisations)',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              PhotoUploader(
                urls: _attachments,
                label: 'Ajouter une pièce jointe',
                onChanged: (v) => setState(() => _attachments = v),
                onBusyChanged: (v) => setState(() => _uploading = v),
              ),
              const SizedBox(height: 14),
              const Text('Paiement par étapes (optionnel)',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              MilestonesEditor(
                initial: _milestones,
                expectedTotal: parseAmount(_amount.text),
                onChanged: (v) => _milestones = v,
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(_error!, style: const TextStyle(color: TaskoColors.danger)),
                ),
              const SizedBox(height: 16),
              TaskoButton(
                label: 'Envoyer mon devis',
                icon: Icons.send,
                loading: _busy,
                onPressed: _uploading ? null : _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Client : devis reçus, comparateur, attribution
// ---------------------------------------------------------------------------

enum _BidSort { score, price, duration, rating }

class ClientTenderScreen extends ConsumerStatefulWidget {
  const ClientTenderScreen({super.key, required this.jobId});
  final String jobId;

  @override
  ConsumerState<ClientTenderScreen> createState() => _ClientTenderScreenState();
}

class _ClientTenderScreenState extends ConsumerState<ClientTenderScreen>
    with JobSubscription<ClientTenderScreen> {
  List<Bid> _bids = const [];
  bool _bidsLoading = true;
  Object? _bidsError;
  _BidSort _sort = _BidSort.score;
  bool _compare = false;
  String? _awarding;

  @override
  String get jobId => widget.jobId;

  @override
  void initState() {
    super.initState();
    initJobSubscription();
    listenSocket('bid:new', _onBid);
    listenSocket('bid:updated', _onBid);
    _subsReconnect = SocketService.instance.reconnected.listen((_) => _loadBids());
    _loadBids();
  }

  StreamSubscription<void>? _subsReconnect;

  @override
  void dispose() {
    _subsReconnect?.cancel();
    disposeJobSubscription();
    super.dispose();
  }

  @override
  void onJobChanged(Job job) {
    if (job.status != JobStatus.requested && job.provider != null && _awarding == null) {
      // Attribué (ici ou ailleurs) : on passe au paiement.
      context.pushReplacement(jobRouteFor(job, asProvider: false));
    }
  }

  void _onBid(Json data) {
    final b = Bid.fromJson(data);
    if (b.jobId != widget.jobId) return;
    final list = [..._bids];
    final i = list.indexWhere((e) => e.id == b.id);
    if (b.status == BidStatus.withdrawn) {
      if (i >= 0) list.removeAt(i);
    } else if (i >= 0) {
      list[i] = b;
    } else {
      list.add(b);
      showSnack(context, 'Nouveau devis de ${b.provider?.fullName ?? 'un prestataire'}.');
    }
    setState(() => _bids = list);
  }

  Future<void> _loadBids() async {
    try {
      final list = await ref.read(apiProvider).bids(widget.jobId);
      if (!mounted) return;
      setState(() {
        _bids = list.where((b) => b.status != BidStatus.withdrawn).toList();
        _bidsLoading = false;
        _bidsError = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _bidsLoading = false;
        _bidsError = e;
      });
    }
  }

  List<Bid> get _sorted {
    final list = [..._bids];
    switch (_sort) {
      case _BidSort.price:
        list.sort((a, b) => a.amount.compareTo(b.amount));
      case _BidSort.duration:
        list.sort((a, b) => (a.durationDays ?? 9999).compareTo(b.durationDays ?? 9999));
      case _BidSort.rating:
        list.sort((a, b) => (b.provider?.ratingAvg ?? 0).compareTo(a.provider?.ratingAvg ?? 0));
      case _BidSort.score:
        break; // ordre du serveur (score)
    }
    return list;
  }

  Future<void> _award(Job job, Bid bid) async {
    if (_awarding != null) return;
    final fee = estimateServiceFee(bid.amount,
        rate: ref.read(settingsValueProvider).clientFeeRate,
        minFee: ref.read(settingsValueProvider).minServiceFee);
    final ok = await confirmAction(
      context,
      title: 'Choisir ce devis ?',
      message: '${bid.provider?.fullName ?? 'Ce prestataire'} réalisera la mission pour '
          '${formatMoney(bid.amount)} (+ environ ${formatMoney(fee)} de frais Tasko).\n\n'
          'Les autres devis seront refusés. Vous paierez ensuite : l’argent reste bloqué chez Tasko '
          'jusqu’à la fin des travaux.',
      confirmLabel: 'Oui, choisir ce devis',
    );
    if (!ok || !mounted) return;
    setState(() => _awarding = bid.id);
    try {
      final j = await ref.read(apiProvider).awardBid(job.id, bid.id);
      if (!mounted) return;
      showSnack(context, 'Devis choisi. Payez pour lancer la mission.');
      context.pushReplacement(jobRouteFor(j, asProvider: false));
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _awarding = null);
    }
  }

  Future<void> _cancel(Job job) async {
    final ok = await confirmAction(
      context,
      title: 'Annuler l’appel d’offres ?',
      message: 'Les prestataires ne pourront plus envoyer de devis. Vous n’avez rien payé.',
      confirmLabel: 'Oui, annuler',
      danger: true,
    );
    if (!ok || !mounted) return;
    try {
      await ref.read(apiProvider).cancelJob(job.id, reason: 'Appel d’offres annulé par le client');
      if (mounted) context.go('/home');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = jobStateView();
    final j = job;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Devis reçus'),
        actions: [
          if (j != null && j.status == JobStatus.requested)
            PopupMenuButton<String>(
              tooltip: 'Plus d’options',
              onSelected: (_) => _cancel(j),
              itemBuilder: (_) => const [
                PopupMenuItem(
                  value: 'cancel',
                  child: ListTile(
                    leading: Icon(Icons.cancel_outlined, color: TaskoColors.danger),
                    title: Text('Annuler l’appel d’offres'),
                  ),
                ),
              ],
            ),
        ],
      ),
      body: state ?? _body(j!),
    );
  }

  Widget _body(Job job) {
    final bids = _sorted;
    return RefreshIndicator(
      onRefresh: () async {
        await loadJob(silent: true);
        await _loadBids();
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(job.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
          const SizedBox(height: 6),
          if (job.bidDeadline != null)
            InfoBox(
              icon: Icons.timer_outlined,
              color: job.tenderOpen() ? StatusColors.waiting : StatusColors.closed,
              title: job.tenderOpen()
                  ? 'Devis acceptés jusqu’au ${formatShortDateTime(job.bidDeadline)}'
                  : 'Date limite passée : choisissez un devis',
              text: 'Comparez les prix, délais et avis, puis touchez « Choisir ce devis ».',
            ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Text('${bids.length} devis',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              ),
              if (bids.length > 1)
                TextButton.icon(
                  onPressed: () => setState(() => _compare = !_compare),
                  style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                  icon: Icon(_compare ? Icons.view_agenda_outlined : Icons.table_chart_outlined),
                  label: Text(_compare ? 'Voir en liste' : 'Comparer'),
                ),
            ],
          ),
          if (bids.length > 1)
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final (s, l) in const [
                    (_BidSort.score, 'Recommandés'),
                    (_BidSort.price, 'Moins cher'),
                    (_BidSort.duration, 'Plus rapide'),
                    (_BidSort.rating, 'Mieux notés'),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(right: 8, top: 4, bottom: 8),
                      child: TaskoChip(
                        label: l,
                        selected: _sort == s,
                        onTap: () => setState(() => _sort = s),
                      ),
                    ),
                ],
              ),
            ),
          if (_bidsLoading)
            const SizedBox(height: 200, child: SkeletonList(count: 2))
          else if (_bidsError != null && bids.isEmpty)
            ErrorView(error: _bidsError!, onRetry: _loadBids, compact: true)
          else if (bids.isEmpty)
            const EmptyView(
              compact: true,
              title: 'Pas encore de devis',
              message: 'Les prestataires sont prévenus. Les devis apparaissent ici en direct.',
            )
          else if (_compare)
            _Comparator(bids: bids, onAward: (b) => _award(job, b), awarding: _awarding)
          else
            for (final b in bids)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _BidCard(
                  bid: b,
                  awarding: _awarding == b.id,
                  onAward: _awarding == null ? () => _award(job, b) : null,
                ),
              ),
        ],
      ),
    );
  }
}

class _BidCard extends StatelessWidget {
  const _BidCard({required this.bid, this.onAward, this.awarding = false});
  final Bid bid;
  final VoidCallback? onAward;
  final bool awarding;

  @override
  Widget build(BuildContext context) {
    final p = bid.provider;
    return TaskoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: p == null ? null : () => context.push('/provider/${p.id}'),
            child: Row(
              children: [
                TaskoAvatar(name: p?.fullName, url: p?.avatarUrl, size: 44),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(p?.fullName ?? 'Prestataire',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      Row(
                        children: [
                          RatingLabel(rating: p?.ratingAvg ?? 0, count: p?.ratingCount),
                          const SizedBox(width: 8),
                          Flexible(
                            child: Text('${p?.missionsCompleted ?? 0} missions',
                                style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted)),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if ((p?.verificationLevel ?? 1) >= 3)
                  const Tooltip(
                    message: 'Identité vérifiée',
                    child: Icon(Icons.verified, color: TaskoColors.info),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Text(formatMoney(bid.amount),
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.w800, color: TaskoColors.primary)),
              const Spacer(),
              if (bid.durationDays != null)
                Text('${bid.durationDays} jour${bid.durationDays! > 1 ? 's' : ''}',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
            ],
          ),
          if (bid.message.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(bid.message, style: const TextStyle(fontSize: 14.5, height: 1.4)),
          ],
          if (bid.attachments.isNotEmpty) ...[
            const SizedBox(height: 8),
            ProofPhotosGrid(urls: bid.attachments, size: 64),
          ],
          if (bid.milestones.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final (i, m) in bid.milestones.indexed)
              Text('Étape ${i + 1} · ${m.title} : ${formatMoney(m.amount)}',
                  style: const TextStyle(fontSize: 13.5)),
          ],
          if (!bid.isPending) ...[
            const SizedBox(height: 6),
            Text(BidStatus.label(bid.status),
                style: TextStyle(color: BidStatus.color(bid.status), fontWeight: FontWeight.w600)),
          ],
          if (bid.isPending) ...[
            const SizedBox(height: 10),
            TaskoButton(
              label: 'Choisir ce devis',
              icon: Icons.check_circle_outline,
              height: 48,
              loading: awarding,
              onPressed: onAward,
            ),
          ],
        ],
      ),
    );
  }
}

/// Tableau comparatif des devis (prix, délai, note, missions, vérification, étapes).
class _Comparator extends StatelessWidget {
  const _Comparator({required this.bids, required this.onAward, this.awarding});
  final List<Bid> bids;
  final ValueChanged<Bid> onAward;
  final String? awarding;

  @override
  Widget build(BuildContext context) {
    final minPrice = bids.map((b) => b.amount).reduce((a, b) => a < b ? a : b);
    Widget cell(String text, {bool best = false, bool bold = false}) => Container(
          width: 130,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
          color: best ? TaskoColors.chip : null,
          child: Text(text,
              style: TextStyle(
                  fontWeight: bold || best ? FontWeight.w700 : FontWeight.w400, fontSize: 14)),
        );
    Widget label(String text) => Container(
          width: 100,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
          child: Text(text, style: const TextStyle(color: TaskoColors.textMuted, fontSize: 13)),
        );
    final rows = <(String, List<Widget>)>[
      ('Prestataire', [for (final b in bids) cell(b.provider?.fullName ?? '—', bold: true)]),
      ('Prix', [for (final b in bids) cell(formatMoney(b.amount), best: b.amount == minPrice)]),
      ('Délai', [for (final b in bids) cell(b.durationDays == null ? '—' : '${b.durationDays} j')]),
      ('Note', [
        for (final b in bids)
          cell('${formatRating(b.provider?.ratingAvg)} (${b.provider?.ratingCount ?? 0})')
      ]),
      ('Missions', [for (final b in bids) cell('${b.provider?.missionsCompleted ?? 0}')]),
      ('Vérifié', [
        for (final b in bids)
          cell((b.provider?.verificationLevel ?? 1) >= 3 ? 'Oui' : 'Niveau ${b.provider?.verificationLevel ?? 1}')
      ]),
      ('Étapes', [
        for (final b in bids) cell(b.milestones.isEmpty ? 'Paiement unique' : '${b.milestones.length} étapes')
      ]),
    ];
    return TaskoCard(
      padding: EdgeInsets.zero,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final (l, cells) in rows)
              Container(
                decoration: const BoxDecoration(
                    border: Border(bottom: BorderSide(color: TaskoColors.border))),
                child: Row(children: [label(l), ...cells]),
              ),
            Row(
              children: [
                const SizedBox(width: 100),
                for (final b in bids)
                  Container(
                    width: 130,
                    padding: const EdgeInsets.all(6),
                    child: b.isPending
                        ? TaskoButton(
                            label: 'Choisir',
                            height: 48,
                            expand: false,
                            loading: awarding == b.id,
                            onPressed: awarding == null ? () => onAward(b) : null,
                          )
                        : Text(BidStatus.label(b.status)),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
