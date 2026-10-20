import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../core/formatters.dart';
import '../../core/icon_map.dart';
import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/category.dart';
import '../../models/provider_card.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/map_widgets.dart';
import '../../widgets/provider_tile.dart';

/// Écran 4 — Carte des prestataires (et liste), filtrable par catégorie.
class ExploreScreen extends ConsumerStatefulWidget {
  const ExploreScreen({super.key, this.initialQuery, this.categoryId});

  final String? initialQuery;
  final String? categoryId;

  @override
  ConsumerState<ExploreScreen> createState() => _ExploreScreenState();
}

enum _Sort { score, distance, rating, price }

class _ExploreScreenState extends ConsumerState<ExploreScreen> {
  final _mapController = MapController();
  late final TextEditingController _search;
  Timer? _debounce;

  UserPosition? _position;
  List<ProviderCard> _items = const [];
  bool _loading = true;
  Object? _error;
  ProviderCard? _selected;
  bool _listMode = false;
  bool _onlineOnly = false;
  _Sort _sort = _Sort.score;
  String? _categoryId;
  String? _subCategoryId;

  @override
  void initState() {
    super.initState();
    _search = TextEditingController(text: widget.initialQuery ?? '');
    _categoryId = widget.categoryId;
    _init();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    _position = await ref.read(positionProvider.future).catchError(
          (_) => const UserPosition(LatLng(3.8480, 11.5021), isFallback: true),
        );
    await _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final pos = _position;
      final items = await ref.read(apiProvider).providers(
            lat: pos?.lat,
            lng: pos?.lng,
            categoryId: _subCategoryId ?? _categoryId,
            q: _search.text.trim(),
            sort: _sort.name,
            online: _onlineOnly ? true : null,
            limit: 50,
          );
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
        _selected = items.isEmpty ? null : items.first;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 450), _load);
  }

  void _setSort(_Sort s) {
    setState(() => _sort = _sort == s ? _Sort.score : s);
    _load();
  }

  Category? _findCategory(List<Category> all) {
    if (_categoryId == null) return null;
    for (final c in all) {
      if (c.id == _categoryId) return c;
      for (final child in c.children) {
        if (child.id == _categoryId) return c;
      }
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final categories = ref.watch(categoriesProvider).value ?? const <Category>[];
    final category = _findCategory(categories);
    final center = _position?.latLng ?? const LatLng(3.8480, 11.5021);

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: TextField(
          controller: _search,
          onChanged: _onSearchChanged,
          textInputAction: TextInputAction.search,
          onSubmitted: (_) => _load(),
          decoration: InputDecoration(
            isDense: true,
            hintText: category == null ? 'Rechercher un service…' : 'Rechercher dans ${category.name}',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _search.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Effacer la recherche',
                    icon: const Icon(Icons.close),
                    onPressed: () {
                      _search.clear();
                      _load();
                    },
                  ),
          ),
        ),
        actions: [
          IconButton(
            tooltip: _listMode ? 'Vue carte' : 'Vue liste',
            icon: Icon(_listMode ? Icons.map_outlined : Icons.view_list_rounded),
            onPressed: () => setState(() => _listMode = !_listMode),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: TaskoColors.primary,
        foregroundColor: Colors.white,
        onPressed: () {
          final cat = _subCategoryId ?? _categoryId;
          context.push(cat == null ? '/jobs/new' : '/jobs/new?category_id=$cat');
        },
        icon: const Icon(Icons.add_task),
        label: Text(category == null ? 'Publier une demande' : 'Demander ce service'),
      ),
      body: Column(
        children: [
          if (category != null)
            _CategoryHeader(
              category: category,
              selectedSub: _subCategoryId,
              onSelect: (id) {
                setState(() => _subCategoryId = id);
                _load();
              },
            ),
          SizedBox(
            height: 46,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              children: [
                TaskoChip(
                  label: 'À proximité',
                  icon: Icons.near_me_outlined,
                  selected: _sort == _Sort.distance,
                  onTap: () => _setSort(_Sort.distance),
                ),
                const SizedBox(width: 8),
                TaskoChip(
                  label: 'Note',
                  icon: Icons.star_outline_rounded,
                  selected: _sort == _Sort.rating,
                  onTap: () => _setSort(_Sort.rating),
                ),
                const SizedBox(width: 8),
                TaskoChip(
                  label: 'Prix',
                  icon: Icons.payments_outlined,
                  selected: _sort == _Sort.price,
                  onTap: () => _setSort(_Sort.price),
                ),
                const SizedBox(width: 8),
                TaskoChip(
                  label: 'En ligne',
                  icon: Icons.circle,
                  selected: _onlineOnly,
                  onTap: () {
                    setState(() => _onlineOnly = !_onlineOnly);
                    _load();
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: _listMode ? _buildList() : _buildMap(center),
          ),
        ],
      ),
    );
  }

  Widget _buildList() {
    if (_loading && _items.isEmpty) return const LoadingView();
    if (_error != null) return ErrorView(error: _error!, onRetry: _load);
    if (_items.isEmpty) {
      return const EmptyView(
        title: 'Aucun prestataire trouvé',
        message: 'Essayez un autre mot-clé ou publiez une demande.',
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 90),
        itemCount: _items.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, i) => ProviderTile(
          provider: _items[i],
          onTap: () => context.push('/provider/${_items[i].id}'),
        ),
      ),
    );
  }

  Widget _buildMap(LatLng center) {
    final markers = <Marker>[
      for (final p in _items.where((p) => p.lat != null && p.lng != null))
        Marker(
          point: LatLng(p.lat!, p.lng!),
          width: 56,
          height: 60,
          alignment: Alignment.topCenter,
          child: GestureDetector(
            onTap: () => setState(() => _selected = p),
            child: AvatarPin(
              name: p.fullName,
              url: p.avatarUrl,
              selected: _selected?.id == p.id,
              online: p.isOnline,
            ),
          ),
        ),
      Marker(point: center, width: 44, height: 44, child: const MyPositionDot()),
    ];
    return Stack(
      children: [
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(initialCenter: center, initialZoom: 13.5),
          children: [
            osmTileLayer(),
            MarkerLayer(markers: markers),
            osmAttribution(),
          ],
        ),
        if (_loading)
          const Positioned(
            top: 12,
            left: 0,
            right: 0,
            child: Center(
              child: Card(
                child: Padding(
                  padding: EdgeInsets.all(10),
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  ),
                ),
              ),
            ),
          ),
        Positioned(
          right: 12,
          top: 12,
          child: FloatingActionButton.small(
            heroTag: 'recenter',
            backgroundColor: Colors.white,
            foregroundColor: TaskoColors.primary,
            onPressed: () => _mapController.move(center, 14),
            child: const Icon(Icons.my_location),
          ),
        ),
        if (_error != null)
          Positioned(
            left: 16,
            right: 16,
            bottom: 84,
            child: TaskoCard(child: ErrorView(error: _error!, onRetry: _load, compact: true)),
          )
        else if (!_loading && _items.isEmpty)
          const Positioned(
            left: 16,
            right: 16,
            bottom: 84,
            child: TaskoCard(
              child: Text(
                'Aucun prestataire dans cette zone. Publiez une demande : '
                'les prestataires proches seront alertés.',
                textAlign: TextAlign.center,
              ),
            ),
          )
        else if (_selected != null)
          Positioned(
            left: 16,
            right: 16,
            bottom: 84,
            child: _ProviderSummaryCard(
              provider: _selected!,
              onOpen: () => context.push('/provider/${_selected!.id}'),
            ),
          ),
      ],
    );
  }
}

class _CategoryHeader extends StatelessWidget {
  const _CategoryHeader({required this.category, required this.selectedSub, required this.onSelect});
  final Category category;
  final String? selectedSub;
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) {
    final color = colorFromHex(category.color);
    return Container(
      color: color.withValues(alpha: 0.06),
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CategoryIcon(icon: category.icon, color: color, size: 40),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(category.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                    if ((category.description ?? '').isNotEmpty)
                      Text(
                        category.description!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted),
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (category.children.isNotEmpty) ...[
            const SizedBox(height: 8),
            SizedBox(
              height: 34,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  TaskoChip(
                    label: 'Tous',
                    color: color,
                    selected: selectedSub == null,
                    onTap: () => onSelect(null),
                  ),
                  for (final c in category.children) ...[
                    const SizedBox(width: 6),
                    TaskoChip(
                      label: c.name,
                      icon: iconForKey(c.icon),
                      color: color,
                      selected: selectedSub == c.id,
                      onTap: () => onSelect(c.id),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ProviderSummaryCard extends StatelessWidget {
  const _ProviderSummaryCard({required this.provider, required this.onOpen});
  final ProviderCard provider;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final p = provider;
    return Material(
      elevation: 8,
      shadowColor: Colors.black26,
      borderRadius: BorderRadius.circular(TaskoRadius.card),
      color: Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                TaskoAvatar(name: p.fullName, url: p.avatarUrl, size: 52, online: p.isOnline),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(p.fullName,
                          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                      Text(
                        p.headline.isEmpty ? 'Prestataire' : p.headline,
                        style: const TextStyle(color: TaskoColors.textMuted, fontSize: 13),
                      ),
                      RatingLabel(rating: p.ratingAvg, count: p.ratingCount, fontSize: 12),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    if (p.distanceKm != null)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.place, size: 14, color: TaskoColors.primary),
                          Text(formatDistance(p.distanceKm), style: const TextStyle(fontSize: 12)),
                        ],
                      ),
                    if (p.etaMin != null)
                      Text('~${p.etaMin} min',
                          style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: p.minPrice == null
                      ? const Text('Prix sur devis',
                          style: TextStyle(color: TaskoColors.textMuted))
                      : MoneyText(
                          p.minPrice,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 17,
                            color: TaskoColors.primaryDark,
                          ),
                        ),
                ),
                ElevatedButton(
                  onPressed: onOpen,
                  style: ElevatedButton.styleFrom(
                    minimumSize: const Size(0, 42),
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                  ),
                  child: const Text('Voir le profil'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
