import 'json.dart';
import 'transaction.dart';

/// Paiement en attente de libération (mission terminée, délai client en cours).
class PendingRelease {
  final String jobId;
  final String title;
  final int amount;
  final DateTime? autoReleaseAt;

  const PendingRelease({
    required this.jobId,
    required this.title,
    required this.amount,
    this.autoReleaseAt,
  });

  factory PendingRelease.fromJson(Json j) => PendingRelease(
        jobId: asString(j['job_id']),
        title: asString(j['title'], 'Mission'),
        amount: asInt(j['amount']),
        autoReleaseAt: asDate(j['auto_release_at']),
      );
}

/// Portefeuille prestataire (`GET /me/wallet`).
class Wallet {
  /// Séquestré pour ses missions en cours.
  final int held;

  /// Disponible (versement échoué ou en attente) : retirable.
  final int available;
  final int paidOutTotal;
  final List<PendingRelease> pendingRelease;
  final List<Transaction> items;

  const Wallet({
    this.held = 0,
    this.available = 0,
    this.paidOutTotal = 0,
    this.pendingRelease = const [],
    this.items = const [],
  });

  factory Wallet.fromJson(Json j) => Wallet(
        held: asInt(j['held']),
        available: asInt(j['available']),
        paidOutTotal: asInt(j['paid_out_total']),
        pendingRelease: asList(j['pending_release'], PendingRelease.fromJson),
        items: asList(j['items'], Transaction.fromJson),
      );
}

/// Ligne d'un reçu.
class ReceiptLine {
  final String label;
  final int amount;
  const ReceiptLine({required this.label, required this.amount});

  factory ReceiptLine.fromJson(Json j) =>
      ReceiptLine(label: asString(j['label']), amount: asInt(j['amount']));
}

/// Reçu d'une mission (`GET /jobs/:id/receipt`).
class Receipt {
  final String number;
  final DateTime? issuedAt;
  final String clientName;
  final String? clientBusiness;
  final String providerName;
  final String? providerCode;
  final List<ReceiptLine> lines;
  final int serviceFee;
  final int total;
  final String? paymentMethod;
  final String? paymentRef;
  final String status;

  const Receipt({
    required this.number,
    this.issuedAt,
    this.clientName = '',
    this.clientBusiness,
    this.providerName = '',
    this.providerCode,
    this.lines = const [],
    this.serviceFee = 0,
    this.total = 0,
    this.paymentMethod,
    this.paymentRef,
    this.status = '',
  });

  factory Receipt.fromJson(Json j) {
    final client = asMap(j['client']) ?? const {};
    final provider = asMap(j['provider']) ?? const {};
    final business = client['business'];
    final businessMap = asMap(business);
    return Receipt(
      number: asString(j['number'], '—'),
      issuedAt: asDate(j['issued_at']),
      clientName: asString(client['name'] ?? client['full_name']),
      clientBusiness: businessMap != null
          ? asStringOrNull(businessMap['name'])
          : (business == null ? null : asString(business)),
      providerName: asString(provider['name'] ?? provider['full_name']),
      providerCode: asStringOrNull(provider['public_code']),
      lines: asList(j['lines'], ReceiptLine.fromJson),
      serviceFee: asInt(j['service_fee']),
      total: asInt(j['total']),
      paymentMethod: asStringOrNull(j['payment_method']),
      paymentRef: asStringOrNull(j['payment_ref']),
      status: asString(j['status']),
    );
  }

  String get statusLabel => switch (status) {
        'paid' || 'released' || 'completed' => 'Payé',
        'held' => 'Payé (en séquestre)',
        'refunded' => 'Remboursé',
        '' => '',
        _ => status,
      };
}
