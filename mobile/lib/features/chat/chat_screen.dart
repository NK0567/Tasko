import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/config.dart';
import '../../core/formatters.dart';
import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/socket_service.dart';
import '../../core/theme.dart';
import '../../models/conversation.dart';
import '../../models/json.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/map_widgets.dart';
import '../home/home_providers.dart';
import 'conversations_screen.dart';

/// Écran 6 — Chat en temps réel.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.conversationId, this.otherUser});
  final String conversationId;
  final ChatUser? otherUser;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<Message> _messages = [];
  final List<StreamSubscription<dynamic>> _subs = [];
  ChatUser? _other;
  bool _loading = true;
  Object? _error;
  bool _sending = false;
  bool _otherTyping = false;
  Timer? _typingTimer;
  DateTime _lastTypingEmit = DateTime(0);

  String? get _myId => ref.read(authProvider).user?.id;

  @override
  void initState() {
    super.initState();
    _other = widget.otherUser;
    final socket = SocketService.instance;
    socket.joinConversation(widget.conversationId);
    _subs.add(socket.on('message:new').listen(_onSocketMessage));
    _subs.add(socket.on('typing').listen((data) {
      if (data['conversation_id'] != widget.conversationId) return;
      if (data['user_id'] == _myId) return;
      setState(() => _otherTyping = true);
      _typingTimer?.cancel();
      _typingTimer = Timer(const Duration(seconds: 3), () {
        if (mounted) setState(() => _otherTyping = false);
      });
    }));
    // Messages manqués pendant une coupure réseau : rechargement.
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
    _typingTimer?.cancel();
    SocketService.instance.leaveConversation(widget.conversationId);
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
    try {
      final api = ref.read(apiProvider);
      if (_other == null) {
        final convs = await api.conversations();
        for (final c in convs) {
          if (c.id == widget.conversationId) _other = c.otherUser;
        }
      }
      final list = await api.messages(widget.conversationId);
      if (!mounted) return;
      setState(() {
        _messages
          ..clear()
          ..addAll(list);
        _loading = false;
      });
      _markRead();
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        if (!silent) _error = e;
        _loading = false;
      });
    }
  }

  void _markRead() {
    ref.read(apiProvider).markConversationRead(widget.conversationId).then((_) {
      ref.read(unreadMessagesProvider.notifier).refresh();
    }).catchError((_) {});
  }

  void _onSocketMessage(Json data) {
    final m = Message.fromJson(data);
    if (m.conversationId != widget.conversationId) return;
    _addMessage(m);
    if (m.senderId != _myId) {
      setState(() => _otherTyping = false);
      _markRead();
    }
  }

  void _addMessage(Message m) {
    if (_messages.any((e) => e.id == m.id)) return;
    setState(() => _messages.add(m));
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _onTyping(String _) {
    final now = DateTime.now();
    if (now.difference(_lastTypingEmit).inSeconds >= 2) {
      _lastTypingEmit = now;
      SocketService.instance.typing(widget.conversationId);
    }
    setState(() {});
  }

  Future<void> _sendText() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final m = await ref.read(apiProvider).sendMessage(widget.conversationId, body: text);
      _input.clear();
      _addMessage(m);
      ref.invalidate(conversationsProvider);
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sendLocation() async {
    setState(() => _sending = true);
    try {
      final pos = await LocationService.current();
      final m = await ref.read(apiProvider).sendMessage(
            widget.conversationId,
            type: 'location',
            body: pos.isFallback ? 'Position approximative' : 'Ma position',
            lat: pos.lat,
            lng: pos.lng,
          );
      _addMessage(m);
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final other = _other;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            TaskoAvatar(
              name: other?.fullName ?? '?',
              url: other?.avatarUrl,
              size: 38,
              online: other?.isOnline,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(other?.fullName ?? 'Conversation',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  Text(
                    _otherTyping
                        ? 'écrit…'
                        : (other?.isOnline ?? false)
                            ? 'En ligne'
                            : (other?.headline ?? 'Hors ligne'),
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w400,
                      color: _otherTyping || (other?.isOnline ?? false)
                          ? TaskoColors.primaryLight
                          : TaskoColors.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(child: _buildMessages()),
          _buildComposer(),
        ],
      ),
    );
  }

  Widget _buildMessages() {
    if (_loading) return const LoadingView();
    if (_error != null) return ErrorView(error: _error!, onRetry: _load);
    if (_messages.isEmpty) {
      return const EmptyView(
        compact: true,
        title: 'Démarrez la conversation',
        message: 'Décrivez votre besoin, partagez votre position…',
      );
    }
    final myId = _myId;
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
      itemCount: _messages.length,
      itemBuilder: (_, i) {
        final m = _messages[i];
        final mine = m.senderId == myId;
        final showDate = i == 0 ||
            formatDate(_messages[i - 1].createdAt) != formatDate(m.createdAt);
        return Column(
          children: [
            if (showDate)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(formatDate(m.createdAt),
                    style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted)),
              ),
            _Bubble(message: m, mine: mine),
          ],
        );
      },
    );
  }

  Widget _buildComposer() {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: TaskoColors.border)),
        ),
        child: Row(
          children: [
            IconButton(
              tooltip: 'Envoyer ma position',
              icon: const Icon(Icons.location_on_outlined, color: TaskoColors.primary),
              onPressed: _sending ? null : _sendLocation,
            ),
            Expanded(
              child: TextField(
                controller: _input,
                minLines: 1,
                maxLines: 4,
                onChanged: _onTyping,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _sendText(),
                decoration: InputDecoration(
                  hintText: 'Écrivez un message…',
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: const BorderSide(color: TaskoColors.border),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 6),
            CircleAvatar(
              radius: 22,
              backgroundColor: TaskoColors.primary,
              child: _sending
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : IconButton(
                      tooltip: 'Envoyer',
                      icon: const Icon(Icons.send_rounded, color: Colors.white, size: 20),
                      onPressed: _sendText,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, required this.mine});
  final Message message;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    final bg = mine ? const Color(0xFFD9F2E1) : TaskoColors.bubbleOther;
    final radius = BorderRadius.only(
      topLeft: const Radius.circular(16),
      topRight: const Radius.circular(16),
      bottomLeft: Radius.circular(mine ? 16 : 4),
      bottomRight: Radius.circular(mine ? 4 : 16),
    );
    Widget content;
    if (message.isLocation) {
      final point = LatLng(message.lat!, message.lng!);
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: 220,
              height: 120,
              child: IgnorePointer(
                child: FlutterMap(
                  options: MapOptions(initialCenter: point, initialZoom: 15),
                  children: [
                    osmTileLayer(),
                    MarkerLayer(markers: [
                      Marker(
                        point: point,
                        width: 36,
                        height: 36,
                        alignment: Alignment.topCenter,
                        child: const DestinationPin(size: 36),
                      ),
                    ]),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.location_on, size: 16, color: TaskoColors.primary),
              const SizedBox(width: 4),
              Text(
                message.body.isEmpty ? 'Ma position' : message.body,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
              ),
            ],
          ),
        ],
      );
    } else if (message.isImage) {
      content = ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Image.network(AppConfig.mediaUrl(message.body) ?? '', width: 220, fit: BoxFit.cover,
            errorBuilder: (_, _, _) => const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.broken_image_outlined, size: 18, color: TaskoColors.textMuted),
                    SizedBox(width: 6),
                    Text('Image indisponible'),
                  ],
                )),
      );
    } else {
      content = Text(message.body, style: const TextStyle(fontSize: 14.5, height: 1.35));
    }
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 3),
          padding: const EdgeInsets.fromLTRB(12, 9, 12, 6),
          decoration: BoxDecoration(color: bg, borderRadius: radius),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
              content,
              const SizedBox(height: 3),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(formatTime(message.createdAt),
                      style: const TextStyle(fontSize: 10.5, color: TaskoColors.textMuted)),
                  if (mine) ...[
                    const SizedBox(width: 3),
                    Icon(
                      message.readAt != null ? Icons.done_all : Icons.done,
                      size: 14,
                      color: message.readAt != null ? TaskoColors.info : TaskoColors.textMuted,
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
