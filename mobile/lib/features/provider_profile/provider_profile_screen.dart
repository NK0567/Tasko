import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../../core/formatters.dart';
import '../../core/icon_map.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/provider_card.dart';
import '../../models/review.dart';
import '../../models/user.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/tasko_button.dart';
import '../chat/chat_actions.dart';
import '../menu/menu_screens.dart';

final providerDetailProvider =
    FutureProvider.autoDispose.family<ProviderDetail, String>((ref, id) async {
  final pos = await ref.watch(positionProvider.future);
  return ref.watch(apiProvider).provider(id, lat: pos.lat, lng: pos.lng);
});

/// Écrans 5 / 9 / 10 — Détail d'un prestataire (et de ses services).
/// La présentation s'adapte au type : étudiant / débrouillard → « Ce que je propose ».
class ProviderProfileScreen extends ConsumerStatefulWidget {
  const ProviderProfileScreen({super.key, required this.providerId});
  final String providerId;

  @override
  ConsumerState<ProviderProfileScreen> createState() => _ProviderProfileScreenState();
}

class _ProviderProfileScreenState extends ConsumerState<ProviderProfileScreen> {
  bool? _followed;
  bool _following = false;

  Future<void> _toggleFollow() async {
    setState(() => _following = true);
    try {
      final v = await ref.read(apiProvider).toggleFollow(widget.providerId);
      setState(() => _followed = v);
      if (mounted) {
        showSnack(context, v ? 'Ajouté à vos favoris.' : 'Retiré de vos favoris.');
      }
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _following = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = ref.watch(providerDetailProvider(widget.providerId));
    final myId = ref.watch(authProvider).user?.id;
    return Scaffold(
      body: AsyncView(
        value: detail,
        onRetry: () => ref.invalidate(providerDetailProvider(widget.providerId)),
        data: (d) => _buildContent(context, d, isMe: d.card.id == myId),
      ),
      bottomNavigationBar: detail.whenOrNull(
        data: (d) => d.card.id == myId ? null : _BookBar(detail: d),
      ),
    );
  }

  Widget _buildContent(BuildContext context, ProviderDetail d, {required bool isMe}) {
    final p = d.card;
    final followed = _followed ?? d.isFollowed;
    final informal = p.providerType == 'student' || p.providerType == 'freelancer';
    final firstSkillIcon = d.skills.isNotEmpty ? d.skills.first.icon : null;

    return CustomScrollView(
      slivers: [
        SliverAppBar(
          pinned: true,
          expandedHeight: 170,
          backgroundColor: TaskoColors.primaryDark,
          foregroundColor: Colors.white,
          leading: Padding(
            padding: const EdgeInsets.all(6),
            child: CircleAvatar(
              backgroundColor: Colors.white,
              child: IconButton(
                tooltip: 'Retour',
                icon: const Icon(Icons.arrow_back, color: TaskoColors.primaryDark, size: 20),
                onPressed: () => context.pop(),
              ),
            ),
          ),
          actions: [
            if (!isMe)
              Padding(
                padding: const EdgeInsets.all(6),
                child: CircleAvatar(
                  backgroundColor: Colors.white,
                  child: IconButton(
                    tooltip: followed ? 'Ne plus suivre' : 'Suivre',
                    icon: Icon(
                      followed ? Icons.favorite : Icons.favorite_border,
                      color: TaskoColors.danger,
                      size: 20,
                    ),
                    onPressed: _following ? null : _toggleFollow,
                  ),
                ),
              ),
          ],
          flexibleSpace: FlexibleSpaceBar(
            background: _HeaderBackground(
              icon: firstSkillIcon,
              imageUrl: d.portfolio.isNotEmpty ? d.portfolio.first.imageUrl : null,
            ),
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TaskoAvatar(
                      name: p.fullName,
                      url: p.avatarUrl,
                      size: 72,
                      online: p.isOnline,
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  p.fullName,
                                  style: const TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w700,
                                    color: TaskoColors.primaryDark,
                                  ),
                                ),
                              ),
                              if (p.verificationLevel >= 3) ...[
                                const SizedBox(width: 6),
                                const Icon(Icons.verified, color: TaskoColors.info, size: 20),
                              ],
                            ],
                          ),
                          Text(
                            p.headline.isEmpty ? providerTypeLabel(p.providerType) : p.headline,
                            style: const TextStyle(color: TaskoColors.textMuted),
                          ),
                          const SizedBox(height: 4),
                          Wrap(
                            spacing: 12,
                            runSpacing: 4,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              RatingLabel(rating: p.ratingAvg, count: p.ratingCount),
                              if (p.distanceKm != null)
                                Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.place_outlined,
                                        size: 16, color: TaskoColors.textMuted),
                                    Text(formatDistance(p.distanceKm),
                                        style: const TextStyle(fontSize: 13)),
                                  ],
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                _Stats(detail: d),
                if (!isMe) ...[
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: TaskoButton(
                          label: 'Contacter',
                          icon: Icons.chat_bubble_outline,
                          height: 46,
                          onPressed: () => openChatWith(context, ref, userId: p.id),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TaskoButton(
                          label: followed ? 'Suivi' : 'Suivre',
                          variant: TaskoButtonVariant.outline,
                          height: 46,
                          loading: _following,
                          onPressed: _toggleFollow,
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 22),
                const SectionHeader(title: 'À propos'),
                const SizedBox(height: 4),
                Text(
                  d.bio.isEmpty ? 'Ce prestataire n’a pas encore rédigé de présentation.' : d.bio,
                  style: const TextStyle(height: 1.5),
                ),
                if (d.yearsExperience > 0) ...[
                  const SizedBox(height: 6),
                  Text(
                    '${providerTypeLabel(p.providerType)} · ${d.yearsExperience} an${d.yearsExperience > 1 ? 's' : ''} d’expérience',
                    style: const TextStyle(color: TaskoColors.textMuted, fontSize: 13),
                  ),
                ],
                const SizedBox(height: 20),
                SectionHeader(title: informal ? 'Ce que je propose' : 'Services proposés'),
                const SizedBox(height: 8),
                if (d.skills.isEmpty && p.skills.isEmpty)
                  const Text('Aucun service renseigné.',
                      style: TextStyle(color: TaskoColors.textMuted))
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (d.skills.isNotEmpty)
                        for (final s in d.skills)
                          TaskoChip(
                            label: s.basePrice > 0 ? '${s.name} · ${formatMoney(s.basePrice)}' : s.name,
                            icon: s.icon == null ? null : iconForKey(s.icon),
                          )
                      else
                        for (final s in p.skills) TaskoChip(label: s),
                    ],
                  ),
                const SizedBox(height: 20),
                SectionHeader(title: informal ? 'Mes disponibilités' : 'Disponibilités'),
                const SizedBox(height: 8),
                AvailabilityRow(days: d.availableDays),
                const SizedBox(height: 20),
                SectionHeader(
                  title: 'Mes réalisations',
                  action: d.portfolio.isEmpty ? null : '${d.portfolio.length} réalisation(s)',
                ),
                const SizedBox(height: 8),
                if (d.portfolio.isEmpty)
                  Text(
                    '${p.missionsCompleted} mission(s) réalisée(s) sur Tasko.',
                    style: const TextStyle(color: TaskoColors.textMuted),
                  )
                else
                  PortfolioStrip(items: d.portfolio),
                const SizedBox(height: 20),
                SectionHeader(
                  title: 'Avis clients',
                  action: 'Voir tout',
                  onAction: () => context.push('/provider/${p.id}/reviews'),
                ),
                const SizedBox(height: 8),
                if (d.reviews.isEmpty)
                  const Text('Pas encore d’avis.', style: TextStyle(color: TaskoColors.textMuted))
                else
                  for (final r in d.reviews.take(3))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: ReviewCard(review: r),
                    ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _HeaderBackground extends StatelessWidget {
  const _HeaderBackground({this.icon, this.imageUrl});
  final String? icon;
  final String? imageUrl;

  @override
  Widget build(BuildContext context) {
    final url = AppConfig.mediaUrl(imageUrl);
    final gradient = Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [TaskoColors.primaryDark, TaskoColors.primary, TaskoColors.primaryLight],
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            right: -20,
            bottom: -30,
            child: Icon(iconForKey(icon), size: 190, color: Colors.white.withValues(alpha: 0.12)),
          ),
          Positioned(
            left: 30,
            top: 50,
            child: Icon(Icons.location_on, size: 60, color: TaskoColors.accent.withValues(alpha: 0.25)),
          ),
        ],
      ),
    );
    if (url == null) return gradient;
    return Stack(
      fit: StackFit.expand,
      children: [
        CachedNetworkImage(
          imageUrl: url,
          fit: BoxFit.cover,
          errorWidget: (_, _, _) => gradient,
          placeholder: (_, _) => gradient,
        ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Colors.black26, Colors.transparent],
            ),
          ),
        ),
      ],
    );
  }
}

class _Stats extends StatelessWidget {
  const _Stats({required this.detail});
  final ProviderDetail detail;

  @override
  Widget build(BuildContext context) {
    final p = detail.card;
    Widget stat(String value, String label) => Expanded(
          child: Column(
            children: [
              Text(value,
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 16, color: TaskoColors.primaryDark)),
              Text(label, style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted)),
            ],
          ),
        );
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: TaskoColors.chip,
        borderRadius: BorderRadius.circular(TaskoRadius.card),
      ),
      child: Row(
        children: [
          stat('${p.missionsCompleted}', 'Missions'),
          stat(formatRating(p.ratingAvg), 'Note'),
          stat(p.etaMin == null ? '—' : '${p.etaMin} min', 'Arrivée'),
          stat('Niv. ${p.verificationLevel}', 'Vérification'),
        ],
      ),
    );
  }
}

/// Pastilles L M M J V S D (0 = dimanche … 6 = samedi).
class AvailabilityRow extends StatelessWidget {
  const AvailabilityRow({super.key, required this.days, this.onToggle});
  final List<int> days;
  final ValueChanged<int>? onToggle;

  static const order = [1, 2, 3, 4, 5, 6, 0];
  static const labels = {1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven', 6: 'Sam', 0: 'Dim'};

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now().weekday % 7;
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        for (final d in order)
          InkWell(
            borderRadius: BorderRadius.circular(20),
            onTap: onToggle == null ? null : () => onToggle!(d),
            child: Padding(
              padding: const EdgeInsets.all(4),
              child: Column(
                children: [
                  Text(
                    labels[d]!,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: d == today ? FontWeight.w700 : FontWeight.w400,
                      color: d == today ? TaskoColors.primary : TaskoColors.textMuted,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: days.contains(d) ? TaskoColors.primary : Colors.white,
                      border: Border.all(
                        color: days.contains(d) ? TaskoColors.primary : TaskoColors.border,
                        width: 2,
                      ),
                    ),
                    child: days.contains(d)
                        ? const Icon(Icons.check, size: 13, color: Colors.white)
                        : null,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// Bande horizontale « Mes réalisations ».
class PortfolioStrip extends StatelessWidget {
  const PortfolioStrip({super.key, required this.items});
  final List<PortfolioItem> items;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 130,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (_, i) {
          final it = items[i];
          final url = AppConfig.mediaUrl(it.imageUrl);
          return SizedBox(
            width: 130,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    width: 130,
                    height: 100,
                    color: TaskoColors.chip,
                    child: url == null
                        ? const Icon(Icons.photo_outlined, color: TaskoColors.primary)
                        : CachedNetworkImage(
                            imageUrl: url,
                            fit: BoxFit.cover,
                            errorWidget: (_, _, _) =>
                                const Icon(Icons.broken_image_outlined, color: TaskoColors.textMuted),
                          ),
                  ),
                ),
                const SizedBox(height: 4),
                Text(it.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12)),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _BookBar extends StatelessWidget {
  const _BookBar({required this.detail});
  final ProviderDetail detail;

  @override
  Widget build(BuildContext context) {
    final p = detail.card;
    final price = p.minPrice ??
        (detail.skills.isEmpty
            ? null
            : detail.skills.map((s) => s.basePrice).reduce((a, b) => a < b ? a : b));
    final categoryId = detail.skills.isNotEmpty ? detail.skills.first.categoryId : null;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: TaskoColors.border)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('À partir de',
                      style: TextStyle(fontSize: 12, color: TaskoColors.textMuted)),
                  price == null || price == 0
                      ? const Text('Sur devis', style: TextStyle(fontWeight: FontWeight.w700))
                      : MoneyText(price,
                          style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 20,
                              color: TaskoColors.primaryDark)),
                ],
              ),
            ),
            SizedBox(
              width: 170,
              child: TaskoButton(
                label: 'Réserver',
                icon: Icons.event_available,
                onPressed: () {
                  final q = StringBuffer('/jobs/new?provider_id=${p.id}');
                  if (categoryId != null && categoryId.isNotEmpty) {
                    q.write('&category_id=$categoryId');
                  }
                  q.write('&provider_name=${Uri.encodeQueryComponent(p.fullName)}');
                  context.push(q.toString());
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// « Voir tout » : liste paginée des avis.
class ProviderReviewsScreen extends ConsumerStatefulWidget {
  const ProviderReviewsScreen({super.key, required this.providerId});
  final String providerId;

  @override
  ConsumerState<ProviderReviewsScreen> createState() => _ProviderReviewsScreenState();
}

class _ProviderReviewsScreenState extends ConsumerState<ProviderReviewsScreen> {
  final List<Review> _items = [];
  int _page = 1;
  bool _loading = false;
  bool _done = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _loadMore();
  }

  Future<void> _loadMore() async {
    if (_loading || _done) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await ref.read(apiProvider).providerReviews(widget.providerId, page: _page);
      setState(() {
        _items.addAll(list);
        _page++;
        _done = list.length < 20;
      });
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget body;
    if (_items.isEmpty && _loading) {
      body = const LoadingView();
    } else if (_items.isEmpty && _error != null) {
      body = ErrorView(error: _error!, onRetry: _loadMore);
    } else if (_items.isEmpty) {
      body = const EmptyView(title: 'Pas encore d’avis');
    } else {
      body = NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.pixels > n.metrics.maxScrollExtent - 200) _loadMore();
          return false;
        },
        child: ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: _items.length + (_done ? 0 : 1),
          separatorBuilder: (_, _) => const SizedBox(height: 8),
          itemBuilder: (_, i) => i >= _items.length
              ? const Padding(padding: EdgeInsets.all(12), child: LoadingView())
              : ReviewCard(review: _items[i]),
        ),
      );
    }
    return Scaffold(appBar: AppBar(title: const Text('Avis clients')), body: body);
  }
}
