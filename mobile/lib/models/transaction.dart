import 'json.dart';

class PaymentMethod {
  PaymentMethod._();
  static const mtn = 'mtn_momo';
  static const orange = 'orange_money';
  static const card = 'card';

  static String label(String m) => switch (m) {
        mtn => 'MTN Mobile Money',
        orange => 'Orange Money',
        card => 'Carte bancaire',
        _ => m,
      };
}

class Transaction {
  final String id;
  final String? jobId;
  final String userId;
  final String type;
  final int amount;
  final String method;
  final String? phone;
  final String provider;
  final String? externalRef;
  final String status;
  final DateTime? createdAt;

  const Transaction({
    required this.id,
    this.jobId,
    this.userId = '',
    required this.type,
    required this.amount,
    this.method = PaymentMethod.mtn,
    this.phone,
    this.provider = 'mock',
    this.externalRef,
    this.status = 'pending',
    this.createdAt,
  });

  bool get isPending => status == 'pending';

  /// Argent reçu par l'utilisateur (versement, remboursement, frais d'annulation).
  bool get isIncoming =>
      type == 'payout' || type == 'refund' || type == 'partial_refund' || type == 'cancellation_fee';
  bool get isSuccess => status == 'success';
  bool get isFailed => status == 'failed';

  factory Transaction.fromJson(Json j) => Transaction(
        id: asString(j['id']),
        jobId: asStringOrNull(j['job_id']),
        userId: asString(j['user_id']),
        type: asString(j['type']),
        amount: asInt(j['amount']),
        method: asString(j['method'], PaymentMethod.mtn),
        phone: asStringOrNull(j['phone']),
        provider: asString(j['provider'], 'mock'),
        externalRef: asStringOrNull(j['external_ref']),
        status: asString(j['status'], 'pending'),
        createdAt: asDate(j['created_at']),
      );

  String get typeLabel => switch (type) {
        'escrow_in' => 'Paiement bloqué chez Tasko',
        'payout' => 'Paiement versé',
        'commission' => 'Commission Tasko',
        'refund' => 'Remboursement',
        'subscription' => 'Abonnement Tasko Pro',
        'boost' => 'Boost de visibilité',
        'cancellation_fee' => 'Frais de déplacement',
        'partial_refund' => 'Remboursement partiel',
        'withdrawal' => 'Retrait vers Mobile Money',
        _ => type,
      };

  String get statusLabel => switch (status) {
        'pending' => 'En attente',
        'success' => 'Réussi',
        'failed' => 'Échoué',
        _ => status,
      };
}

class PaymentResult {
  final Transaction transaction;
  final String? checkoutUrl;
  const PaymentResult({required this.transaction, this.checkoutUrl});

  factory PaymentResult.fromJson(Json j) => PaymentResult(
        transaction: Transaction.fromJson(asMap(j['transaction']) ?? const {}),
        checkoutUrl: asStringOrNull(j['checkout_url']),
      );
}

class Earnings {
  final int balanceHeld;
  final int totalEarned;
  final int monthEarned;
  final int jobsCompleted;
  final List<Transaction> items;

  const Earnings({
    this.balanceHeld = 0,
    this.totalEarned = 0,
    this.monthEarned = 0,
    this.jobsCompleted = 0,
    this.items = const [],
  });

  factory Earnings.fromJson(Json j) => Earnings(
        balanceHeld: asInt(j['balance_held']),
        totalEarned: asInt(j['total_earned']),
        monthEarned: asInt(j['month_earned']),
        jobsCompleted: asInt(j['jobs_completed']),
        items: asList(j['items'], Transaction.fromJson),
      );
}
