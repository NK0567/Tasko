import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/config.dart';
import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/socket_service.dart';
import '../../core/theme.dart';
import '../../models/conversation.dart';
import '../../models/dispute.dart';
import '../../models/json.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';

/// Salon de médiation à trois (client · prestataire · Médiateur Tasko) en temps réel.
class MediationScreen extends ConsumerStatefulWidget {
  const MediationScreen({super.key, required this.disputeId});
  final String disputeId;

  @override
  ConsumerState<MediationScreen> createState() => _MediationScreenState();
}

class _MediationScreenState extends ConsumerState<MediationScreen> {
  Dispute? _dispute;
  List<Message> _messages = const [];
  Object? _error;
  bool _loading = true;
  bool _sending = false;
  bool _answering = false;
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<StreamSubscription<dynamic>> _subs = [];
  String? _joinedConversation;

  @override
  void initState() {
    super.initState();
    final socket = SocketService.instance;
    _subs.add(socket.on('message:new').listen((data) {
      final m = Message.fromJson(data);
      final conv = _dispute?.conversationId;
      if (!mounted || conv == null || m.conversationId != conv) return;
      if (_messages.any((e) => e.id == m.id)) return;
      setState(() => _messages = [..._messages, m]);
      _scrollToEnd();
      if (m.isProposal || m.isSystem) _load(silent: true);
    }));
    _subs.add(socket.on('dispute:updated').listen((data) {
      if (!mounted || asString(data['id']) != widget.disputeId) return;
      setState(() => _dispute = Dispute.fromJson(data));
    }));
    _subs.add(socket.reconnected.listen((_) {
      if (mounted) _load(silent: true);
    }));
    _load();
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    if (_joinedConversation != null) {
      SocketService.instance.leaveConversation(_joinedConversation!);
    }
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    final api = ref.read(apiProvider);
    try {
      final d = await api.dispute(widget.disputeId);
      List<Message> msgs;
      try {
        msgs = await api.disputeMessages(widget.disputeId);
      } catch (_) {
        // Serveur sans salon : on affiche les pièces du dossier.
        msgs = _fromEvidence(d);
      }
      if (!mounted) return;
      if (d.conversationId != null && d.conversationId != _joinedConversation) {
        SocketService.instance.joinConversation(d.conversationId!);
        _joinedConversation = d.conversationId;
      }
      setState(() {
        _dispute = d;
        _messages = msgs;
        _loading = false;
        _error = null;
      });
      _scrollToEnd();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (!silent || _dispute == null) _error = e;
      });
    }
  }

  List<Message> _fromEvidence(Dispute d) {
    final out = <Message>[];
    for (final (i, e) in d.evidence.indexed) {
      if (e.message.isNotEmpty) {
        out.add(Message(
          id: 'ev-$i',
          conversationId: '',
          senderId: e.authorId,
          body: e.message,
          createdAt: e.createdAt,
          senderName: e.authorName,
        ));
      }
      for (final (k, p) in e.photos.indexed) {
        out.add(Message(
          id: 'ev-$i-$k',
          conversationId: '',
          senderId: e.authorId,
          type: 'image',
          body: p,
          createdAt: e.createdAt,
          senderName: e.authorName,
        ));
      }
    }
    return out;
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  String? get _myRole {
    final me = ref.read(authProvider).user?.id;
    final job = _dispute?.job;
    if (me == null || job == null) return null;
    if (job.client.id == me) return MediationRole.client;
    if (job.provider?.id == me) return MediationRole.provider;
    return null;
  }

  Future<void> _sendText() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final m = await ref.read(apiProvider).sendDisputeMessage(widget.disputeId, body: text);
      if (!mounted) return;
      _input.clear();
      if (!_messages.any((e) => e.id == m.id)) setState(() => _messages = [..._messages, m]);
      _scrollToEnd();
    } catch (e) {
      // La saisie est conservée en cas d'échec.
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sendPhoto() async {
    if (_sending) return;
    try {
      final file = await ImagePicker()
          .pickImage(source: ImageSource.gallery, maxWidth: 1600, imageQuality: 80);
      if (file == null) return;
      setState(() => _sending = true);
      final api = ref.read(apiProvider);
      final url = await api.upload(await file.readAsBytes(), file.name);
      final m = await api.sendDisputeMessage(widget.disputeId, type: 'image', body: url);
      if (!mounted) return;
      if (!_messages.any((e) => e.id == m.id)) setState(() => _messages = [..._messages, m]);
      _scrollToEnd();
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _answer(Proposal p, bool accept) async {
    if (_answering) return;
    final ok = await confirmAction(
      context,
      title: accept ? 'Accepter cette proposition ?' : 'Refuser cette proposition ?',
      message: accept
          ? '${formatMoney(p.providerAmount)} au prestataire et ${formatMoney(p.clientRefund)} '
              'remboursés au client. Si l’autre partie accepte aussi, l’accord est appliqué '
              'automatiquement et le litige est clos.'
          : 'La médiation continue. Un médiateur Tasko tranchera si aucun accord n’est trouvé.',
      confirmLabel: accept ? 'Oui, j’accepte' : 'Oui, je refuse',
      danger: !accept,
    );
    if (!ok || !mounted) return;
    setState(() => _answering = true);
    try {
      final d = await ref.read(apiProvider).answerProposal(widget.disputeId, p.id, accept: accept);
      if (!mounted) return;
      setState(() => _dispute = d);
      showSnack(context, accept ? 'Votre accord est enregistré.' : 'Proposition refusée.');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _answering = false);
    }
  }

  Future<void> _propose() async {
    final d = _dispute;
    if (d == null) return;
    final max = d.job?.effectivePrice ?? 0;
    final result = await showModalBottomSheet<(int, String)>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ProposalSheet(maxAmount: max),
    );
    if (result == null || !mounted) return;
    setState(() => _answering = true);
    try {
      await ref
          .read(apiProvider)
          .propose(widget.disputeId, providerAmount: result.$1, message: result.$2);
      if (!mounted) return;
      showSnack(context, 'Proposition envoyée aux participants.');
      await _load(silent: true);
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _answering = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _dispute;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Salon de médiation'),
        actions: [
          if (d?.job != null)
            TextButton.icon(
              onPressed: () => context.push('/jobs/${d!.job!.id}'),
              icon: const Icon(Icons.info_outline),
              label: const Text('Mission'),
            ),
        ],
      ),
      body: d == null
          ? (_loading
              ? const SkeletonList(count: 4)
              : ErrorView(error: _error ?? 'Erreur', onRetry: _load))
          : _body(d),
    );
  }

  Widget _body(Dispute d) {
    final role = _myRole;
    final active = d.activeProposal;
    final open = !d.isResolved;
    return Column(
      children: [
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => _load(silent: true),
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              children: [
                _DisputeHeader(dispute: d, myRole: role),
                if (active != null && open) ...[
                  const SizedBox(height: 12),
                  ProposalCard(
                    proposal: active,
                    myRole: role,
                    busy: _answering,
                    onAnswer: (accept) => _answer(active, accept),
                  ),
                ],
                const SizedBox(height: 14),
                if (_messages.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 20),
                    child: Text(
                      'Expliquez la situation et ajoutez vos photos. Le médiateur Tasko lit tout.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: TaskoColors.textMuted, fontSize: 14),
                    ),
                  ),
                for (final m in _messages) _messageView(m, d, role),
              ],
            ),
          ),
        ),
        if (open) _composer(role) else _closedBar(),
      ],
    );
  }

  Widget _messageView(Message m, Dispute d, String? role) {
    if (m.isProposal) {
      final p = d.proposalById(m.body);
      if (p == null) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: ProposalCard(
          proposal: p,
          myRole: role,
          busy: _answering,
          compact: true,
          onAnswer: p.isPending && !d.isResolved ? (accept) => _answer(p, accept) : null,
        ),
      );
    }
    if (m.isSystem) return SystemMessage(text: m.body, at: m.createdAt);
    final me = ref.read(authProvider).user?.id;
    return MediationBubble(message: m, mine: m.senderId == me, roleOf: _roleOfSender(m, d));
  }

  String? _roleOfSender(Message m, Dispute d) {
    if (m.senderRole != null) return m.senderRole;
    final job = d.job;
    if (job == null) return null;
    if (m.senderId == job.client.id) return MediationRole.client;
    if (m.senderId == job.provider?.id) return MediationRole.provider;
    return MediationRole.admin;
  }

  Widget _composer(String? role) {
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: TaskoColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (role != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _answering ? null : _propose,
                  style: TextButton.styleFrom(minimumSize: const Size(48, 44)),
                  icon: const Icon(Icons.handshake_outlined),
                  label: const Text('Proposer un accord'),
                ),
              ),
            Row(
              children: [
                IconButton(
                  tooltip: 'Envoyer une photo',
                  onPressed: _sending ? null : _sendPhoto,
                  icon: const Icon(Icons.add_a_photo_outlined, color: TaskoColors.primary),
                ),
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 4,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(hintText: 'Votre message…'),
                    onSubmitted: (_) => _sendText(),
                  ),
                ),
                const SizedBox(width: 6),
                IconButton.filled(
                  tooltip: 'Envoyer le message',
                  style: IconButton.styleFrom(
                      backgroundColor: TaskoColors.primary, minimumSize: const Size(48, 48)),
                  onPressed: _sending ? null : _sendText,
                  icon: _sending
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.send, color: Colors.white),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _closedBar() => const SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.all(14),
          child: Text(
            'Ce litige est clos. Les messages restent consultables.',
            textAlign: TextAlign.center,
            style: TextStyle(color: TaskoColors.textMuted, fontSize: 14),
          ),
        ),
      );
}

/// En-tête du dossier : motif, échéances, décision.
class _DisputeHeader extends StatelessWidget {
  const _DisputeHeader({required this.dispute, required this.myRole});
  final Dispute dispute;
  final String? myRole;

  @override
  Widget build(BuildContext context) {
    final d = dispute;
    final providerMustAnswer =
        d.isNoShow && !d.isResolved && myRole == MediationRole.provider && d.respondBefore != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (providerMustAnswer) ...[
          InfoBox(
            icon: Icons.notification_important_outlined,
            color: StatusColors.problem,
            title: 'Le client signale votre absence — répondez avant ${formatShortDateTime(d.respondBefore)}',
            text: 'Expliquez ce qui s’est passé ci-dessous. Sans réponse, le client sera remboursé automatiquement.',
          ),
          const SizedBox(height: 10),
        ],
        TaskoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.gavel_rounded, color: d.statusColor),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(d.kindLabel,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: d.statusColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(d.statusLabel,
                        style: TextStyle(
                            color: d.statusColor, fontWeight: FontWeight.w600, fontSize: 12)),
                  ),
                ],
              ),
              if (d.job != null) ...[
                const SizedBox(height: 4),
                Text('${d.job!.title} · ${formatMoney(d.job!.clientTotal)}',
                    style: const TextStyle(color: TaskoColors.textMuted, fontSize: 14)),
              ],
              if (d.reason.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text('Signalé par ${d.openedByName} (${MediationRole.label(d.openedByRole)}) : ${d.reason}',
                    style: const TextStyle(fontSize: 14, height: 1.35)),
              ],
              if (!d.isResolved) ...[
                const SizedBox(height: 8),
                if (d.respondBefore != null)
                  _Deadline(
                    icon: Icons.timer_outlined,
                    label: 'Réponses attendues avant ${formatShortDateTime(d.respondBefore)}',
                    target: d.respondBefore!,
                  ),
                if (d.decisionDueAt != null)
                  _Deadline(
                    icon: Icons.event_available_outlined,
                    label: 'Décision du médiateur au plus tard le ${formatShortDateTime(d.decisionDueAt)}',
                    target: d.decisionDueAt!,
                  ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 10),
        if (d.isResolved)
          _DecisionCard(dispute: d)
        else
          const InfoBox(
            icon: Icons.lock_outline,
            text: kEscrowLockedMessage,
          ),
      ],
    );
  }
}

class _Deadline extends StatelessWidget {
  const _Deadline({required this.icon, required this.label, required this.target});
  final IconData icon;
  final String label;
  final DateTime target;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: StatusColors.waiting),
            const SizedBox(width: 6),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: const TextStyle(fontSize: 13.5)),
                  CountdownText(
                    target: target,
                    prefix: 'Reste ',
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700, color: StatusColors.waiting),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
}

class _DecisionCard extends StatelessWidget {
  const _DecisionCard({required this.dispute});
  final Dispute dispute;

  @override
  Widget build(BuildContext context) {
    final d = dispute;
    final total = d.job?.effectivePrice;
    final amounts = d.resolution == 'split' && d.providerAmount != null
        ? '${formatMoney(d.providerAmount)} au prestataire'
            '${total != null ? ', ${formatMoney(total - d.providerAmount!)} remboursés au client' : ''}.'
        : null;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: TaskoColors.primaryDark,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.verified, color: TaskoColors.accent),
              SizedBox(width: 8),
              Text('Décision finale',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
            ],
          ),
          const SizedBox(height: 8),
          Text(d.resolutionLabel ?? 'Litige clos',
              style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600)),
          if (amounts != null)
            Text(amounts, style: const TextStyle(color: Colors.white, fontSize: 14)),
          if (d.resolvedByLabel != null)
            Text(d.resolvedByLabel!, style: const TextStyle(color: Colors.white70, fontSize: 13)),
          if (d.resolutionNote != null && d.resolutionNote!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('Motif : ${d.resolutionNote}',
                style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.35)),
          ],
          if (d.resolvedAt != null)
            Text('Le ${formatDateTime(d.resolvedAt)}',
                style: const TextStyle(color: Colors.white60, fontSize: 12)),
        ],
      ),
    );
  }
}

/// Carte d'une proposition d'accord, avec l'état d'acceptation de chaque partie.
class ProposalCard extends StatelessWidget {
  const ProposalCard({
    super.key,
    required this.proposal,
    required this.myRole,
    this.onAnswer,
    this.busy = false,
    this.compact = false,
  });

  final Proposal proposal;
  final String? myRole;
  final ValueChanged<bool>? onAnswer;
  final bool busy;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final p = proposal;
    final myAnswer = myRole == null ? null : p.answerOf(myRole!);
    final canAnswer = onAnswer != null && p.isPending && myRole != null && myAnswer == null;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: TaskoColors.accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: TaskoColors.accent),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.handshake_outlined, color: TaskoColors.primaryDark),
              const SizedBox(width: 8),
              Expanded(
                child: Text('Proposition de ${MediationRole.label(p.authorRole)}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
              ),
              Text(p.statusLabel,
                  style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted)),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Proposition : ${formatMoney(p.providerAmount)} au prestataire / '
            '${formatMoney(p.clientRefund)} remboursés',
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, height: 1.3),
          ),
          if (p.message.isNotEmpty && !compact) ...[
            const SizedBox(height: 6),
            Text(p.message, style: const TextStyle(fontSize: 14, height: 1.35)),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              _AnswerChip(label: 'Client', answer: p.clientAccepted),
              _AnswerChip(label: 'Prestataire', answer: p.providerAccepted),
            ],
          ),
          if (canAnswer) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TaskoButton(
                    label: 'Refuser',
                    icon: Icons.close,
                    height: 48,
                    variant: TaskoButtonVariant.danger,
                    onPressed: busy ? null : () => onAnswer!(false),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TaskoButton(
                    label: 'Accepter',
                    icon: Icons.check,
                    height: 48,
                    loading: busy,
                    onPressed: () => onAnswer!(true),
                  ),
                ),
              ],
            ),
          ] else if (myAnswer != null && p.isPending)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                myAnswer
                    ? 'Vous avez accepté. En attente de l’autre partie.'
                    : 'Vous avez refusé cette proposition.',
                style: const TextStyle(fontSize: 13.5, color: TaskoColors.textMuted),
              ),
            ),
        ],
      ),
    );
  }
}

class _AnswerChip extends StatelessWidget {
  const _AnswerChip({required this.label, required this.answer});
  final String label;
  final bool? answer;

  @override
  Widget build(BuildContext context) {
    final (icon, color, text) = switch (answer) {
      true => (Icons.check_circle, StatusColors.ok, 'a accepté'),
      false => (Icons.cancel, StatusColors.problem, 'a refusé'),
      null => (Icons.hourglass_empty, StatusColors.waiting, 'en attente'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 4),
          Text('$label $text', style: TextStyle(fontSize: 12.5, color: color)),
        ],
      ),
    );
  }
}

/// Message système centré (ouverture, échéances, décision…).
class SystemMessage extends StatelessWidget {
  const SystemMessage({super.key, required this.text, this.at});
  final String text;
  final DateTime? at;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 20),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: TaskoColors.surfaceMuted,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(stripEmoji(text),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted, height: 1.35)),
          ),
          if (at != null)
            Text(formatDateTime(at),
                style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted)),
        ],
      ),
    );
  }
}

/// Bulle d'un participant avec son rôle (médiateur Tasko mis en évidence).
class MediationBubble extends StatelessWidget {
  const MediationBubble({super.key, required this.message, required this.mine, this.roleOf});
  final Message message;
  final bool mine;
  final String? roleOf;

  static Color roleColor(String? role) => switch (role) {
        MediationRole.admin => const Color(0xFF1D4ED8),
        MediationRole.provider => const Color(0xFF7B61FF),
        _ => TaskoColors.primary,
      };

  @override
  Widget build(BuildContext context) {
    final role = roleOf;
    final isAdmin = role == MediationRole.admin;
    final color = roleColor(role);
    final bg = isAdmin
        ? const Color(0xFFE8EEFF)
        : (mine ? TaskoColors.chip : TaskoColors.bubbleOther);
    final name = isAdmin
        ? 'Médiateur Tasko'
        : (mine ? 'Vous' : (message.senderName ?? MediationRole.label(role)));
    final m = message;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(14),
            border: isAdmin ? Border.all(color: color, width: 1.4) : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (isAdmin) ...[
                    Icon(Icons.verified_user, size: 15, color: color),
                    const SizedBox(width: 4),
                  ],
                  Flexible(
                    child: Text(name,
                        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5, color: color)),
                  ),
                  if (!isAdmin && role != null) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(MediationRole.label(role),
                          style: TextStyle(fontSize: 11, color: color)),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 4),
              if (m.isImage)
                InkWell(
                  onTap: () => showPhotoViewer(context, [m.body]),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: CachedNetworkImage(
                      imageUrl: AppConfig.mediaUrl(m.body) ?? '',
                      width: 200,
                      fit: BoxFit.cover,
                      errorWidget: (_, _, _) => const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.broken_image_outlined, color: TaskoColors.textMuted),
                          SizedBox(width: 6),
                          Text('Image indisponible'),
                        ],
                      ),
                    ),
                  ),
                )
              else
                Text(m.body, style: const TextStyle(fontSize: 15, height: 1.35)),
              const SizedBox(height: 2),
              Text(formatDateTime(m.createdAt),
                  style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProposalSheet extends StatefulWidget {
  const _ProposalSheet({required this.maxAmount});
  final int maxAmount;

  @override
  State<_ProposalSheet> createState() => _ProposalSheetState();
}

class _ProposalSheetState extends State<_ProposalSheet> {
  final _amount = TextEditingController();
  final _message = TextEditingController();

  @override
  void dispose() {
    _amount.dispose();
    _message.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final value = parseAmount(_amount.text);
    final max = widget.maxAmount;
    final invalid = max > 0 && value > max;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Proposer un accord',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 19)),
              const SizedBox(height: 6),
              Text(
                max > 0
                    ? 'Combien pour le prestataire ? Le reste des ${formatMoney(max)} est remboursé au client.'
                    : 'Combien pour le prestataire ? Le reste est remboursé au client.',
                style: const TextStyle(fontSize: 15, color: TaskoColors.textMuted),
              ),
              const SizedBox(height: 14),
              AmountField(
                controller: _amount,
                autofocus: true,
                label: 'Montant pour le prestataire',
                onChanged: (_) => setState(() {}),
              ),
              if (max > 0 && _amount.text.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    invalid
                        ? 'Maximum : ${formatMoney(max)}.'
                        : '${formatMoney(value)} au prestataire / ${formatMoney(max - value)} remboursés au client',
                    style: TextStyle(
                        color: invalid ? TaskoColors.danger : TaskoColors.primary, fontSize: 14),
                  ),
                ),
              const SizedBox(height: 12),
              TextField(
                controller: _message,
                minLines: 2,
                maxLines: 4,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: 'Explication (optionnel)'),
              ),
              const SizedBox(height: 16),
              TaskoButton(
                label: 'Envoyer la proposition',
                icon: Icons.send,
                onPressed: _amount.text.isEmpty || invalid
                    ? null
                    : () => Navigator.pop(context, (value, _message.text.trim())),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
