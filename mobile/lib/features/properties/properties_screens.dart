import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../core/formatters.dart';
import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/category.dart';
import '../../models/property.dart';
import '../../models/provider_card.dart';
import '../../widgets/common.dart';
import '../../widgets/map_widgets.dart';
import '../../widgets/provider_picker.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import '../jobs/job_common.dart';

final propertiesProvider =
    FutureProvider.autoDispose<List<Property>>((ref) => ref.watch(apiProvider).properties());

final propertyDetailProvider = FutureProvider.autoDispose.family<PropertyDetail, String>(
  (ref, id) => ref.watch(apiProvider).property(id),
);

IconData propertyIcon(String kind) => switch (kind) {
      'house' => Icons.house_outlined,
      'building' => Icons.apartment,
      'land' => Icons.landscape_outlined,
      'commercial' => Icons.storefront_outlined,
      'apartment' => Icons.door_front_door_outlined,
      _ => Icons.home_work_outlined,
    };

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

class PropertiesScreen extends ConsumerWidget {
  const PropertiesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = ref.watch(propertiesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Mes biens')),
      body: value.when(
        skipLoadingOnRefresh: true,
        loading: () => const SkeletonList(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(propertiesProvider)),
        data: (list) => list.isEmpty
            ? EmptyView(
                title: 'Aucun bien enregistré',
                message: 'Ajoutez vos appartements, maisons ou locaux pour suivre les interventions '
                    'et les dépenses de chacun.',
                actionLabel: 'Ajouter un bien',
                onAction: () => context.push('/properties/new'),
              )
            : RefreshIndicator(
                onRefresh: () => ref.refresh(propertiesProvider.future),
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                  itemCount: list.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (_, i) {
                    final p = list[i];
                    return TaskoCard(
                      onTap: () => context.push('/properties/${p.id}'),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 24,
                            backgroundColor: TaskoColors.chip,
                            child: Icon(propertyIcon(p.kind), color: TaskoColors.primary),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(p.name,
                                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                                Text(
                                  [propertyKindLabel(p.kind), if (p.address.isNotEmpty) p.address]
                                      .join(' · '),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted),
                                ),
                                Text(
                                  '${p.jobsCount} intervention${p.jobsCount > 1 ? 's' : ''} · ${formatMoney(p.totalSpent)} dépensés',
                                  style: const TextStyle(fontSize: 13, color: TaskoColors.primary),
                                ),
                              ],
                            ),
                          ),
                          const Icon(Icons.chevron_right, color: TaskoColors.textMuted),
                        ],
                      ),
                    );
                  },
                ),
              ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/properties/new'),
        backgroundColor: TaskoColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add),
        label: const Text('Ajouter un bien'),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Formulaire (ajout / modification)
// ---------------------------------------------------------------------------

class PropertyFormScreen extends ConsumerStatefulWidget {
  const PropertyFormScreen({super.key, this.propertyId});
  final String? propertyId;

  @override
  ConsumerState<PropertyFormScreen> createState() => _PropertyFormScreenState();
}

class _PropertyFormScreenState extends ConsumerState<PropertyFormScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _address = TextEditingController();
  final _units = TextEditingController();
  final _notes = TextEditingController();
  final _map = MapController();
  String _kind = 'apartment';
  LatLng? _point;
  bool _busy = false;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    if (widget.propertyId == null) {
      _loaded = true;
      _locate();
    } else {
      _load();
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _units.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await ref.read(apiProvider).property(widget.propertyId!);
      final p = d.property;
      if (!mounted) return;
      setState(() {
        _name.text = p.name;
        _address.text = p.address;
        _units.text = p.unitsCount?.toString() ?? '';
        _notes.text = p.notes ?? '';
        _kind = kPropertyKindLabels.containsKey(p.kind) ? p.kind : 'other';
        if (p.lat != null && p.lng != null) _point = LatLng(p.lat!, p.lng!);
        _loaded = true;
      });
    } catch (e) {
      if (mounted) {
        showSnack(context, errorMessage(e), error: true);
        setState(() => _loaded = true);
      }
    }
  }

  Future<void> _locate() async {
    final pos = await LocationService.current();
    if (!mounted) return;
    setState(() => _point = pos.latLng);
    try {
      _map.move(pos.latLng, 15);
    } catch (_) {}
  }

  Future<void> _save() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    final body = {
      'name': _name.text.trim(),
      'kind': _kind,
      'address': _address.text.trim(),
      'lat': ?_point?.latitude,
      'lng': ?_point?.longitude,
      'units_count': ?int.tryParse(_units.text),
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
    };
    try {
      final api = ref.read(apiProvider);
      final p = widget.propertyId == null
          ? await api.createProperty(body)
          : await api.updateProperty(widget.propertyId!, body);
      ref.invalidate(propertiesProvider);
      ref.invalidate(propertyDetailProvider(p.id));
      if (!mounted) return;
      showSnack(context, 'Bien enregistré.');
      context.pushReplacement('/properties/${p.id}');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.propertyId == null ? 'Ajouter un bien' : 'Modifier le bien')),
      body: !_loaded
          ? const SkeletonList(count: 3)
          : Column(
              children: [
                Expanded(
                  child: Form(
                    key: _form,
                    child: ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        TextFormField(
                          controller: _name,
                          textCapitalization: TextCapitalization.sentences,
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          validator: (v) =>
                              (v ?? '').trim().length < 2 ? 'Donnez un nom à ce bien.' : null,
                          decoration: const InputDecoration(
                            labelText: 'Nom du bien',
                            hintText: 'Ex. : Résidence Les Palmiers',
                          ),
                        ),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String>(
                          initialValue: _kind,
                          decoration: const InputDecoration(labelText: 'Type de bien'),
                          items: [
                            for (final e in kPropertyKindLabels.entries)
                              DropdownMenuItem(value: e.key, child: Text(e.value)),
                          ],
                          onChanged: (v) => setState(() => _kind = v ?? 'other'),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _address,
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          validator: (v) =>
                              (v ?? '').trim().isEmpty ? 'Indiquez l’adresse.' : null,
                          decoration: InputDecoration(
                            labelText: 'Adresse',
                            hintText: 'Quartier, rue, repère',
                            prefixIcon: const Icon(Icons.place_outlined),
                            suffixIcon: IconButton(
                              tooltip: 'Utiliser ma position',
                              icon: const Icon(Icons.my_location, color: TaskoColors.primary),
                              onPressed: _locate,
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(TaskoRadius.card),
                          child: SizedBox(
                            height: 170,
                            child: FlutterMap(
                              mapController: _map,
                              options: MapOptions(
                                initialCenter: _point ?? const LatLng(3.8480, 11.5021),
                                initialZoom: 14,
                                onTap: (_, p) => setState(() => _point = p),
                              ),
                              children: [
                                osmTileLayer(),
                                if (_point != null)
                                  MarkerLayer(markers: [
                                    Marker(
                                      point: _point!,
                                      width: 40,
                                      height: 40,
                                      alignment: Alignment.topCenter,
                                      child: const DestinationPin(),
                                    ),
                                  ]),
                              ],
                            ),
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.only(top: 4),
                          child: Text('Touchez la carte pour placer le bien.',
                              style: TextStyle(fontSize: 13, color: TaskoColors.textMuted)),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _units,
                          keyboardType: TextInputType.number,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                          decoration: const InputDecoration(
                            labelText: 'Nombre de logements (optionnel)',
                            prefixIcon: Icon(Icons.meeting_room_outlined),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _notes,
                          minLines: 2,
                          maxLines: 4,
                          decoration: const InputDecoration(
                            labelText: 'Notes (optionnel)',
                            hintText: 'Code du portail, gardien, compteur…',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                BottomActionBar(children: [
                  TaskoButton(
                    label: 'Enregistrer le bien',
                    icon: Icons.save_outlined,
                    loading: _busy,
                    onPressed: _save,
                  ),
                ]),
              ],
            ),
    );
  }
}

// ---------------------------------------------------------------------------
// Détail : historique, dépenses, missions récurrentes
// ---------------------------------------------------------------------------

class PropertyDetailScreen extends ConsumerWidget {
  const PropertyDetailScreen({super.key, required this.propertyId});
  final String propertyId;

  Future<void> _delete(BuildContext context, WidgetRef ref, Property p) async {
    final ok = await confirmAction(
      context,
      title: 'Supprimer ce bien ?',
      message: '« ${p.name} » sera retiré de votre liste. L’historique des missions est conservé.',
      confirmLabel: 'Oui, supprimer',
      danger: true,
    );
    if (!ok) return;
    try {
      await ref.read(apiProvider).deleteProperty(p.id);
      ref.invalidate(propertiesProvider);
      if (context.mounted) {
        showSnack(context, 'Bien supprimé.');
        context.pop();
      }
    } catch (e) {
      if (context.mounted) showSnack(context, errorMessage(e), error: true);
    }
  }

  Future<void> _toggleRecurring(
      BuildContext context, WidgetRef ref, RecurringJob r, bool active) async {
    try {
      await ref.read(apiProvider).updateRecurringJob(r.id, {'is_active': active});
      ref.invalidate(propertyDetailProvider(propertyId));
      if (context.mounted) {
        showSnack(context, active ? 'Mission récurrente activée.' : 'Mission récurrente en pause.');
      }
    } catch (e) {
      if (context.mounted) showSnack(context, errorMessage(e), error: true);
    }
  }

  Future<void> _deleteRecurring(BuildContext context, WidgetRef ref, RecurringJob r) async {
    final ok = await confirmAction(
      context,
      title: 'Supprimer cette mission récurrente ?',
      message: 'Aucune nouvelle mission ne sera créée pour « ${r.title} ».',
      confirmLabel: 'Oui, supprimer',
      danger: true,
    );
    if (!ok) return;
    try {
      await ref.read(apiProvider).deleteRecurringJob(r.id);
      ref.invalidate(propertyDetailProvider(propertyId));
    } catch (e) {
      if (context.mounted) showSnack(context, errorMessage(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = ref.watch(propertyDetailProvider(propertyId));
    final p = value.value?.property;
    return Scaffold(
      appBar: AppBar(
        title: Text(p?.name ?? 'Mon bien'),
        actions: [
          if (p != null)
            PopupMenuButton<String>(
              tooltip: 'Plus d’options',
              onSelected: (v) {
                if (v == 'edit') context.push('/properties/${p.id}/edit');
                if (v == 'delete') _delete(context, ref, p);
              },
              itemBuilder: (_) => const [
                PopupMenuItem(
                    value: 'edit',
                    child: ListTile(leading: Icon(Icons.edit_outlined), title: Text('Modifier'))),
                PopupMenuItem(
                  value: 'delete',
                  child: ListTile(
                    leading: Icon(Icons.delete_outline, color: TaskoColors.danger),
                    title: Text('Supprimer'),
                  ),
                ),
              ],
            ),
        ],
      ),
      body: value.when(
        skipLoadingOnRefresh: true,
        loading: () => const SkeletonList(count: 3, itemHeight: 120),
        error: (e, _) =>
            ErrorView(error: e, onRetry: () => ref.invalidate(propertyDetailProvider(propertyId))),
        data: (d) {
          final prop = d.property;
          final jobs = [...d.jobs]
            ..sort((a, b) => (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
          return Column(
            children: [
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => ref.refresh(propertyDetailProvider(propertyId).future),
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Row(
                        children: [
                          CircleAvatar(
                            radius: 26,
                            backgroundColor: TaskoColors.chip,
                            child: Icon(propertyIcon(prop.kind), color: TaskoColors.primary),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(propertyKindLabel(prop.kind),
                                    style: const TextStyle(fontWeight: FontWeight.w600)),
                                if (prop.address.isNotEmpty)
                                  Text(prop.address,
                                      style: const TextStyle(color: TaskoColors.textMuted)),
                                if (prop.unitsCount != null)
                                  Text('${prop.unitsCount} logement${prop.unitsCount! > 1 ? 's' : ''}',
                                      style: const TextStyle(color: TaskoColors.textMuted)),
                              ],
                            ),
                          ),
                        ],
                      ),
                      if (prop.lat != null && prop.lng != null) ...[
                        const SizedBox(height: 12),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(TaskoRadius.card),
                          child: SizedBox(
                            height: 140,
                            child: IgnorePointer(
                              child: FlutterMap(
                                options: MapOptions(
                                  initialCenter: LatLng(prop.lat!, prop.lng!),
                                  initialZoom: 15,
                                ),
                                children: [
                                  osmTileLayer(),
                                  MarkerLayer(markers: [
                                    Marker(
                                      point: LatLng(prop.lat!, prop.lng!),
                                      width: 40,
                                      height: 40,
                                      alignment: Alignment.topCenter,
                                      child: const DestinationPin(),
                                    ),
                                  ]),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: _Stat(
                              icon: Icons.build_circle_outlined,
                              value: '${prop.jobsCount}',
                              label: 'interventions',
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _Stat(
                              icon: Icons.payments_outlined,
                              value: formatMoney(prop.totalSpent),
                              label: 'dépensés au total',
                            ),
                          ),
                        ],
                      ),
                      if (prop.notes != null && prop.notes!.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Text(prop.notes!, style: const TextStyle(fontSize: 14)),
                      ],
                      const SizedBox(height: 18),
                      SectionHeader(
                        title: 'Missions récurrentes',
                        action: 'Ajouter',
                        onAction: () async {
                          final created = await showModalBottomSheet<bool>(
                            context: context,
                            isScrollControlled: true,
                            showDragHandle: true,
                            builder: (_) => RecurringJobSheet(propertyId: prop.id),
                          );
                          if (created == true) ref.invalidate(propertyDetailProvider(propertyId));
                        },
                      ),
                      if (d.recurring.isEmpty)
                        const Text(
                          'Ménage chaque semaine, entretien de la piscine chaque mois… '
                          'Tasko crée la mission automatiquement pour votre prestataire attitré.',
                          style: TextStyle(color: TaskoColors.textMuted, fontSize: 14),
                        )
                      else
                        for (final r in d.recurring)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: TaskoCard(
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(r.title,
                                            style: const TextStyle(fontWeight: FontWeight.w700)),
                                        Text(
                                          '${frequencyLabel(r.frequency)} · ${formatMoney(r.price)}'
                                          '${r.providerName == null ? '' : ' · ${r.providerName}'}',
                                          style: const TextStyle(fontSize: 13),
                                        ),
                                        if (r.nextRunAt != null && r.isActive)
                                          Text('Prochaine : ${formatDateTime(r.nextRunAt)}',
                                              style: const TextStyle(
                                                  fontSize: 13, color: TaskoColors.textMuted)),
                                      ],
                                    ),
                                  ),
                                  Switch(
                                    value: r.isActive,
                                    onChanged: (v) => _toggleRecurring(context, ref, r, v),
                                  ),
                                  IconButton(
                                    tooltip: 'Supprimer « ${r.title} »',
                                    icon: const Icon(Icons.delete_outline, color: TaskoColors.danger),
                                    onPressed: () => _deleteRecurring(context, ref, r),
                                  ),
                                ],
                              ),
                            ),
                          ),
                      const SizedBox(height: 18),
                      const SectionHeader(title: 'Historique des interventions'),
                      const SizedBox(height: 6),
                      if (jobs.isEmpty)
                        const Text('Aucune intervention pour ce bien.',
                            style: TextStyle(color: TaskoColors.textMuted, fontSize: 14))
                      else
                        for (final j in jobs)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: JobCard(
                              job: j,
                              onTap: () => context.push(jobRouteFor(j, asProvider: false)),
                            ),
                          ),
                    ],
                  ),
                ),
              ),
              BottomActionBar(children: [
                TaskoButton(
                  label: 'Demander une intervention',
                  icon: Icons.add_task,
                  onPressed: () => context.push('/jobs/new?property_id=${prop.id}'),
                ),
              ]),
            ],
          );
        },
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.icon, required this.value, required this.label});
  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => TaskoCard(
        child: Row(
          children: [
            Icon(icon, color: TaskoColors.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(value,
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  ),
                  Text(label, style: const TextStyle(fontSize: 12.5, color: TaskoColors.textMuted)),
                ],
              ),
            ),
          ],
        ),
      );
}

/// Création d'une mission récurrente (prestataire attitré, fréquence, prix).
class RecurringJobSheet extends ConsumerStatefulWidget {
  const RecurringJobSheet({super.key, this.propertyId});
  final String? propertyId;

  @override
  ConsumerState<RecurringJobSheet> createState() => _RecurringJobSheetState();
}

class _RecurringJobSheetState extends ConsumerState<RecurringJobSheet> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _price = TextEditingController();
  ProviderCard? _provider;
  String? _categoryId;
  String _frequency = 'monthly';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _price.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy) return;
    String? err;
    if (_provider == null) err = 'Choisissez le prestataire attitré.';
    if (_categoryId == null) err ??= 'Choisissez le service.';
    if (_title.text.trim().length < 3) err ??= 'Donnez un titre.';
    if (parseAmount(_price.text) <= 0) err ??= 'Indiquez le prix.';
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiProvider).createRecurringJob({
        'property_id': ?widget.propertyId,
        'category_id': _categoryId,
        'provider_id': _provider!.id,
        'title': _title.text.trim(),
        'description': _description.text.trim(),
        'price': parseAmount(_price.text),
        'frequency': _frequency,
        'is_active': true,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = ref.watch(categoriesProvider).value ?? const <Category>[];
    final flat = <Category>[
      for (final c in categories) ...(c.children.isEmpty ? [c] : c.children),
    ];
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Nouvelle mission récurrente',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 19)),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () async {
                  final p = await pickProvider(context);
                  if (p != null) setState(() => _provider = p);
                },
                icon: const Icon(Icons.person_search),
                label: Text(_provider == null
                    ? 'Choisir le prestataire attitré'
                    : 'Prestataire : ${_provider!.fullName}'),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _categoryId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Service'),
                items: [
                  for (final c in flat) DropdownMenuItem(value: c.id, child: Text(c.name)),
                ],
                onChanged: (v) => setState(() => _categoryId = v),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _title,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                    labelText: 'Titre', hintText: 'Ex. : Ménage des parties communes'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _description,
                minLines: 2,
                maxLines: 4,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: 'Description (optionnel)'),
              ),
              const SizedBox(height: 12),
              AmountField(controller: _price, label: 'Prix par intervention'),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'weekly', label: Text('Semaine')),
                  ButtonSegment(value: 'biweekly', label: Text('2 semaines')),
                  ButtonSegment(value: 'monthly', label: Text('Mois')),
                ],
                selected: {_frequency},
                onSelectionChanged: (s) => setState(() => _frequency = s.first),
              ),
              const SizedBox(height: 8),
              Text('${frequencyLabel(_frequency)}, la mission est créée et vous la payez pour la sécuriser.',
                  style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted)),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(_error!, style: const TextStyle(color: TaskoColors.danger)),
                ),
              const SizedBox(height: 16),
              TaskoButton(
                label: 'Créer la mission récurrente',
                icon: Icons.event_repeat,
                loading: _busy,
                onPressed: _save,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
