import 'package:flutter_test/flutter_test.dart';
import 'package:tasko/core/formatters.dart';
import 'package:tasko/features/jobs/job_common.dart';
import 'package:tasko/models/conversation.dart';
import 'package:tasko/models/dispute.dart';
import 'package:tasko/models/job.dart';
import 'package:tasko/models/job_rules.dart';
import 'package:tasko/models/notification.dart';
import 'package:tasko/models/property.dart';
import 'package:tasko/models/settings.dart';
import 'package:tasko/models/user.dart';
import 'package:tasko/models/wallet.dart';
import 'package:tasko/widgets/ux.dart';

Map<String, dynamic> _job({
  String status = 'funded',
  Map<String, dynamic> extra = const {},
}) =>
    {
      'id': 'j1',
      'client': {
        'id': 'c',
        'full_name': 'Aminata',
        'phone': null,
        'trust': {'rating_avg': 4.6, 'rating_count': 9, 'jobs_paid': 12, 'disputes_lost': 1},
      },
      'provider': {
        'id': 'p',
        'full_name': 'Bika Services',
        'phone': null,
        'public_code': 'TSK-7F3K9',
      },
      'category': {'id': 'cat', 'name': 'Plomberie', 'icon': 'plumbing'},
      'title': 'Réparation fuite',
      'budget': 5000,
      'price': 5000,
      'service_fee': 250,
      'total': 5250,
      'provider_payout': 5000,
      'status': status,
      'payment_status': 'held',
      ...extra,
    };

void main() {
  group('Job V2', () {
    test('champs de garantie, réputation, code Tasko, contacts masqués', () {
      final j = Job.fromJson(_job(extra: {
        'mode': 'direct',
        'origin': 'provider_offer',
        'funds_secured': true,
        'funded_at': '2026-10-15T08:00:00.000Z',
        'start_code': '4821',
        'auto_release_at': '2026-10-17T08:00:00.000Z',
        'completion_proof': {
          'photos': ['/uploads/a.jpg', '/uploads/b.jpg'],
          'note': 'Joint changé'
        },
        'cancellation_fee': 0,
        'property': {'id': 'pr', 'name': 'Résidence Les Palmiers'},
        'dispute': null,
        'arrival_deadline': '2026-10-15T11:00:00.000Z',
        'can_report_no_show': false,
      }));
      expect(j.mode, JobMode.direct);
      expect(j.isProviderOffer, isTrue);
      expect(j.fundsSecured, isTrue);
      expect(j.startCode, '4821');
      expect(j.client.phone, isNull);
      expect(j.client.trust!.jobsPaid, 12);
      expect(j.client.trust!.hasLostDisputes, isTrue);
      expect(j.client.trust!.isFlagged, isFalse);
      expect(j.provider!.publicCode, 'TSK-7F3K9');
      expect(j.completionProof!.photos, hasLength(2));
      expect(j.completionProof!.note, 'Joint changé');
      expect(j.property!.name, 'Résidence Les Palmiers');
      expect(j.dispute, isNull);
      expect(j.autoReleaseAt!.isUtc, isTrue);
      expect(j.arrivalDeadline, isNotNull);
      expect(j.canReportNoShow, isFalse);
    });

    test('valeurs nulles / absentes tolérées (repli V1)', () {
      final j = Job.fromJson({'id': 'x', 'status': 'en_route'});
      expect(j.mode, JobMode.instant);
      expect(j.milestones, isEmpty);
      expect(j.completionProof, isNull);
      expect(j.startCode, isNull);
      // Sans `funds_secured`, un statut ≥ funded vaut fonds sécurisés.
      expect(j.fundsSecured, isTrue);
      expect(Job.fromJson({'id': 'y', 'status': 'accepted'}).fundsSecured, isFalse);
      expect(Job.fromJson({'id': 'z', 'start_code': ''}).startCode, isNull);
    });

    test('jalons triés, prochain jalon, montant sécurisé', () {
      final j = Job.fromJson(_job(extra: {
        'price': 450000,
        'milestones': [
          {'id': 'm2', 'position': 2, 'title': 'Finitions', 'amount': 250000, 'status': 'pending'},
          {
            'id': 'm1',
            'position': 1,
            'title': 'Gros œuvre',
            'amount': 200000,
            'service_fee': 10000,
            'status': 'funded',
            'proof_photos': [],
          },
        ],
      }));
      expect(j.milestones.map((m) => m.id), ['m1', 'm2']);
      expect(j.currentMilestone!.id, 'm1');
      expect(j.nextPendingMilestone!.id, 'm2');
      expect(j.securedAmount, 200000);
      expect(j.milestoneIndex(j.milestones[1]), 2);
      expect(j.milestones.first.total, 210000);
      expect(MilestoneStatus.label('submitted'), 'À valider');
    });

    test('appel d\'offres : budget, ouverture, offre', () {
      final j = Job.fromJson(_job(status: 'requested', extra: {
        'provider': null,
        'mode': 'tender',
        'visibility': 'public',
        'bid_deadline': '2099-01-01T00:00:00.000Z',
        'budget_min': 100000,
        'budget_max': 300000,
        'bids_count': 3,
        'my_bid': {
          'id': 'b1',
          'job_id': 'j1',
          'amount': 450000,
          'duration_days': 10,
          'attachments': ['/uploads/devis.jpg'],
          'milestones': [
            {'title': 'Gros œuvre', 'amount': 200000},
            {'title': 'Finitions', 'amount': 250000},
          ],
          'status': 'pending',
        },
      }));
      expect(j.isTender, isTrue);
      expect(j.tenderOpen(DateTime(2026)), isTrue);
      expect(j.budgetRangeLabel, '100 000 – 300 000 FCFA');
      expect(j.myBid!.milestones.last.amount, 250000);
      expect(j.myBid!.isPending, isTrue);
      expect(BidStatus.label('rejected'), 'Non retenue');
      final closed = Job.fromJson(_job(status: 'requested', extra: {
        'provider': null,
        'mode': 'tender',
        'bid_deadline': '2020-01-01T00:00:00.000Z',
      }));
      expect(closed.tenderOpen(), isFalse);
    });

    test('routage V2', () {
      expect(
        jobRouteFor(Job.fromJson(_job(status: 'requested', extra: {'mode': 'tender', 'provider': null})),
            asProvider: false),
        '/jobs/j1/tender',
      );
      expect(
        jobRouteFor(Job.fromJson(_job(status: 'requested', extra: {'mode': 'tender', 'provider': null})),
            asProvider: true),
        '/tenders/j1',
      );
      expect(
        jobRouteFor(Job.fromJson(_job(status: 'accepted', extra: {'origin': 'provider_offer'})),
            asProvider: false),
        '/jobs/j1/proposal',
      );
      expect(
        jobRouteFor(
            Job.fromJson(_job(status: 'disputed', extra: {
              'dispute': {'id': 'd1', 'status': 'open', 'reason': 'x', 'kind': 'no_show'}
            })),
            asProvider: true),
        '/disputes/d1',
      );
    });
  });

  group('Règles d\'annulation (RG-G5)', () {
    Job withStatus(String s, {int price = 5000}) =>
        Job.fromJson(_job(status: s, extra: {'price': price, 'total': price + 250}));

    test('client : gratuit / remboursé / frais / impossible', () {
      expect(clientCancellationPolicy(withStatus('requested')).kind, CancelKind.free);
      expect(clientCancellationPolicy(withStatus('accepted')).kind, CancelKind.free);
      final funded = clientCancellationPolicy(withStatus('funded'));
      expect(funded.kind, CancelKind.refund);
      expect(funded.description, contains('5 250 FCFA'));
      final enRoute = clientCancellationPolicy(withStatus('en_route'), feeEnRoute: 1000);
      expect(enRoute.kind, CancelKind.fee);
      expect(enRoute.fee, 1000);
      expect(enRoute.title, 'Frais de déplacement : 1 000 FCFA');
      for (final s in ['arrived', 'in_progress', 'done']) {
        final p = clientCancellationPolicy(withStatus(s));
        expect(p.kind, CancelKind.forbidden, reason: s);
        expect(p.canCancel, isFalse);
        expect(p.description, contains('litige'));
      }
      expect(clientCancellationPolicy(withStatus('completed')).kind, CancelKind.none);
    });

    test('frais de déplacement plafonnés au prix', () {
      final p = clientCancellationPolicy(withStatus('en_route', price: 700), feeEnRoute: 1000);
      expect(p.fee, 700);
    });

    test('prestataire : possible jusqu\'à in_progress inclus', () {
      for (final s in ['accepted', 'funded', 'en_route', 'arrived', 'in_progress']) {
        expect(providerCancellationPolicy(withStatus(s)).canCancel, isTrue, reason: s);
      }
      expect(providerCancellationPolicy(withStatus('done')).canCancel, isFalse);
    });

    test('litige ouvrable de funded à done, avant la libération automatique', () {
      expect(canOpenDispute(withStatus('accepted')), isFalse);
      expect(canOpenDispute(withStatus('in_progress')), isTrue);
      final done = Job.fromJson(_job(status: 'done', extra: {
        'auto_release_at': '2026-10-17T08:00:00.000Z',
      }));
      expect(canOpenDispute(done, now: DateTime.utc(2026, 10, 16)), isTrue);
      expect(canOpenDispute(done, now: DateTime.utc(2026, 10, 18)), isFalse);
    });

    test('le prestataire ne part pas sans fonds sécurisés (RG-G1)', () {
      expect(providerCanStart(Job.fromJson(_job(status: 'accepted', extra: {'funds_secured': false}))),
          isFalse);
      expect(providerCanStart(Job.fromJson(_job(status: 'funded', extra: {'funds_secured': true}))),
          isTrue);
    });
  });

  group('Prestataire absent (RG-G11)', () {
    test('affichage du bouton « Le prestataire n\'est pas venu »', () {
      Job j(String status, bool can, {Map<String, dynamic>? dispute}) => Job.fromJson(
          _job(status: status, extra: {'can_report_no_show': can, 'dispute': dispute}));
      expect(noShowButtonVisible(j('en_route', true)), isTrue);
      expect(noShowButtonVisible(j('funded', true)), isTrue);
      expect(noShowButtonVisible(j('en_route', false)), isFalse);
      expect(noShowButtonVisible(j('in_progress', true)), isFalse);
      expect(
          noShowButtonVisible(
              j('en_route', true, dispute: {'id': 'd', 'status': 'open', 'kind': 'no_show'})),
          isFalse);
    });

    test('rappel de l\'heure limite d\'arrivée', () {
      final deadline = DateTime(2026, 10, 15, 14, 30);
      final j = Job.fromJson(_job(status: 'en_route', extra: {
        'arrival_deadline': deadline.toUtc().toIso8601String(),
        'can_report_no_show': false,
      }));
      expect(arrivalDeadlineNotice(j, now: DateTime(2026, 10, 15, 12)),
          'Le prestataire doit arriver avant 14:30.');
      expect(arrivalDeadlineNotice(j, now: DateTime(2026, 10, 14, 12)),
          'Le prestataire doit arriver avant 14:30 le 15/10/2026.');
      expect(arrivalDeadlineNotice(j, now: DateTime(2026, 10, 15, 15)), isNull);
    });
  });

  group('Litige / médiation', () {
    test('Dispute + Proposal', () {
      final d = Dispute.fromJson({
        'id': 'd1',
        'kind': 'no_show',
        'job': _job(status: 'disputed'),
        'opened_by': {'id': 'c', 'full_name': 'Aminata', 'role': 'client'},
        'reason': 'Le prestataire n’est pas venu',
        'status': 'open',
        'conversation_id': 'cv1',
        'respond_before': '2026-10-15T20:00:00.000Z',
        'decision_due_at': '2026-10-18T08:00:00.000Z',
        'proposals': [
          {
            'id': 'p1',
            'author': {'id': 'a', 'full_name': 'Équipe Tasko', 'role': 'admin'},
            'provider_amount': 3000,
            'client_refund': 2000,
            'message': 'Partage équitable',
            'client_accepted': true,
            'provider_accepted': null,
            'status': 'pending',
            'created_at': '2026-10-15T10:00:00.000Z',
          },
        ],
        'resolution': null,
        'resolved_by': null,
      });
      expect(d.isNoShow, isTrue);
      expect(d.kindLabel, 'Prestataire absent');
      expect(d.isResolved, isFalse);
      expect(d.conversationId, 'cv1');
      expect(d.job!.status, JobStatus.disputed);
      expect(d.openedByRole, MediationRole.client);
      final p = d.activeProposal!;
      expect(p.providerAmount, 3000);
      expect(p.clientRefund, 2000);
      expect(p.answerOf(MediationRole.client), isTrue);
      expect(p.answerOf(MediationRole.provider), isNull);
      expect(p.authorRole, MediationRole.admin);
      expect(MediationRole.label('admin'), 'Médiateur Tasko');
      expect(d.proposalById('p1'), same(p));
    });

    test('décision finale et résolution (chaîne ou objet)', () {
      final d = Dispute.fromJson({
        'id': 'd2',
        'status': 'resolved',
        'resolution': 'split',
        'provider_amount': 3000,
        'resolved_by': 'agreement',
        'resolution_note': 'Accord des deux parties',
      });
      expect(d.isResolved, isTrue);
      expect(d.resolutionLabel, 'Montant partagé entre les deux parties');
      expect(d.resolvedByLabel, contains('Accord amiable'));
      expect(d.resolutionNote, 'Accord des deux parties');
      final legacy = Dispute.fromJson({
        'id': 'd3',
        'status': 'resolved',
        'resolution': {'resolution': 'refund', 'note': 'Travail non fait'},
      });
      expect(legacy.resolution, 'refund');
      expect(legacy.resolutionNote, 'Travail non fait');
    });

    test('messages du salon : rôle, système, proposition', () {
      final m = Message.fromJson({
        'id': 'm',
        'conversation_id': 'cv1',
        'sender_id': 'a',
        'sender_role': 'admin',
        'type': 'text',
        'body': 'Bonjour',
      });
      expect(m.senderRole, 'admin');
      final sys = Message.fromJson({'id': 's', 'type': 'system', 'body': 'Litige ouvert'});
      expect(sys.isSystem, isTrue);
      final prop = Message.fromJson({'id': 'p', 'type': 'proposal', 'body': 'p1'});
      expect(prop.isProposal, isTrue);
      expect(prop.preview, 'Proposition d’accord');
    });
  });

  group('Entreprise, immobilier, portefeuille, reçu, paramètres', () {
    test('User.business et ProviderProfile V2', () {
      final u = User.fromJson({
        'id': 'u',
        'full_name': 'Agence Soleil',
        'account_type': 'business',
        'business': {'name': 'Agence Soleil', 'kind': 'real_estate', 'niu': 'M0123'},
        'provider': {'user_id': 'u', 'public_code': 'TSK-AB12C', 'cancellations': 2, 'wallet_available': 7000},
      });
      expect(u.isBusiness, isTrue);
      expect(u.business!.isRealEstate, isTrue);
      expect(u.business!.toJson(), {'name': 'Agence Soleil', 'kind': 'real_estate', 'niu': 'M0123'});
      expect(u.provider!.publicCode, 'TSK-AB12C');
      expect(u.provider!.walletAvailable, 7000);
      expect(User.fromJson({'id': 'v', 'business': null}).isBusiness, isFalse);
    });

    test('Property, PropertyDetail, RecurringJob', () {
      final d = PropertyDetail.fromJson({
        'id': 'pr',
        'name': 'Résidence Les Palmiers',
        'kind': 'building',
        'address': 'Bastos',
        'units_count': 12,
        'jobs_count': 4,
        'total_spent': 85000,
        'jobs': [_job(status: 'completed')],
        'recurring': [
          {
            'id': 'r',
            'property_id': 'pr',
            'category_id': 'cat',
            'provider_id': 'p',
            'title': 'Ménage des communs',
            'price': 15000,
            'frequency': 'weekly',
            'next_run_at': '2026-10-20T07:00:00.000Z',
            'is_active': true,
          },
        ],
      });
      expect(d.property.unitsCount, 12);
      expect(d.property.totalSpent, 85000);
      expect(d.jobs.single.status, 'completed');
      expect(d.recurring.single.frequency, 'weekly');
      expect(frequencyLabel('weekly'), 'Chaque semaine');
      expect(propertyKindLabel('building'), 'Immeuble');
    });

    test('Wallet et Receipt', () {
      final w = Wallet.fromJson({
        'held': 10000,
        'available': 3000,
        'paid_out_total': 120000,
        'pending_release': [
          {'job_id': 'j', 'title': 'Fuite', 'amount': 5000, 'auto_release_at': '2026-10-17T08:00:00.000Z'}
        ],
        'items': [
          {'id': 't', 'type': 'cancellation_fee', 'amount': 1000, 'status': 'success'}
        ],
      });
      expect(w.available, 3000);
      expect(w.pendingRelease.single.amount, 5000);
      expect(w.items.single.isIncoming, isTrue);
      expect(w.items.single.typeLabel, 'Frais de déplacement');

      final r = Receipt.fromJson({
        'number': 'TSK-2026-000123',
        'issued_at': '2026-10-15T10:00:00.000Z',
        'client': {'name': 'Agence Soleil', 'business': {'name': 'Agence Soleil SARL'}},
        'provider': {'name': 'Bika Services', 'public_code': 'TSK-7F3K9'},
        'lines': [
          {'label': 'Réparation fuite', 'amount': 5000}
        ],
        'service_fee': 250,
        'total': 5250,
        'payment_method': 'mtn_momo',
        'payment_ref': 'MOCK-1',
        'status': 'paid',
      });
      expect(r.clientBusiness, 'Agence Soleil SARL');
      expect(r.providerCode, 'TSK-7F3K9');
      expect(r.lines.single.amount, 5000);
      expect(r.statusLabel, 'Payé');
    });

    test('PublicSettings : valeurs serveur et défauts du contrat', () {
      final d = PublicSettings.fromJson(const {});
      expect(d.autoReleaseHours, 48);
      expect(d.cancellationFeeEnRoute, 1000);
      expect(d.proPlanPrice, 3000);
      expect(d.requireStartCode, isTrue);
      final s = PublicSettings.fromJson({'pro_plan_price': 4000, 'require_start_code': false});
      expect(s.proPlanPrice, 4000);
      expect(s.requireStartCode, isFalse);
    });
  });

  group('Formatage V2', () {
    test('compte à rebours', () {
      expect(formatCountdown(const Duration(hours: 47, minutes: 5)), '47 h 05 min');
      expect(formatCountdown(const Duration(minutes: 12, seconds: 5)), '12 min 05 s');
      expect(formatCountdown(const Duration(days: 3, hours: 4)), '3 j 04 h');
      expect(formatCountdown(Duration.zero), 'Échéance atteinte');
      expect(formatCountdown(const Duration(seconds: -5)), 'Échéance atteinte');
    });

    test('date courte JJ/MM à HH:MM', () {
      expect(formatShortDateTime(DateTime(2026, 10, 17, 14, 30)), '17/10 à 14:30');
      expect(formatShortDateTime(null), '');
    });

    test('suppression des emojis des textes serveur', () {
      expect(stripEmoji('\u{1F4CD} Position partagée'), 'Position partagée');
      expect(stripEmoji('Paiement reçu \u{1F389}\u{1F680}'), 'Paiement reçu');
      expect(stripEmoji('Mission à 5 000 FCFA'), 'Mission à 5 000 FCFA');
      final n = AppNotification.fromJson({'id': 'n', 'title': 'Bravo \u{1F44B}', 'body': '\u{1F6A8} Urgent'});
      expect(n.title, 'Bravo');
      expect(n.body, 'Urgent');
    });

    test('saisie de montant avec séparateur de milliers', () {
      final f = ThousandsInputFormatter();
      final v = f.formatEditUpdate(TextEditingValue.empty, const TextEditingValue(text: '250000'));
      expect(v.text, '250 000');
      expect(parseAmount(v.text), 250000);
      expect(f.formatEditUpdate(TextEditingValue.empty, const TextEditingValue(text: 'ab')).text, '');
    });

    test('libellés humains et « Et maintenant ? »', () {
      final j = Job.fromJson(_job(status: 'accepted'));
      expect(JobStatus.nextStep(j, asProvider: true), contains('Attendez que le client paie'));
      expect(JobStatus.nextStep(j, asProvider: false), contains('Payez pour confirmer'));
      expect(PaymentStatus.label('held'), 'Argent bloqué en sécurité chez Tasko');
      expect(JobStatus.progressStep('done'), 4);
      expect(JobStatus.progressStep('requested'), -1);
    });
  });
}
