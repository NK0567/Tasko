import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/category.dart';
import '../../widgets/category_tile.dart';
import '../../widgets/common.dart';
import '../../widgets/illustrations.dart';
import '../../widgets/provider_tile.dart';
import '../../widgets/tasko_logo.dart';
import '../../widgets/ux.dart';
import 'home_providers.dart';
import 'shell_widgets.dart';

/// Écran 3 — Accueil client.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final categories = ref.watch(categoriesProvider);
    final recommended = ref.watch(recommendedProvidersProvider);

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          color: TaskoColors.primary,
          onRefresh: () async {
            ref.invalidate(categoriesProvider);
            ref.invalidate(recommendedProvidersProvider);
            await ref.read(categoriesProvider.future).catchError((_) => <Category>[]);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              Row(
                children: [
                  const MenuButton(),
                  const TaskoLogo(size: 30),
                  const Spacer(),
                  const CitySelector(),
                  const NotificationBell(),
                ],
              ),
              const SizedBox(height: 12),
              _SearchBar(onSubmit: (q) => context.push('/explore?q=${Uri.encodeQueryComponent(q)}')),
              const SizedBox(height: 16),
              _Banner(onDiscover: () => context.push('/explore')),
              const SizedBox(height: 14),
              const TipBanner(
                id: 'client.request',
                text: 'Besoin d’aide ? Touchez le bouton vert + en bas pour demander un service en 30 secondes.',
              ),
              _EmergencyButton(onTap: () => context.push('/jobs/new?urgency=now')),
              const SizedBox(height: 20),
              SectionHeader(
                title: 'Catégories de services',
                action: 'Tout voir',
                onAction: () => context.push('/categories'),
              ),
              const SizedBox(height: 8),
              categories.when(
                data: (list) => list.isEmpty
                    ? const EmptyView(
                        compact: true,
                        title: 'Aucune catégorie pour le moment',
                        message: 'Les services seront bientôt disponibles.',
                      )
                    : CategoryGrid(categories: list, max: 11, showOther: true),
                loading: () => const SizedBox(height: 160, child: LoadingView()),
                error: (e, _) => ErrorView(
                  compact: true,
                  error: e,
                  onRetry: () => ref.invalidate(categoriesProvider),
                ),
              ),
              const SizedBox(height: 16),
              SectionHeader(
                title: 'Prestataires recommandés à proximité',
                action: 'Carte',
                onAction: () => context.push('/explore'),
              ),
              const SizedBox(height: 8),
              recommended.when(
                data: (list) => list.isEmpty
                    ? const EmptyView(
                        compact: true,
                        title: 'Aucun prestataire à proximité',
                        message: 'Publiez une demande : les prestataires proches seront alertés.',
                      )
                    : Column(
                        children: [
                          for (final p in list)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: ProviderTile(
                                provider: p,
                                onTap: () => context.push('/provider/${p.id}'),
                              ),
                            ),
                        ],
                      ),
                loading: () => const SizedBox(height: 120, child: LoadingView()),
                error: (e, _) => ErrorView(
                  compact: true,
                  error: e,
                  onRetry: () => ref.invalidate(recommendedProvidersProvider),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Grille de catégories dynamiques (4 colonnes).
class CategoryGrid extends StatelessWidget {
  const CategoryGrid({super.key, required this.categories, this.max, this.showOther = false});
  final List<Category> categories;
  final int? max;
  final bool showOther;

  @override
  Widget build(BuildContext context) {
    final regular = categories.where((c) => !isOtherCategory(c)).toList();
    final shown = max == null ? regular : regular.take(max!).toList();
    final other = otherCategoryOf(categories) ??
        const Category(id: 'other', name: 'Autre service', icon: 'more_horiz', color: '#6B7A72');
    final tiles = <Widget>[
      for (final c in shown)
        CategoryTile(category: c, onTap: () => context.push('/categories/${c.id}')),
      if (showOther)
        CategoryTile(category: other, onTap: () => context.push('/jobs/new?other=1')),
    ];
    return LayoutBuilder(builder: (context, c) {
      final cols = c.maxWidth > 600 ? 6 : 4;
      return GridView.count(
        crossAxisCount: cols,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 6,
        crossAxisSpacing: 6,
        childAspectRatio: 0.78,
        children: tiles,
      );
    });
  }
}

class _SearchBar extends StatefulWidget {
  const _SearchBar({required this.onSubmit});
  final ValueChanged<String> onSubmit;

  @override
  State<_SearchBar> createState() => _SearchBarState();
}

class _SearchBarState extends State<_SearchBar> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      textInputAction: TextInputAction.search,
      onSubmitted: (v) {
        widget.onSubmit(v.trim());
        _controller.clear();
      },
      decoration: InputDecoration(
        hintText: 'Rechercher un service, un job…',
        prefixIcon: const Icon(Icons.search, color: TaskoColors.textMuted),
        suffixIcon: IconButton(
          tooltip: 'Voir la carte',
          icon: const Icon(Icons.map_outlined, color: TaskoColors.primary),
          onPressed: () => widget.onSubmit(_controller.text.trim()),
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(28),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(28),
          borderSide: const BorderSide(color: TaskoColors.border),
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.onDiscover});
  final VoidCallback onDiscover;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 150,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(TaskoRadius.card),
        gradient: const LinearGradient(
          colors: [TaskoColors.primaryDark, TaskoColors.primary],
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned(
            right: -10,
            bottom: -6,
            top: 0,
            child: Opacity(
              opacity: 0.95,
              child: Illustrations.svg(Illustrations.provider, width: 150, fit: BoxFit.cover),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 150, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Trouvez des prestataires fiables pour tous vos besoins',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    height: 1.3,
                  ),
                ),
                const Spacer(),
                ElevatedButton(
                  onPressed: onDiscover,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: TaskoColors.accent,
                    foregroundColor: TaskoColors.primaryDark,
                    minimumSize: const Size(0, 36),
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                  ),
                  child: const Text('Découvrir', style: TextStyle(fontSize: 13)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EmergencyButton extends StatelessWidget {
  const _EmergencyButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFFFF1F0),
      borderRadius: BorderRadius.circular(TaskoRadius.card),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(TaskoRadius.card),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(TaskoRadius.card),
            border: Border.all(color: const Color(0xFFFFCDC9)),
          ),
          child: const Row(
            children: [
              Icon(Icons.campaign_rounded, color: TaskoColors.danger, size: 26),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "Trouver quelqu'un maintenant",
                      style: TextStyle(fontWeight: FontWeight.w700, color: TaskoColors.danger),
                    ),
                    Text(
                      'Urgence : les prestataires en ligne autour de vous sont alertés',
                      style: TextStyle(fontSize: 12, color: TaskoColors.textMuted),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: TaskoColors.danger),
            ],
          ),
        ),
      ),
    );
  }
}

/// « Tout voir » : toutes les catégories et leurs sous-services.
class CategoriesScreen extends ConsumerWidget {
  const CategoriesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final categories = ref.watch(categoriesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Toutes les catégories')),
      body: AsyncView(
        value: categories,
        onRetry: () => ref.invalidate(categoriesProvider),
        data: (list) => list.isEmpty
            ? const EmptyView(title: 'Aucune catégorie disponible')
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  CategoryGrid(categories: list, showOther: true),
                ],
              ),
      ),
    );
  }
}
