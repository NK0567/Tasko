import '../core/formatters.dart';
import 'job.dart';

/// Type de règle d'annulation applicable à une mission (RG-G5).
enum CancelKind {
  /// Annulation gratuite (rien n'a été payé).
  free,

  /// Annulation avec remboursement intégral.
  refund,

  /// Annulation avec frais de déplacement retenus pour le prestataire.
  fee,

  /// Annulation interdite : seul le litige est possible.
  forbidden,

  /// Mission terminée / annulée : sans objet.
  none,
}

/// Règle d'annulation affichée au client ou au prestataire.
class CancellationPolicy {
  final CancelKind kind;

  /// Frais retenus (FCFA) pour [CancelKind.fee].
  final int fee;

  /// Titre court (« Annulation gratuite »…).
  final String title;

  /// Explication complète.
  final String description;

  const CancellationPolicy({
    required this.kind,
    required this.title,
    required this.description,
    this.fee = 0,
  });

  bool get canCancel =>
      kind == CancelKind.free || kind == CancelKind.refund || kind == CancelKind.fee;
}

/// Règle d'annulation côté **client** selon le statut (RG-G5).
///
/// [feeEnRoute] = `cancellation_fee_en_route` (défaut 1 000 FCFA), plafonné au prix.
CancellationPolicy clientCancellationPolicy(Job job, {int feeEnRoute = 1000}) {
  switch (job.status) {
    case JobStatus.requested:
    case JobStatus.accepted:
      return const CancellationPolicy(
        kind: CancelKind.free,
        title: 'Annulation gratuite',
        description: 'Vous n’avez encore rien payé : vous pouvez annuler sans frais.',
      );
    case JobStatus.funded:
      return CancellationPolicy(
        kind: CancelKind.refund,
        title: 'Annulation remboursée',
        description:
            'Le prestataire n’est pas encore parti : vous êtes remboursé intégralement (${formatMoney(job.clientTotal)}).',
      );
    case JobStatus.enRoute:
      final price = job.effectivePrice;
      final fee = price > 0 && feeEnRoute > price ? price : feeEnRoute;
      return CancellationPolicy(
        kind: CancelKind.fee,
        fee: fee,
        title: 'Frais de déplacement : ${formatMoney(fee)}',
        description:
            'Le prestataire est en route : ${formatMoney(fee)} lui sont versés pour son déplacement, '
            'le reste vous est remboursé.',
      );
    case JobStatus.arrived:
    case JobStatus.inProgress:
    case JobStatus.done:
      return const CancellationPolicy(
        kind: CancelKind.forbidden,
        title: 'Annulation impossible',
        description:
            'Le prestataire est sur place ou a commencé : l’annulation n’est plus possible. '
            'En cas de problème, ouvrez un litige avec vos preuves.',
      );
    default:
      return const CancellationPolicy(
        kind: CancelKind.none,
        title: 'Annulation sans objet',
        description: 'Cette mission n’est plus annulable.',
      );
  }
}

/// Règle d'annulation côté **prestataire** : possible jusqu'à `in_progress` inclus.
CancellationPolicy providerCancellationPolicy(Job job) {
  switch (job.status) {
    case JobStatus.accepted:
      return const CancellationPolicy(
        kind: CancelKind.free,
        title: 'Vous pouvez vous retirer',
        description: 'Le client n’a pas encore payé. Votre retrait compte dans votre taux d’annulation.',
      );
    case JobStatus.funded:
    case JobStatus.enRoute:
    case JobStatus.arrived:
    case JobStatus.inProgress:
      return const CancellationPolicy(
        kind: CancelKind.refund,
        title: 'Annulation possible',
        description: 'Le client sera remboursé intégralement. Cette annulation est comptée '
            'dans votre profil et fait baisser votre classement.',
      );
    case JobStatus.done:
      return const CancellationPolicy(
        kind: CancelKind.forbidden,
        title: 'Annulation impossible',
        description: 'Mission déclarée terminée : en cas de désaccord, un litige peut être ouvert.',
      );
    default:
      return const CancellationPolicy(
        kind: CancelKind.none,
        title: 'Annulation sans objet',
        description: 'Cette mission n’est plus annulable.',
      );
  }
}

/// Le prestataire peut-il partir / démarrer ? (RG-G1 : fonds séquestrés).
bool providerCanStart(Job job) =>
    job.fundsSecured && JobStatus.securedStatuses.contains(job.status);

/// Litige ouvrable (RG-G6) : de `funded` à `done`, avant la libération automatique.
bool canOpenDispute(Job job, {DateTime? now}) {
  if (job.dispute != null && job.dispute!.isOpen) return false;
  if (!JobStatus.disputable.contains(job.status)) return false;
  final release = job.autoReleaseAt;
  if (job.status == JobStatus.done && release != null) {
    return release.isAfter(now ?? DateTime.now());
  }
  return true;
}


/// Le bouton « Le prestataire n'est pas venu » est-il affiché au client ? (RG-G11)
/// Seulement si le serveur l'autorise (`can_report_no_show`), avant le démarrage
/// et sans litige déjà ouvert.
bool noShowButtonVisible(Job job) =>
    job.canReportNoShow &&
    {JobStatus.funded, JobStatus.enRoute, JobStatus.arrived}.contains(job.status) &&
    (job.dispute == null || !job.dispute!.isOpen);

/// Rappel « Le prestataire doit arriver avant HH:MM » tant que l'heure limite
/// n'est pas passée (null sinon).
String? arrivalDeadlineNotice(Job job, {DateTime? now}) {
  final deadline = job.arrivalDeadline;
  if (deadline == null || job.canReportNoShow) return null;
  if (!{JobStatus.funded, JobStatus.enRoute}.contains(job.status)) return null;
  final ref = now ?? DateTime.now();
  if (!deadline.isAfter(ref)) return null;
  final d = deadline.toLocal();
  final r = ref.toLocal();
  final sameDay = d.year == r.year && d.month == r.month && d.day == r.day;
  return 'Le prestataire doit arriver avant ${formatTime(d)}${sameDay ? '' : ' le ${formatDate(d)}'}.';
}
