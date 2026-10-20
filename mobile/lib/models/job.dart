import 'package:flutter/material.dart';

import '../core/formatters.dart';
import '../core/theme.dart';
import 'json.dart';
import 'provider_card.dart';

/// Statuts de mission (machine à états du contrat).
class JobStatus {
  JobStatus._();
  static const requested = 'requested';
  static const accepted = 'accepted';
  static const funded = 'funded';
  static const enRoute = 'en_route';
  static const arrived = 'arrived';
  static const inProgress = 'in_progress';
  static const done = 'done';
  static const completed = 'completed';
  static const cancelled = 'cancelled';
  static const disputed = 'disputed';

  static const active = {
    requested,
    accepted,
    funded,
    enRoute,
    arrived,
    inProgress,
    done,
  };

  /// Statuts où la mission est payée et en cours d'exécution.
  static const live = {funded, enRoute, arrived, inProgress};

  static const terminal = {completed, cancelled};

  /// Statuts où l'argent du client est encaissé et bloqué par Tasko.
  static const securedStatuses = {funded, enRoute, arrived, inProgress, done, disputed};

  /// Statuts où un litige peut être ouvert (RG-G6).
  static const disputable = {funded, enRoute, arrived, inProgress, done};

  static String label(String status) => switch (status) {
        requested => 'En attente',
        accepted => 'Acceptée',
        funded => 'Payée',
        enRoute => 'En route',
        arrived => 'Sur place',
        inProgress => 'En cours',
        done => 'À valider',
        completed => 'Terminée',
        cancelled => 'Annulée',
        disputed => 'Litige',
        _ => status,
      };

  /// Couleurs cohérentes : vert = OK / payé, orange = en attente / action requise,
  /// rouge = problème, gris = terminé / annulé.
  static Color color(String status) => switch (status) {
        requested || accepted || done => StatusColors.waiting,
        funded || enRoute || arrived || inProgress => StatusColors.ok,
        completed || cancelled => StatusColors.closed,
        disputed => StatusColors.problem,
        _ => StatusColors.closed,
      };

  /// Phrase « Et maintenant ? » : ce que l'utilisateur doit faire ou attendre.
  static String nextStep(Job job, {required bool asProvider}) {
    final s = job.status;
    if (asProvider) {
      return switch (s) {
        requested => job.isTender
            ? 'Envoyez votre devis avant la date limite.'
            : 'Acceptez la mission si vous êtes disponible.',
        accepted => 'Attendez que le client paie. Ne partez pas avant : vous serez prévenu.',
        funded => 'L’argent est bloqué chez Tasko. Mettez-vous en route.',
        enRoute => 'Rendez-vous chez le client, puis touchez « Je suis arrivé ».',
        arrived => 'Demandez le code à 4 chiffres au client pour commencer.',
        inProgress => 'Faites le travail, puis touchez « J’ai terminé » avec des photos.',
        done => 'Le client vérifie votre travail. Sans réponse, vous êtes payé automatiquement.',
        completed => 'Vous avez été payé. Bravo !',
        cancelled => 'Cette mission est annulée.',
        disputed => 'Un médiateur Tasko examine le problème. Répondez dans le salon.',
        _ => '',
      };
    }
    return switch (s) {
      requested => job.isTender
          ? 'Les prestataires envoient leurs devis. Choisissez le meilleur.'
          : 'Nous cherchons un prestataire. Vous ne payez rien pour l’instant.',
      accepted => 'Payez pour confirmer. L’argent reste bloqué chez Tasko jusqu’à la fin.',
      funded => 'Le prestataire va partir. Gardez votre code à 4 chiffres.',
      enRoute => 'Le prestataire arrive. Donnez-lui le code seulement à son arrivée.',
      arrived => 'Le prestataire est là. Donnez-lui votre code à 4 chiffres.',
      inProgress => 'Le travail est en cours.',
      done => 'Vérifiez le travail, puis validez pour payer le prestataire.',
      completed => 'Mission terminée. Merci !',
      cancelled => 'Cette demande est annulée.',
      disputed => 'Un médiateur Tasko examine le problème. Suivez le salon de médiation.',
      _ => '',
    };
  }

  /// Étape (0..5) de la frise « Payé → En route → Sur place → En cours → Terminé →
  /// Payé au prestataire » ; -1 avant le paiement.
  static int progressStep(String status) => switch (status) {
        funded => 0,
        enRoute => 1,
        arrived => 2,
        inProgress => 3,
        done => 4,
        completed => 5,
        _ => -1,
      };

  /// Étape (0..3) du stepper « En route / Sur place / Mission / Terminé ».
  static int trackingStep(String status) => switch (status) {
        enRoute => 0,
        arrived => 1,
        inProgress => 2,
        done || completed => 3,
        _ => -1,
      };

  /// Prochaine action du prestataire.
  static String? nextProviderStatus(String status) => switch (status) {
        funded => enRoute,
        enRoute => arrived,
        arrived => inProgress,
        inProgress => done,
        _ => null,
      };

  static String providerActionLabel(String next) => switch (next) {
        enRoute => 'Je pars chez le client',
        arrived => 'Je suis arrivé',
        inProgress => 'Entrer le code et commencer',
        done => 'J’ai terminé',
        _ => next,
      };
}


class PaymentStatus {
  PaymentStatus._();
  static String label(String s) => switch (s) {
        'unpaid' => 'Pas encore payé',
        'pending' => 'Paiement en cours',
        'held' => 'Argent bloqué en sécurité chez Tasko',
        'released' => 'Paiement versé au prestataire',
        'refunded' => 'Remboursé',
        _ => s,
      };
}

class Urgency {
  Urgency._();
  static const now = 'now';
  static const today = 'today';
  static const scheduled = 'scheduled';
  static String label(String u) => switch (u) {
        now => 'Maintenant',
        today => "Aujourd'hui",
        scheduled => 'Planifié',
        _ => u,
      };
}

/// Mode de mission (contrat V2 §5.2).
class JobMode {
  JobMode._();
  static const instant = 'instant';
  static const direct = 'direct';
  static const tender = 'tender';

  static String label(String m) => switch (m) {
        instant => 'Le premier disponible',
        direct => 'Demande directe',
        tender => 'Appel d’offres',
        _ => m,
      };
}

/// Réputation du client (RG-G7) : visible par le prestataire avant d'accepter.
class ClientTrust {
  final double ratingAvg;
  final int ratingCount;
  final int jobsPaid;
  final int disputesLost;

  const ClientTrust({
    this.ratingAvg = 0,
    this.ratingCount = 0,
    this.jobsPaid = 0,
    this.disputesLost = 0,
  });

  factory ClientTrust.fromJson(Json j) => ClientTrust(
        ratingAvg: asDouble(j['rating_avg']),
        ratingCount: asInt(j['rating_count']),
        jobsPaid: asInt(j['jobs_paid']),
        disputesLost: asInt(j['disputes_lost']),
      );

  bool get isNew => ratingCount == 0 && jobsPaid == 0;
  bool get hasLostDisputes => disputesLost > 0;

  /// Client signalé à l'administration (≥ 3 litiges perdus).
  bool get isFlagged => disputesLost >= 3;
}

class JobParty {
  final String id;
  final String fullName;
  final String? avatarUrl;

  /// `null` tant que les fonds ne sont pas sécurisés (RG-G8).
  final String? phone;
  final String? headline;
  final double? ratingAvg;
  final double? lat;
  final double? lng;

  /// Code Tasko du prestataire (`TSK-XXXXX`).
  final String? publicCode;

  /// Réputation (côté client uniquement).
  final ClientTrust? trust;

  const JobParty({
    required this.id,
    required this.fullName,
    this.avatarUrl,
    this.phone,
    this.headline,
    this.ratingAvg,
    this.lat,
    this.lng,
    this.publicCode,
    this.trust,
  });

  factory JobParty.fromJson(Json j) {
    final trust = asMap(j['trust']);
    return JobParty(
      id: asString(j['id']),
      fullName: asString(j['full_name'], 'Utilisateur'),
      avatarUrl: asStringOrNull(j['avatar_url']),
      phone: _nonEmpty(asStringOrNull(j['phone'])),
      headline: asStringOrNull(j['headline']),
      ratingAvg: asDoubleOrNull(j['rating_avg']),
      lat: asDoubleOrNull(j['lat']),
      lng: asDoubleOrNull(j['lng']),
      publicCode: _nonEmpty(asStringOrNull(j['public_code'])),
      trust: trust == null ? null : ClientTrust.fromJson(trust),
    );
  }
}

String? _nonEmpty(String? s) => (s == null || s.trim().isEmpty) ? null : s;

/// Statuts d'un jalon (contrat V2 §5.3).
class MilestoneStatus {
  MilestoneStatus._();
  static const pending = 'pending';
  static const funded = 'funded';
  static const submitted = 'submitted';
  static const released = 'released';
  static const refunded = 'refunded';
  static const disputed = 'disputed';

  static String label(String s) => switch (s) {
        pending => 'À payer',
        funded => 'Sécurisé',
        submitted => 'À valider',
        released => 'Payé',
        refunded => 'Remboursé',
        disputed => 'En litige',
        _ => s,
      };

  static Color color(String s) => switch (s) {
        pending => const Color(0xFFF59E0B),
        funded => const Color(0xFF0F7A3D),
        submitted => const Color(0xFF00A3A3),
        released => const Color(0xFF0B3D2E),
        refunded => const Color(0xFF9E9E9E),
        disputed => const Color(0xFFE53935),
        _ => const Color(0xFF6B7A72),
      };
}

/// Jalon de paiement par étapes.
class Milestone {
  final String id;
  final int position;
  final String title;
  final int amount;
  final int serviceFee;
  final String status;
  final DateTime? fundedAt;
  final DateTime? submittedAt;
  final DateTime? autoReleaseAt;
  final DateTime? releasedAt;
  final List<String> proofPhotos;
  final String? note;

  const Milestone({
    required this.id,
    this.position = 0,
    required this.title,
    required this.amount,
    this.serviceFee = 0,
    this.status = MilestoneStatus.pending,
    this.fundedAt,
    this.submittedAt,
    this.autoReleaseAt,
    this.releasedAt,
    this.proofPhotos = const [],
    this.note,
  });

  factory Milestone.fromJson(Json j) => Milestone(
        id: asString(j['id']),
        position: asInt(j['position']),
        title: asString(j['title'], 'Étape'),
        amount: asInt(j['amount']),
        serviceFee: asInt(j['service_fee']),
        status: asString(j['status'], MilestoneStatus.pending),
        fundedAt: asDate(j['funded_at']),
        submittedAt: asDate(j['submitted_at']),
        autoReleaseAt: asDate(j['auto_release_at']),
        releasedAt: asDate(j['released_at']),
        proofPhotos: asStringList(j['proof_photos']),
        note: _nonEmpty(asStringOrNull(j['note'])),
      );

  int get total => amount + serviceFee;
}

/// Jalon proposé (création de mission, offre, appel d'offres) : `{title, amount}`.
class MilestoneDraft {
  final String title;
  final int amount;
  const MilestoneDraft({required this.title, required this.amount});

  factory MilestoneDraft.fromJson(Json j) =>
      MilestoneDraft(title: asString(j['title'], 'Étape'), amount: asInt(j['amount']));

  Json toJson() => {'title': title, 'amount': amount};
}

/// Preuve de fin de mission (RG-G3).
class CompletionProof {
  final List<String> photos;
  final String? note;
  const CompletionProof({this.photos = const [], this.note});

  factory CompletionProof.fromJson(Json j) => CompletionProof(
        photos: asStringList(j['photos']),
        note: _nonEmpty(asStringOrNull(j['note'])),
      );

  bool get isEmpty => photos.isEmpty && note == null;
}

/// Référence au litige d'une mission.
class JobDisputeRef {
  final String id;
  final String status;
  final String reason;
  final String kind;
  final DateTime? respondBefore;
  const JobDisputeRef({
    required this.id,
    this.status = 'open',
    this.reason = '',
    this.kind = 'other',
    this.respondBefore,
  });

  factory JobDisputeRef.fromJson(Json j) => JobDisputeRef(
        id: asString(j['id']),
        status: asString(j['status'], 'open'),
        reason: asString(j['reason']),
        kind: asString(j['kind'], 'other'),
        respondBefore: asDate(j['respond_before']),
      );

  bool get isNoShow => kind == 'no_show';

  bool get isOpen => status != 'resolved';
}

/// Référence au bien immobilier d'une mission.
class JobPropertyRef {
  final String id;
  final String name;
  const JobPropertyRef({required this.id, required this.name});

  factory JobPropertyRef.fromJson(Json j) =>
      JobPropertyRef(id: asString(j['id']), name: asString(j['name'], 'Bien'));
}

class JobCategory {
  final String id;
  final String name;
  final String icon;
  final String? parentName;

  const JobCategory({
    required this.id,
    required this.name,
    this.icon = 'more_horiz',
    this.parentName,
  });

  factory JobCategory.fromJson(Json j) => JobCategory(
        id: asString(j['id']),
        name: asString(j['name'], 'Service'),
        icon: asString(j['icon'], 'more_horiz'),
        parentName: asStringOrNull(j['parent_name']),
      );
}

class JobReview {
  final int rating;
  final String comment;
  const JobReview({required this.rating, this.comment = ''});
  factory JobReview.fromJson(Json j) =>
      JobReview(rating: asInt(j['rating']), comment: asString(j['comment']));
}

class Job {
  final String id;
  final JobParty client;
  final JobParty? provider;
  final JobCategory category;
  final String title;
  final String description;
  final String? photoUrl;
  final String address;
  final double? lat;
  final double? lng;
  final String urgency;
  final DateTime? scheduledAt;
  final int budget;
  final int price;
  final int serviceFee;
  final int total;
  final int providerCommission;
  final int providerPayout;
  final String status;
  final String paymentStatus;
  final double? distanceKm;
  final DateTime? createdAt;
  final DateTime? acceptedAt;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final JobReview? review;

  // ------------------------------------------------------------- V2
  final String mode;
  final String origin;
  final String? visibility;
  final DateTime? bidDeadline;
  final int? budgetMin;
  final int? budgetMax;
  final int bidsCount;
  final Bid? myBid;
  final bool fundsSecured;
  final DateTime? fundedAt;

  /// Code de démarrage (renvoyé uniquement au client du job).
  final String? startCode;
  final DateTime? doneAt;
  final DateTime? autoReleaseAt;
  final String? completedBy;
  final CompletionProof? completionProof;
  final int cancellationFee;
  final String? cancelReason;
  final String? cancelledBy;
  final List<Milestone> milestones;
  final JobPropertyRef? property;
  final JobDisputeRef? dispute;

  /// Heure limite d'arrivée du prestataire (RG-G11).
  final DateTime? arrivalDeadline;

  /// Le client peut signaler « Le prestataire n'est pas venu ».
  final bool canReportNoShow;

  const Job({
    required this.id,
    required this.client,
    this.provider,
    required this.category,
    required this.title,
    this.description = '',
    this.photoUrl,
    this.address = '',
    this.lat,
    this.lng,
    this.urgency = Urgency.now,
    this.scheduledAt,
    this.budget = 0,
    this.price = 0,
    this.serviceFee = 0,
    this.total = 0,
    this.providerCommission = 0,
    this.providerPayout = 0,
    this.status = JobStatus.requested,
    this.paymentStatus = 'unpaid',
    this.distanceKm,
    this.createdAt,
    this.acceptedAt,
    this.startedAt,
    this.completedAt,
    this.review,
    this.mode = JobMode.instant,
    this.origin = 'client',
    this.visibility,
    this.bidDeadline,
    this.budgetMin,
    this.budgetMax,
    this.bidsCount = 0,
    this.myBid,
    this.fundsSecured = false,
    this.fundedAt,
    this.startCode,
    this.doneAt,
    this.autoReleaseAt,
    this.completedBy,
    this.completionProof,
    this.cancellationFee = 0,
    this.cancelReason,
    this.cancelledBy,
    this.milestones = const [],
    this.property,
    this.dispute,
    this.arrivalDeadline,
    this.canReportNoShow = false,
  });

  factory Job.fromJson(Json j) {
    final provider = asMap(j['provider']);
    final review = asMap(j['review']);
    final status = asString(j['status'], JobStatus.requested);
    final proof = asMap(j['completion_proof']);
    final property = asMap(j['property']);
    final dispute = asMap(j['dispute']);
    final myBid = asMap(j['my_bid']);
    final milestones = asList(j['milestones'], Milestone.fromJson).toList()
      ..sort((a, b) => a.position.compareTo(b.position));
    return Job(
      id: asString(j['id']),
      client: JobParty.fromJson(asMap(j['client']) ?? const {}),
      provider: provider == null ? null : JobParty.fromJson(provider),
      category: JobCategory.fromJson(asMap(j['category']) ?? const {}),
      title: asString(j['title'], 'Mission'),
      description: asString(j['description']),
      photoUrl: asStringOrNull(j['photo_url']),
      address: asString(j['address']),
      lat: asDoubleOrNull(j['lat']),
      lng: asDoubleOrNull(j['lng']),
      urgency: asString(j['urgency'], Urgency.now),
      scheduledAt: asDate(j['scheduled_at']),
      budget: asInt(j['budget']),
      price: asInt(j['price']),
      serviceFee: asInt(j['service_fee']),
      total: asInt(j['total']),
      providerCommission: asInt(j['provider_commission']),
      providerPayout: asInt(j['provider_payout']),
      status: status,
      paymentStatus: asString(j['payment_status'], 'unpaid'),
      distanceKm: asDoubleOrNull(j['distance_km']),
      createdAt: asDate(j['created_at']),
      acceptedAt: asDate(j['accepted_at']),
      startedAt: asDate(j['started_at']),
      completedAt: asDate(j['completed_at']),
      review: review == null ? null : JobReview.fromJson(review),
      mode: asString(j['mode'], JobMode.instant),
      origin: asString(j['origin'], 'client'),
      visibility: asStringOrNull(j['visibility']),
      bidDeadline: asDate(j['bid_deadline']),
      budgetMin: asIntOrNull(j['budget_min']),
      budgetMax: asIntOrNull(j['budget_max']),
      bidsCount: asInt(j['bids_count']),
      myBid: myBid == null ? null : Bid.fromJson(myBid),
      // Repli V1 : statut ≥ funded = fonds sécurisés.
      fundsSecured: j.containsKey('funds_secured')
          ? asBool(j['funds_secured'])
          : JobStatus.securedStatuses.contains(status),
      fundedAt: asDate(j['funded_at']),
      startCode: _nonEmpty(asStringOrNull(j['start_code'])),
      doneAt: asDate(j['done_at']),
      autoReleaseAt: asDate(j['auto_release_at']),
      completedBy: asStringOrNull(j['completed_by']),
      completionProof: proof == null ? null : CompletionProof.fromJson(proof),
      cancellationFee: asInt(j['cancellation_fee']),
      cancelReason: _nonEmpty(asStringOrNull(j['cancel_reason'])),
      cancelledBy: asStringOrNull(j['cancelled_by']),
      milestones: milestones,
      property: property == null ? null : JobPropertyRef.fromJson(property),
      dispute: dispute == null ? null : JobDisputeRef.fromJson(dispute),
      arrivalDeadline: asDate(j['arrival_deadline']),
      canReportNoShow: asBool(j['can_report_no_show']),
    );
  }

  /// Prix effectif (prix fixé, sinon budget).
  int get effectivePrice => price > 0 ? price : budget;

  bool get isActive => JobStatus.active.contains(status);
  bool get isLive => JobStatus.live.contains(status);

  bool get isTender => mode == JobMode.tender;
  bool get isDirect => mode == JobMode.direct;
  bool get isProviderOffer => origin == 'provider_offer';
  bool get hasMilestones => milestones.isNotEmpty;

  /// Appel d'offres encore ouvert aux offres.
  bool tenderOpen([DateTime? now]) =>
      isTender &&
      status == JobStatus.requested &&
      provider == null &&
      (bidDeadline == null || bidDeadline!.isAfter(now ?? DateTime.now()));

  /// Prochain jalon à payer (statut `pending`).
  Milestone? get nextPendingMilestone {
    for (final m in milestones) {
      if (m.status == MilestoneStatus.pending) return m;
    }
    return null;
  }

  /// Jalon en cours d'exécution (sécurisé ou soumis).
  Milestone? get currentMilestone {
    for (final m in milestones) {
      if (m.status == MilestoneStatus.funded || m.status == MilestoneStatus.submitted) return m;
    }
    return null;
  }

  /// Position (1..n) d'un jalon.
  int milestoneIndex(Milestone m) => milestones.indexWhere((e) => e.id == m.id) + 1;

  /// Montant actuellement sécurisé pour le prestataire.
  int get securedAmount {
    if (!hasMilestones) return payout;
    return currentMilestone?.amount ?? 0;
  }

  /// Montant total payé / à payer par le client.
  int get clientTotal => total > 0 ? total : effectivePrice + serviceFee;

  /// Montant reçu par le prestataire.
  int get payout => providerPayout > 0 ? providerPayout : effectivePrice;

  /// Budget indicatif d'un appel d'offres : « 100 000 – 300 000 FCFA ».
  String? get budgetRangeLabel {
    final min = budgetMin, max = budgetMax;
    if (min == null && max == null) return budget > 0 ? formatMoney(budget) : null;
    if (min != null && max != null) {
      return '${formatMoney(min, withCurrency: false)} – ${formatMoney(max)}';
    }
    if (max != null) return 'Jusqu’à ${formatMoney(max)}';
    return 'À partir de ${formatMoney(min)}';
  }
}

/// Statut d'une offre (Bid).
class BidStatus {
  BidStatus._();
  static const pending = 'pending';
  static const accepted = 'accepted';
  static const rejected = 'rejected';
  static const withdrawn = 'withdrawn';

  static String label(String s) => switch (s) {
        pending => 'En attente',
        accepted => 'Retenue',
        rejected => 'Non retenue',
        withdrawn => 'Retirée',
        _ => s,
      };

  static Color color(String s) => switch (s) {
        pending => const Color(0xFFF59E0B),
        accepted => const Color(0xFF0F7A3D),
        _ => const Color(0xFF9E9E9E),
      };
}

/// Offre d'un prestataire sur un appel d'offres.
class Bid {
  final String id;
  final String jobId;
  final ProviderCard? provider;
  final int amount;
  final int? durationDays;
  final String message;
  final List<String> attachments;
  final List<MilestoneDraft> milestones;
  final String status;
  final DateTime? createdAt;

  const Bid({
    required this.id,
    required this.jobId,
    this.provider,
    required this.amount,
    this.durationDays,
    this.message = '',
    this.attachments = const [],
    this.milestones = const [],
    this.status = BidStatus.pending,
    this.createdAt,
  });

  factory Bid.fromJson(Json j) {
    final p = asMap(j['provider']);
    return Bid(
      id: asString(j['id']),
      jobId: asString(j['job_id']),
      provider: p == null ? null : ProviderCard.fromJson(p),
      amount: asInt(j['amount']),
      durationDays: asIntOrNull(j['duration_days']),
      message: asString(j['message']),
      attachments: asStringList(j['attachments']),
      milestones: asList(j['milestones'], MilestoneDraft.fromJson),
      status: asString(j['status'], BidStatus.pending),
      createdAt: asDate(j['created_at']),
    );
  }

  bool get isPending => status == BidStatus.pending;
}

class Quote {
  final int price;
  final int serviceFee;
  final int total;
  final int providerCommission;
  final int providerPayout;

  const Quote({
    required this.price,
    required this.serviceFee,
    required this.total,
    this.providerCommission = 0,
    this.providerPayout = 0,
  });

  factory Quote.fromJson(Json j) => Quote(
        price: asInt(j['price']),
        serviceFee: asInt(j['service_fee']),
        total: asInt(j['total']),
        providerCommission: asInt(j['provider_commission']),
        providerPayout: asInt(j['provider_payout']),
      );
}
