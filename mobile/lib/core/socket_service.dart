import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../models/json.dart';
import 'config.dart';

/// Service Socket.IO unique, avec reconnexion automatique et
/// ré-adhésion aux rooms (jobs / conversations) après reconnexion.
class SocketService {
  SocketService._();
  static final SocketService instance = SocketService._();

  /// Événements serveur → client du contrat.
  static const List<String> serverEvents = [
    'job:new',
    'job:updated',
    'provider:location',
    'message:new',
    'notification:new',
    'typing',
    // V2
    'job:closed',
    'bid:new',
    'bid:updated',
    'dispute:updated',
  ];

  io.Socket? _socket;
  String? _token;
  final Map<String, StreamController<Json>> _controllers = {};
  final Set<String> _jobRooms = {};
  final Set<String> _conversationRooms = {};
  final ValueNotifier<bool> connected = ValueNotifier(false);

  /// Vrai quand la connexion temps réel est perdue (bandeau « Pas de connexion »).
  final ValueNotifier<bool> offline = ValueNotifier(false);
  final StreamController<void> _reconnected = StreamController<void>.broadcast();
  bool _hasConnectedOnce = false;

  bool get isConnected => _socket?.connected ?? false;

  /// Émis à chaque **re**connexion (pas à la première) : les écrans doivent
  /// recharger leur état, des événements ayant pu être manqués pendant la coupure.
  Stream<void> get reconnected => _reconnected.stream;

  StreamController<Json> _controller(String event) =>
      _controllers.putIfAbsent(event, () => StreamController<Json>.broadcast());

  /// Flux d'un événement serveur (payload JSON).
  Stream<Json> on(String event) => _controller(event).stream;

  void connect(String token) {
    if (_socket != null && _token == token) {
      if (!(_socket!.connected)) _socket!.connect();
      return;
    }
    disconnect();
    _token = token;
    final socket = io.io(
      AppConfig.socketUrl,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .setAuth({'token': token})
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(1500)
          .setReconnectionDelayMax(10000)
          .enableForceNew()
          .build(),
    );
    socket.onConnect((_) {
      connected.value = true;
      offline.value = false;
      for (final id in _jobRooms) {
        socket.emit('job:join', {'job_id': id});
      }
      for (final id in _conversationRooms) {
        socket.emit('conversation:join', {'conversation_id': id});
      }
      if (_hasConnectedOnce) _reconnected.add(null);
      _hasConnectedOnce = true;
    });
    socket.onDisconnect((_) {
      connected.value = false;
      if (_token != null) offline.value = true;
    });
    socket.onConnectError((e) {
      connected.value = false;
      if (_token != null) offline.value = true;
      debugPrint('[socket] erreur de connexion : $e');
    });
    for (final event in serverEvents) {
      socket.on(event, (data) {
        final map = asMap(data);
        if (map != null) _controller(event).add(map);
      });
    }
    _socket = socket;
    socket.connect();
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
    _token = null;
    _hasConnectedOnce = false;
    _jobRefs.clear();
    offline.value = false;
    _jobRooms.clear();
    _conversationRooms.clear();
    connected.value = false;
  }

  void emit(String event, Json payload) {
    _socket?.emit(event, payload);
  }

  void joinJob(String jobId) {
    _jobRooms.add(jobId);
    emit('job:join', {'job_id': jobId});
  }

  void leaveJob(String jobId) {
    _jobRooms.remove(jobId);
    emit('job:leave', {'job_id': jobId});
  }

  void joinConversation(String conversationId) {
    _conversationRooms.add(conversationId);
    emit('conversation:join', {'conversation_id': conversationId});
  }

  void leaveConversation(String conversationId) {
    _conversationRooms.remove(conversationId);
  }

  /// Vrai si un autre écran suit encore cette mission (évite de quitter
  /// la room trop tôt quand deux écrans de la même mission se succèdent).
  final Map<String, int> _jobRefs = {};

  void retainJob(String jobId) {
    _jobRefs[jobId] = (_jobRefs[jobId] ?? 0) + 1;
    joinJob(jobId);
  }

  void releaseJob(String jobId) {
    final n = (_jobRefs[jobId] ?? 1) - 1;
    if (n <= 0) {
      _jobRefs.remove(jobId);
      leaveJob(jobId);
    } else {
      _jobRefs[jobId] = n;
    }
  }

  void typing(String conversationId) =>
      emit('typing', {'conversation_id': conversationId});

  void sendLocation(double lat, double lng) =>
      emit('location:update', {'lat': lat, 'lng': lng});
}
