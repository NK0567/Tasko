import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tasko/core/formatters.dart';
import 'package:tasko/core/icon_map.dart';
import 'package:tasko/features/jobs/job_common.dart';
import 'package:tasko/models/category.dart';
import 'package:tasko/models/conversation.dart';
import 'package:tasko/models/job.dart';
import 'package:tasko/models/notification.dart';
import 'package:tasko/models/provider_card.dart';
import 'package:tasko/models/transaction.dart';
import 'package:tasko/models/user.dart';

void main() {
  group('Formatage', () {
    test('montants FCFA avec espaces insécables', () {
      expect(formatMoney(5000), '5 000 FCFA');
      expect(formatMoney(1248500), '1 248 500 FCFA');
      expect(formatMoney(250), '250 FCFA');
      expect(formatMoney(null), '0 FCFA');
      expect(formatMoney(5250, withCurrency: false), '5 250');
    });

    test('distance et note', () {
      expect(formatDistance(0.45), '450 m');
      expect(formatDistance(2.3), '2,3 km');
      expect(formatDistance(12.6), '13 km');
      expect(formatRating(4.75), '4,8');
    });

    test('temps relatif', () {
      final now = DateTime(2026, 10, 3, 12, 0);
      expect(formatRelative(now.subtract(const Duration(seconds: 20)), now: now), "À l'instant");
      expect(formatRelative(now.subtract(const Duration(minutes: 5)), now: now), 'Il y a 5 min');
      expect(formatRelative(now.subtract(const Duration(hours: 2)), now: now), 'Il y a 2 h');
      expect(formatRelative(now.subtract(const Duration(days: 1)), now: now), 'Hier');
      expect(formatRelative(now.subtract(const Duration(days: 3)), now: now), 'Il y a 3 j');
    });

    test('téléphone camerounais', () {
      expect(normalizeCameroonPhone('690000001'), '+237690000001');
      expect(normalizeCameroonPhone('+237 6 90 00 00 01'), '+237690000001');
      expect(normalizeCameroonPhone('00237690000001'), '+237690000001');
      expect(normalizeCameroonPhone('590000001'), isNull);
      expect(normalizeCameroonPhone('6900'), isNull);
    });

    test('initiales et frais', () {
      expect(initialsOf('Moussa Kamga'), 'MK');
      expect(initialsOf('bika'), 'B');
      expect(initialsOf(''), '?');
      expect(estimateServiceFee(5000), 250);
      expect(estimateServiceFee(1000), 100);
    });

    test('icônes et couleurs', () {
      expect(iconForKey('plumbing'), Icons.plumbing);
      expect(iconForKey('inconnue'), kFallbackCategoryIcon);
      expect(iconForKey(null), kFallbackCategoryIcon);
      expect(colorFromHex('#E91E63'), const Color(0xFFE91E63));
      expect(colorFromHex('nope'), const Color(0xFF0F7A3D));
    });
  });

  group('Modèles', () {
    test('User + ProviderProfile', () {
      final u = User.fromJson({
        'id': 'u1',
        'full_name': 'Moussa Kamga',
        'phone': '+237690000001',
        'email': null,
        'avatar_url': null,
        'city': 'Yaoundé',
        'is_provider': true,
        'is_admin': false,
        'status': 'active',
        'verification_level': 2,
        'created_at': '2026-10-03T08:15:00.000Z',
        'provider': {
          'user_id': 'u1',
          'headline': 'Étudiant / Informaticien',
          'provider_type': 'student',
          'years_experience': 2,
          'is_online': true,
          'lat': 3.86,
          'lng': 11.51,
          'rating_avg': 4.7,
          'rating_count': 12,
          'available_days': [1, 2, 3],
          'skills': [
            {
              'category_id': 'c1',
              'name': 'Plomberie',
              'parent_name': 'Bâtiment & Chantier',
              'icon': 'plumbing',
              'base_price': 5000,
            },
          ],
          'portfolio': [
            {'id': 'p1', 'title': 'Réparation fuite', 'image_url': '/uploads/x.jpg'},
          ],
        },
      });
      expect(u.isProvider, isTrue);
      expect(u.verificationLevel, 2);
      expect(u.provider!.providerType, 'student');
      expect(u.provider!.skills.single.basePrice, 5000);
      expect(u.provider!.portfolio.single.imageUrl, '/uploads/x.jpg');
      expect(u.provider!.availableDays, [1, 2, 3]);
      expect(u.headline, 'Étudiant / Informaticien');
      expect(u.createdAt!.isUtc, isTrue);
    });

    test('Category avec enfants triés et inactifs filtrés', () {
      final c = Category.fromJson({
        'id': 'c',
        'parent_id': null,
        'name': 'Beauté & Bien-être',
        'icon': 'spa',
        'color': '#E91E63',
        'position': 3,
        'is_active': true,
        'children': [
          {'id': 'b', 'parent_id': 'c', 'name': 'Coiffure', 'icon': 'content_cut', 'position': 2},
          {'id': 'a', 'parent_id': 'c', 'name': 'Manucure', 'icon': 'brush', 'position': 1},
          {'id': 'x', 'parent_id': 'c', 'name': 'Ancien', 'position': 0, 'is_active': false},
        ],
      });
      expect(c.isRoot, isTrue);
      expect(c.children.map((e) => e.id), ['a', 'b']);
    });

    test('ProviderCard et ProviderDetail', () {
      final json = {
        'id': 'p',
        'full_name': 'Bika Services',
        'headline': 'Plombier',
        'rating_avg': 4.8,
        'rating_count': 23,
        'distance_km': 2.3,
        'eta_min': 8,
        'min_price': 5000,
        'is_online': true,
        'skills': ['Plomberie', 'Dépannage'],
        'bio': 'Plombier depuis 5 ans',
        'available_days': [1, 2, 3, 4, 5, 6],
        'reviews': [
          {
            'id': 'r',
            'job_id': 'j',
            'author': {'id': 'a', 'full_name': 'Aminata D.'},
            'rating': 5,
            'comment': 'Très professionnel',
          },
        ],
        'is_followed': true,
      };
      final d = ProviderDetail.fromJson(json);
      expect(d.card.minPrice, 5000);
      expect(d.card.skills, ['Plomberie', 'Dépannage']);
      expect(d.skills.map((s) => s.name), ['Plomberie', 'Dépannage']);
      expect(d.reviews.single.author.fullName, 'Aminata D.');
      expect(d.isFollowed, isTrue);
    });

    test('Job, statuts et routage', () {
      final j = Job.fromJson({
        'id': 'j1',
        'client': {'id': 'c', 'full_name': 'Client'},
        'provider': {'id': 'p', 'full_name': 'Bika', 'lat': 3.86, 'lng': 11.51},
        'category': {'id': 'cat', 'name': 'Plomberie', 'icon': 'plumbing'},
        'title': 'Plomberie - Réparation fuite',
        'budget': 5000,
        'price': 5000,
        'service_fee': 250,
        'total': 5250,
        'provider_payout': 5000,
        'status': 'funded',
        'payment_status': 'held',
        'urgency': 'now',
        'review': null,
      });
      expect(j.total, 5250);
      expect(j.isLive, isTrue);
      expect(j.provider!.lat, 3.86);
      expect(JobStatus.label(j.status), 'Payée');
      expect(jobRouteFor(j, asProvider: false), '/jobs/j1/track');
      expect(jobRouteFor(j, asProvider: true), '/provider-mode/mission/j1');
      expect(JobStatus.nextProviderStatus('funded'), 'en_route');
      expect(JobStatus.nextProviderStatus('in_progress'), 'done');
      expect(JobStatus.trackingStep('arrived'), 1);
    });

    test('Transaction, paiement et gains', () {
      final r = PaymentResult.fromJson({
        'transaction': {
          'id': 't',
          'type': 'escrow_in',
          'amount': 5250,
          'method': 'mtn_momo',
          'status': 'pending',
        },
        'checkout_url': null,
      });
      expect(r.transaction.isPending, isTrue);
      expect(r.checkoutUrl, isNull);
      final e = Earnings.fromJson({'balance_held': 5000, 'total_earned': 20000, 'items': []});
      expect(e.balanceHeld, 5000);
      expect(e.monthEarned, 0);
    });

    test('Message, Conversation et Notification', () {
      final c = Conversation.fromJson({
        'id': 'cv',
        'other_user': {'id': 'u', 'full_name': 'Bika', 'is_online': true},
        'last_message': {
          'id': 'm',
          'conversation_id': 'cv',
          'sender_id': 'u',
          'type': 'location',
          'lat': 3.8,
          'lng': 11.5,
        },
        'unread_count': 2,
      });
      expect(c.otherUser.isOnline, isTrue);
      expect(c.lastMessage!.isLocation, isTrue);
      expect(c.unreadCount, 2);
      final n = AppNotification.fromJson({
        'id': 'n',
        'type': 'job',
        'title': 'Nouveau job disponible',
        'data': {'job_id': 'j1'},
      });
      expect(n.jobId, 'j1');
      expect(n.isRead, isFalse);
    });
  });
}
