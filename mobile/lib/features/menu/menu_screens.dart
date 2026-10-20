import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../models/provider_card.dart';
import '../../models/review.dart';
import '../../models/transaction.dart';
import '../../widgets/cameroon_flag.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/illustrations.dart';
import '../../widgets/provider_tile.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/tasko_logo.dart';

// ---------------------------------------------------------------------------
// 16 — À propos / Vision
// ---------------------------------------------------------------------------

class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  static const _targets = [
    (Icons.person_outline, 'Particuliers', 'Besoin d’aide'),
    (Icons.school_outlined, 'Jeunes', 'Compétences & jobs'),
    (Icons.handyman_outlined, 'Artisans', 'Savoir-faire'),
    (Icons.apartment_outlined, 'Entreprises', 'Services & équipes'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: TaskoColors.primaryDark,
      appBar: AppBar(
        backgroundColor: TaskoColors.primaryDark,
        foregroundColor: Colors.white,
        title: const Text('À propos', style: TextStyle(color: Colors.white)),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              children: [
                Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(24),
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [TaskoColors.primary, TaskoColors.primaryDark],
                    ),
                    border: Border.all(color: Colors.white12),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 24, 20, 8),
                        child: Row(
                          children: [
                            const Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  TaskoLogo(size: 40, textColor: Colors.white),
                                  SizedBox(height: 18),
                                  Text(
                                    'Plus qu’une application, une opportunité pour tous !',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w700,
                                      fontSize: 20,
                                      height: 1.3,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Illustrations.svg(Illustrations.provider, width: 110),
                          ],
                        ),
                      ),
                      Container(
                        margin: const EdgeInsets.all(16),
                        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(TaskoRadius.card),
                        ),
                        child: Row(
                          children: [
                            for (final t in _targets)
                              Expanded(
                                child: Column(
                                  children: [
                                    Icon(t.$1, color: TaskoColors.primary, size: 28),
                                    const SizedBox(height: 6),
                                    Text(
                                      t.$2,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                        fontSize: 12,
                                      ),
                                    ),
                                    Text(
                                      t.$3,
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                        fontSize: 10,
                                        color: TaskoColors.textMuted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),
                      Container(
                        margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
                        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
                        decoration: BoxDecoration(
                          color: TaskoColors.primaryLight,
                          borderRadius: BorderRadius.circular(TaskoRadius.button),
                        ),
                        child: const Center(
                          child: Text(
                            'Ensemble, facilitons le quotidien !',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                const _VisionBlock(
                  icon: Icons.flag_outlined,
                  title: 'Notre mission',
                  body:
                      'Tasko est le « Yango des petits jobs » : en quelques secondes, trouvez près de chez vous '
                      'un prestataire fiable — plombier, coiffeuse, répétiteur, livreur, informaticien… — '
                      'suivez-le en temps réel et payez en toute sécurité par Mobile Money.',
                ),
                const _VisionBlock(
                  icon: Icons.trending_up,
                  title: 'Des revenus pour tous',
                  body:
                      'Étudiants, artisans, débrouillards et entreprises valorisent leurs compétences et '
                      'reçoivent des missions autour d’eux, avec un paiement garanti.',
                ),
                const _VisionBlock(
                  icon: Icons.verified_user_outlined,
                  title: 'La confiance d’abord',
                  body:
                      'Argent bloqué en sécurité chez Tasko jusqu’à la fin, avis vérifiés, niveaux de vérification '
                      'des prestataires et médiation en cas de litige.',
                ),
                const SizedBox(height: 12),
                const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'Tasko · version 2.0.0 · Fait au Cameroun',
                      style: TextStyle(color: Colors.white70, fontSize: 12.5),
                    ),
                    SizedBox(width: 6),
                    CameroonFlag(width: 20),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _VisionBlock extends StatelessWidget {
  const _VisionBlock({required this.icon, required this.title, required this.body});
  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: TaskoColors.accent),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 4),
                Text(body, style: const TextStyle(color: Colors.white70, height: 1.45)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late final TextEditingController _name;
  late final TextEditingController _email;
  late final TextEditingController _city;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final u = ref.read(authProvider).user;
    _name = TextEditingController(text: u?.fullName ?? '');
    _email = TextEditingController(text: u?.email ?? '');
    _city = TextEditingController(text: u?.city ?? '');
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _city.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final user = await ref.read(apiProvider).updateMe(
            fullName: _name.text.trim(),
            email: _email.text.trim().isEmpty ? null : _email.text.trim(),
            city: _city.text.trim().isEmpty ? null : _city.text.trim(),
          );
      ref.read(authProvider.notifier).setUser(user);
      if (mounted) showSnack(context, 'Profil mis à jour.');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    return Scaffold(
      appBar: AppBar(title: const Text('Paramètres')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const SectionHeader(title: 'Informations personnelles'),
          const SizedBox(height: 10),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Nom complet'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'E-mail (optionnel)'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _city,
            decoration: const InputDecoration(labelText: 'Ville'),
          ),
          const SizedBox(height: 12),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.phone_outlined),
            title: const Text('Téléphone'),
            subtitle: Text(user?.phone ?? ''),
          ),
          const SizedBox(height: 8),
          TaskoButton(label: 'Enregistrer', loading: _saving, onPressed: _save),
          const SizedBox(height: 24),
          const SectionHeader(title: 'Mode prestataire'),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.badge_outlined),
            title: const Text('Mon profil prestataire'),
            subtitle: Text(user?.isProvider == true ? 'Activé' : 'Non configuré'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/provider-mode/setup'),
          ),
          if (user?.isProvider == true)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.handyman_outlined),
              title: const Text('Ce que je sais faire'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/provider-mode/skills'),
            ),
          const SizedBox(height: 24),
          TaskoButton(
            label: 'Se déconnecter',
            variant: TaskoButtonVariant.danger,
            icon: Icons.logout,
            onPressed: () {
              ref.read(authProvider.notifier).logout();
              context.go('/');
            },
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Aide
// ---------------------------------------------------------------------------


class HelpScreen extends ConsumerWidget {
  const HelpScreen({super.key});

  static const _faq = [
    (
      'Comment fonctionne le paiement ?',
      'Vous payez par MTN MoMo, Orange Money ou carte. L’argent reste bloqué en sécurité chez Tasko '
          'et n’est versé au prestataire qu’après votre validation du job.'
    ),
    (
      'À quoi sert le code à 4 chiffres ?',
      'Après le paiement, vous recevez un code de démarrage. Donnez-le au prestataire seulement quand il '
          'est chez vous : il en a besoin pour commencer. Cela prouve qu’il est bien venu.'
    ),
    (
      'Que se passe-t-il si je ne valide pas ?',
      'Quand le prestataire a terminé, vous avez 48 h pour vérifier. Sans réponse de votre part, '
          'le paiement lui est versé automatiquement. En cas de problème, signalez-le avant.'
    ),
    (
      'Que se passe-t-il si le job se passe mal ?',
      'Touchez « Signaler un problème ». Un salon s’ouvre entre vous, le prestataire et un médiateur Tasko. '
          'L’argent reste bloqué chez Tasko : ni le client ni le prestataire ne peuvent le récupérer seuls. '
          'Le médiateur décide ou vous trouvez un accord.'
    ),
    (
      'Et si le prestataire ne vient pas ?',
      'Passé l’heure limite d’arrivée, touchez « Le prestataire n’est pas venu ». Il a 12 h pour répondre, '
          'sinon vous êtes remboursé automatiquement.'
    ),
    (
      'Prestataire : suis-je sûr d’être payé ?',
      'Oui. Ne partez que lorsque l’application affiche « X FCFA sécurisés par Tasko » : l’argent du '
          'client est déjà bloqué chez Tasko et vous sera versé à la fin.'
    ),
    (
      'Comment devenir prestataire ?',
      'Ouvrez le menu, activez « Mode Prestataire », remplissez votre profil et choisissez ce que vous '
          'savez faire. Passez en ligne pour recevoir des missions.'
    ),
    (
      'Quels sont les frais ?',
      'Des frais de service (5 % par défaut) sont ajoutés au prix de la mission côté client.'
    ),
    (
      'Puis-je annuler une demande ?',
      'Avant le paiement : gratuit. Après le paiement et avant le départ du prestataire : remboursé en '
          'entier. Prestataire en route : des frais de déplacement lui sont versés. Une fois sur place, '
          'l’annulation n’est plus possible : signalez un problème.'
    ),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final support = ref.watch(settingsValueProvider).supportPhone;
    return Scaffold(
      appBar: AppBar(title: const Text('Aide')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TaskoCard(
            color: TaskoColors.chip,
            child: Row(
              children: [
                const Icon(Icons.support_agent, color: TaskoColors.primary, size: 36),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Une question ? Notre équipe vous répond 7j/7.',
                    style: TextStyle(fontWeight: FontWeight.w500),
                  ),
                ),
                if (support != null)
                  IconButton.filled(
                    style: IconButton.styleFrom(backgroundColor: TaskoColors.primary),
                    icon: const Icon(Icons.call, color: Colors.white),
                    onPressed: () => launchUrl(Uri.parse('tel:$support')),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const SectionHeader(title: 'Questions fréquentes'),
          for (final q in _faq)
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: Text(q.$1, style: const TextStyle(fontWeight: FontWeight.w500)),
              childrenPadding: const EdgeInsets.only(bottom: 12),
              children: [Text(q.$2, style: const TextStyle(color: TaskoColors.textMuted))],
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Mes paiements
// ---------------------------------------------------------------------------

final _clientPaymentsProvider = FutureProvider.autoDispose<List<Job>>((ref) async {
  final api = ref.watch(apiProvider);
  final results = await Future.wait([
    api.jobs(as: 'client', status: 'active'),
    api.jobs(as: 'client', status: 'history'),
  ]);
  final all = [...results[0], ...results[1]]
      .where((j) => j.paymentStatus != 'unpaid')
      .toList()
    ..sort((a, b) => (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
  return all;
});

final _earningsProvider =
    FutureProvider.autoDispose<Earnings>((ref) => ref.watch(apiProvider).earnings());

class PaymentsScreen extends ConsumerWidget {
  const PaymentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isProvider = ref.watch(authProvider).user?.isProvider ?? false;
    final clientList = _ClientPayments(value: ref.watch(_clientPaymentsProvider));
    if (!isProvider) {
      return Scaffold(appBar: AppBar(title: const Text('Mes paiements')), body: clientList);
    }
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Mes paiements'),
          bottom: const TabBar(tabs: [Tab(text: 'Payés'), Tab(text: 'Reçus')]),
        ),
        body: TabBarView(
          children: [
            clientList,
            AsyncView(
              value: ref.watch(_earningsProvider),
              onRetry: () => ref.invalidate(_earningsProvider),
              data: (e) => e.items.isEmpty
                  ? const EmptyView(title: 'Aucun versement pour le moment')
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: e.items.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (_, i) => TransactionTile(tx: e.items[i]),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ClientPayments extends ConsumerWidget {
  const _ClientPayments({required this.value});
  final AsyncValue<List<Job>> value;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AsyncView(
      value: value,
      onRetry: () => ref.invalidate(_clientPaymentsProvider),
      data: (jobs) => jobs.isEmpty
          ? const EmptyView(
              title: 'Aucun paiement',
              message: 'Vos paiements de missions apparaîtront ici.',
            )
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: jobs.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final j = jobs[i];
                return TaskoCard(
                  onTap: () => context.push('/jobs/${j.id}'),
                  child: Row(
                    children: [
                      CategoryIcon(icon: j.category.icon, size: 42),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(j.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                            Text(
                              '${PaymentStatus.label(j.paymentStatus)} · ${formatDate(j.createdAt)}',
                              style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted),
                            ),
                          ],
                        ),
                      ),
                      MoneyText(j.total),
                    ],
                  ),
                );
              },
            ),
    );
  }
}

class TransactionTile extends StatelessWidget {
  const TransactionTile({super.key, required this.tx});
  final Transaction tx;

  @override
  Widget build(BuildContext context) {
    final incoming = tx.isIncoming;
    return TaskoCard(
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: (incoming ? TaskoColors.primary : TaskoColors.accent)
                .withValues(alpha: 0.15),
            child: Icon(
              incoming ? Icons.south_west : Icons.north_east,
              color: incoming ? TaskoColors.primary : TaskoColors.warning,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(tx.typeLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
                Text(
                  '${PaymentMethod.label(tx.method)} · ${tx.statusLabel} · ${formatDate(tx.createdAt)}',
                  style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted),
                ),
              ],
            ),
          ),
          Text(
            '${incoming ? '+' : '−'}${formatMoney(tx.amount)}',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: incoming ? TaskoColors.primary : TaskoColors.text,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Mes avis
// ---------------------------------------------------------------------------

final _receivedReviewsProvider = FutureProvider.autoDispose<List<Review>>((ref) {
  final id = ref.watch(authProvider).user?.id;
  if (id == null) return Future.value(const <Review>[]);
  return ref.watch(apiProvider).providerReviews(id);
});

final _givenReviewsProvider = FutureProvider.autoDispose<List<Job>>((ref) async {
  final jobs = await ref.watch(apiProvider).jobs(as: 'client', status: 'history');
  return jobs.where((j) => j.review != null).toList();
});

class MyReviewsScreen extends ConsumerWidget {
  const MyReviewsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isProvider = ref.watch(authProvider).user?.isProvider ?? false;
    final given = AsyncView(
      value: ref.watch(_givenReviewsProvider),
      onRetry: () => ref.invalidate(_givenReviewsProvider),
      data: (jobs) => jobs.isEmpty
          ? const EmptyView(title: 'Aucun avis donné')
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: jobs.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final j = jobs[i];
                return TaskoCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(j.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                      if (j.provider != null)
                        Text(j.provider!.fullName,
                            style: const TextStyle(color: TaskoColors.textMuted, fontSize: 12)),
                      const SizedBox(height: 6),
                      RatingStars(rating: j.review!.rating.toDouble()),
                      if (j.review!.comment.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(j.review!.comment),
                      ],
                    ],
                  ),
                );
              },
            ),
    );
    if (!isProvider) {
      return Scaffold(appBar: AppBar(title: const Text('Mes avis')), body: given);
    }
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Mes avis'),
          bottom: const TabBar(tabs: [Tab(text: 'Reçus'), Tab(text: 'Donnés')]),
        ),
        body: TabBarView(
          children: [
            AsyncView(
              value: ref.watch(_receivedReviewsProvider),
              onRetry: () => ref.invalidate(_receivedReviewsProvider),
              data: (list) => list.isEmpty
                  ? const EmptyView(title: 'Aucun avis reçu pour le moment')
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: list.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (_, i) => ReviewCard(review: list[i]),
                    ),
            ),
            given,
          ],
        ),
      ),
    );
  }
}

class ReviewCard extends StatelessWidget {
  const ReviewCard({super.key, required this.review});
  final Review review;

  @override
  Widget build(BuildContext context) {
    return TaskoCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TaskoAvatar(name: review.author.fullName, url: review.author.avatarUrl, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        review.author.fullName,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    Text(
                      formatDate(review.createdAt),
                      style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted),
                    ),
                  ],
                ),
                RatingStars(rating: review.rating.toDouble(), size: 14),
                if (review.comment.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(review.comment, style: const TextStyle(fontSize: 13, height: 1.4)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Mes favoris
// ---------------------------------------------------------------------------

final _favoritesProvider =
    FutureProvider.autoDispose<List<ProviderCard>>((ref) => ref.watch(apiProvider).favorites());

class FavoritesScreen extends ConsumerWidget {
  const FavoritesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mes favoris')),
      body: AsyncView(
        value: ref.watch(_favoritesProvider),
        onRetry: () => ref.invalidate(_favoritesProvider),
        data: (list) => list.isEmpty
            ? const EmptyView(
                title: 'Aucun favori',
                message: 'Suivez des prestataires pour les retrouver ici.',
              )
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: list.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (_, i) => ProviderTile(
                  provider: list[i],
                  onTap: () => context.push('/provider/${list[i].id}'),
                ),
              ),
      ),
    );
  }
}
