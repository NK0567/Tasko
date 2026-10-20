import 'package:flutter/material.dart';

import 'job.dart';
import 'json.dart';

/// Rôle d'un participant au salon de médiation (contrat V2 §5.9).
class MediationRole {
  MediationRole._();
  static const client = 'client';
  static const provider = 'provider';
  static const admin = 'admin';
  static const system = 'system';

  static String label(String? r) => switch (r) {
        client => 'Client',
        provider => 'Prestataire',
        admin => 'Médiateur Tasko',
        system => 'Tasko',
        _ => 'Participant',
      };
}

/// Pièce versée au dossier d'un litige (ancien format `evidence`, conservé).
class DisputeEvidence {
  final String authorId;
  final String authorName;
  final String message;
  final List<String> photos;
  final DateTime? createdAt;

  const DisputeEvidence({
    required this.authorId,
    required this.authorName,
    this.message = '',
    this.photos = const [],
    this.createdAt,
  });

  factory DisputeEvidence.fromJson(Json j) {
    final author = asMap(j['author']) ?? const {};
    return DisputeEvidence(
      authorId: asString(author['id']),
      authorName: asString(author['full_name'], 'Participant'),
      message: asString(j['message']),
      photos: asStringList(j['photos']),
      createdAt: asDate(j['created_at']),
    );
  }
}

/// Proposition de règlement amiable (RG-G13).
class Proposal {
  final String id;
  final String authorId;
  final String authorName;
  final String authorRole;
  final int providerAmount;
  final int clientRefund;
  final String message;

  /// `null` = pas encore répondu.
  final bool? clientAccepted;
  final bool? providerAccepted;

  /// `pending` | `accepted` | `rejected` | `superseded`.
  final String status;
  final DateTime? createdAt;

  const Proposal({
    required this.id,
    this.authorId = '',
    this.authorName = '',
    this.authorRole = MediationRole.admin,
    required this.providerAmount,
    this.clientRefund = 0,
    this.message = '',
    this.clientAccepted,
    this.providerAccepted,
    this.status = 'pending',
    this.createdAt,
  });

  factory Proposal.fromJson(Json j) {
    final author = asMap(j['author']) ?? const {};
    bool? tri(dynamic v) => v == null ? null : asBool(v);
    return Proposal(
      id: asString(j['id']),
      authorId: asString(author['id']),
      authorName: asString(author['full_name'], 'Participant'),
      authorRole: asString(author['role'], MediationRole.admin),
      providerAmount: asInt(j['provider_amount']),
      clientRefund: asInt(j['client_refund']),
      message: asString(j['message']),
      clientAccepted: tri(j['client_accepted']),
      providerAccepted: tri(j['provider_accepted']),
      status: asString(j['status'], 'pending'),
      createdAt: asDate(j['created_at']),
    );
  }

  bool get isPending => status == 'pending';

  String get statusLabel => switch (status) {
        'pending' => 'En attente des réponses',
        'accepted' => 'Accord conclu',
        'rejected' => 'Refusée',
        'superseded' => 'Remplacée par une nouvelle proposition',
        _ => status,
      };

  /// Réponse de la partie [role] (client ou prestataire).
  bool? answerOf(String role) => switch (role) {
        MediationRole.client => clientAccepted,
        MediationRole.provider => providerAccepted,
        _ => null,
      };
}

/// Types de litige.
const Map<String, String> kDisputeKindLabels = {
  'quality': 'Travail non conforme',
  'no_show': 'Prestataire absent',
  'not_validated': 'Mission non validée',
  'other': 'Autre problème',
};

/// Dossier de litige (`GET /disputes/:id`) = salon de médiation à trois.
class Dispute {
  final String id;
  final Job? job;

  /// `quality` | `no_show` | `not_validated` | `other`.
  final String kind;
  final String? milestoneId;
  final String openedById;
  final String openedByName;
  final String openedByRole;
  final String reason;

  /// `open` | `pending_confirmation` | `resolved`.
  final String status;
  final String? conversationId;
  final List<DisputeEvidence> evidence;
  final DateTime? respondBefore;
  final DateTime? decisionDueAt;
  final List<Proposal> proposals;

  /// `release` | `refund` | `split` | null.
  final String? resolution;
  final int? providerAmount;

  /// `admin` | `agreement` | `system` | null.
  final String? resolvedBy;
  final String? resolutionNote;
  final DateTime? createdAt;
  final DateTime? resolvedAt;

  const Dispute({
    required this.id,
    this.job,
    this.kind = 'other',
    this.milestoneId,
    this.openedById = '',
    this.openedByName = '',
    this.openedByRole = MediationRole.client,
    this.reason = '',
    this.status = 'open',
    this.conversationId,
    this.evidence = const [],
    this.respondBefore,
    this.decisionDueAt,
    this.proposals = const [],
    this.resolution,
    this.providerAmount,
    this.resolvedBy,
    this.resolutionNote,
    this.createdAt,
    this.resolvedAt,
  });

  factory Dispute.fromJson(Json j) {
    final job = asMap(j['job']);
    final opener = asMap(j['opened_by']) ?? const {};
    // `resolution` : chaîne (contrat) ou, par tolérance, objet {resolution, note, provider_amount}.
    final rawRes = j['resolution'];
    final resMap = asMap(rawRes);
    final evidence = asList(j['evidence'], DisputeEvidence.fromJson).toList()
      ..sort((a, b) => (a.createdAt ?? DateTime(0)).compareTo(b.createdAt ?? DateTime(0)));
    final proposals = asList(j['proposals'], Proposal.fromJson).toList()
      ..sort((a, b) => (a.createdAt ?? DateTime(0)).compareTo(b.createdAt ?? DateTime(0)));
    final res = resMap != null
        ? asStringOrNull(resMap['resolution'])
        : (rawRes == null ? null : asString(rawRes));
    return Dispute(
      id: asString(j['id']),
      job: job == null ? null : Job.fromJson(job),
      kind: asString(j['kind'], 'other'),
      milestoneId: asStringOrNull(j['milestone_id']),
      openedById: asString(opener['id']),
      openedByName: asString(opener['full_name'], 'Participant'),
      openedByRole: asString(opener['role'], MediationRole.client),
      reason: asString(j['reason']),
      status: asString(j['status'], 'open'),
      conversationId: asStringOrNull(j['conversation_id']),
      evidence: evidence,
      respondBefore: asDate(j['respond_before']),
      decisionDueAt: asDate(j['decision_due_at']),
      proposals: proposals,
      resolution: (res == null || res.isEmpty) ? null : res,
      providerAmount: asIntOrNull(resMap?['provider_amount'] ?? j['provider_amount']),
      resolvedBy: asStringOrNull(j['resolved_by']),
      resolutionNote: asStringOrNull(resMap?['note'] ?? j['resolution_note']),
      createdAt: asDate(j['created_at']),
      resolvedAt: asDate(j['resolved_at']),
    );
  }

  bool get isResolved => status == 'resolved';
  bool get isNoShow => kind == 'no_show';
  String get kindLabel => kDisputeKindLabels[kind] ?? 'Litige';

  /// Proposition en cours (la plus récente encore en attente).
  Proposal? get activeProposal {
    for (final p in proposals.reversed) {
      if (p.isPending) return p;
    }
    return null;
  }

  Proposal? proposalById(String id) {
    for (final p in proposals) {
      if (p.id == id) return p;
    }
    return null;
  }

  String get statusLabel => switch (status) {
        'resolved' => 'Décision rendue',
        'pending_confirmation' => 'Décision en cours de validation',
        _ => 'Médiation en cours',
      };

  Color get statusColor => switch (status) {
        'resolved' => const Color(0xFF0B3D2E),
        'pending_confirmation' => const Color(0xFFF59E0B),
        _ => const Color(0xFFE53935),
      };

  /// Décision lisible.
  String? get resolutionLabel => switch (resolution) {
        'release' => 'Paiement versé au prestataire',
        'refund' => 'Client remboursé',
        'split' => 'Montant partagé entre les deux parties',
        null => null,
        _ => resolution,
      };

  String? get resolvedByLabel => switch (resolvedBy) {
        'admin' => 'Décision du médiateur Tasko',
        'agreement' => 'Accord amiable accepté par les deux parties',
        'system' => 'Règle automatique : le prestataire n’a pas répondu à temps',
        _ => null,
      };
}

/// Motifs proposés à l'ouverture d'un litige, avec leur `kind`.
const List<(String, String)> kDisputeReasons = [
  ('quality', 'Travail mal fait ou incomplet'),
  ('quality', 'Travail non réalisé'),
  ('quality', 'Dommages causés'),
  ('not_validated', 'Le client ne valide pas la mission'),
  ('other', 'Désaccord sur le prix'),
  ('other', 'Client injoignable ou absent'),
  ('other', 'Autre problème'),
];

/// Message clé affiché partout autour des litiges.
const String kEscrowLockedMessage =
    'L’argent reste bloqué chez Tasko : ni le client ni le prestataire ne peuvent le récupérer seuls.';
