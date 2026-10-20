import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';

import '../../core/formatters.dart';
import '../../core/icon_map.dart';
import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/category.dart';
import '../../models/job.dart';
import '../../models/property.dart';
import '../../models/provider_card.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/map_widgets.dart';
import '../../widgets/milestones.dart';
import '../../widgets/provider_picker.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';
import '../properties/properties_screens.dart';

/// Création de demande (bouton +). Parcours simple par défaut :
/// mode → service → besoin → lieu/quand → budget. Options avancées repliées.
class CreateJobScreen extends ConsumerStatefulWidget {
  const CreateJobScreen({
    super.key,
    this.categoryId,
    this.providerId,
    this.providerName,
    this.urgency,
    this.other = false,
    this.propertyId,
    this.mode,
  });

  final String? categoryId;
  final String? providerId;
  final String? providerName;
  final String? urgency;
  final bool other;
  final String? propertyId;
  final String? mode;

  @override
  ConsumerState<CreateJobScreen> createState() => _CreateJobScreenState();
}

class _CreateJobScreenState extends ConsumerState<CreateJobScreen> {
  final _description = TextEditingController();
  final _address = TextEditingController();
  final _otherService = TextEditingController();
  final _budget = TextEditingController(text: formatMoney(5000, withCurrency: false));
  final _budgetMin = TextEditingController();
  final _budgetMax = TextEditingController();
  final _mapController = MapController();

  String _mode = JobMode.instant;
  Category? _parent;
  Category? _sub;
  bool _other = false;
  bool _initializedFromQuery = false;

  String _urgency = Urgency.now;
  DateTime? _scheduledAt;
  LatLng? _point;
  bool _locating = false;

  Uint8List? _photoBytes;
  String? _photoUrl;
  bool _uploading = false;

  // Demande directe.
  String? _providerId;
  String? _providerName;
  ProviderCard? _provider;

  // Appel d'offres.
  DateTime? _bidDeadline;
  String _visibility = 'public';
  final List<ProviderCard> _invited = [];

  // Options avancées.
  String? _propertyId;
  List<MilestoneDraft> _milestones = const [];

  Quote? _quote;
  bool _quoting = false;
  Timer? _quoteDebounce;

  bool _submitting = false;
  final Map<String, String> _errors = {};

  @override
  void initState() {
    super.initState();
    _other = widget.other;
    _providerId = widget.providerId;
    _providerName = widget.providerName;
    _propertyId = widget.propertyId;
    if (_providerId != null) _mode = JobMode.direct;
    if (widget.mode == JobMode.tender) _mode = JobMode.tender;
    if (widget.urgency != null) _urgency = widget.urgency!;
    _bidDeadline = DateTime.now().add(const Duration(days: 7));
    _locate();
    _refreshQuote();
  }

  @override
  void dispose() {
    _description.dispose();
    _address.dispose();
    _otherService.dispose();
    _budget.dispose();
    _budgetMin.dispose();
    _budgetMax.dispose();
    _quoteDebounce?.cancel();
    super.dispose();
  }

  void _initFromQuery(List<Category> categories) {
    if (_initializedFromQuery) return;
    _initializedFromQuery = true;
    final id = widget.categoryId;
    if (id == null) return;
    for (final c in categories) {
      if (c.id == id) {
        if (isOtherCategory(c)) {
          _other = true;
        } else {
          _parent = c;
        }
        return;
      }
      for (final child in c.children) {
        if (child.id == id) {
          _parent = c;
          _sub = child;
          return;
        }
      }
    }
  }

  Future<void> _locate() async {
    setState(() => _locating = true);
    final city = ref.read(selectedCityProvider);
    final pos = await LocationService.current(
      fallback: city == null ? null : LatLng(city.lat, city.lng),
    );
    if (!mounted) return;
    setState(() {
      _point = pos.latLng;
      _locating = false;
      if (_address.text.isEmpty) {
        final name = city?.name ?? ref.read(authProvider).user?.city ?? 'Yaoundé';
        _address.text = pos.isFallback ? name : 'Ma position actuelle, $name';
      }
    });
    try {
      _mapController.move(pos.latLng, 15);
    } catch (_) {}
  }

  int get _budgetValue => parseAmount(_budget.text);

  void _onBudgetChanged() {
    _quoteDebounce?.cancel();
    _quoteDebounce = Timer(const Duration(milliseconds: 400), _refreshQuote);
    setState(() => _errors.remove('budget'));
  }

  Future<void> _refreshQuote() async {
    final price = _budgetValue;
    if (price <= 0) {
      if (mounted) setState(() => _quote = null);
      return;
    }
    setState(() => _quoting = true);
    try {
      final q = await ref.read(apiProvider).quote(price);
      if (mounted && price == _budgetValue) setState(() => _quote = q);
    } catch (_) {
      final s = ref.read(settingsValueProvider);
      final fee = estimateServiceFee(price, rate: s.clientFeeRate, minFee: s.minServiceFee);
      if (mounted) {
        setState(() => _quote = Quote(price: price, serviceFee: fee, total: price + fee));
      }
    } finally {
      if (mounted) setState(() => _quoting = false);
    }
  }

  Future<void> _pickPhoto() async {
    try {
      final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 1600,
        imageQuality: 80,
      );
      if (file == null) return;
      final bytes = await file.readAsBytes();
      setState(() {
        _photoBytes = bytes;
        _uploading = true;
      });
      final url = await ref.read(apiProvider).upload(bytes, file.name);
      if (mounted) setState(() => _photoUrl = url);
    } catch (e) {
      if (mounted) {
        setState(() => _photoBytes = null);
        showSnack(context, errorMessage(e), error: true);
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<DateTime?> _pickDateTime({DateTime? initial, int maxDays = 60}) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      firstDate: now,
      lastDate: now.add(Duration(days: maxDays)),
      initialDate: initial ?? now.add(const Duration(days: 1)),
      locale: const Locale('fr'),
    );
    if (date == null || !mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial ?? DateTime(2000, 1, 1, 9)),
    );
    if (time == null) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  Future<void> _pickSchedule() async {
    final d = await _pickDateTime(initial: _scheduledAt);
    if (d != null) setState(() => _scheduledAt = d);
  }

  Future<void> _pickProvider() async {
    final p = await pickProvider(context);
    if (p == null) return;
    setState(() {
      _provider = p;
      _providerId = p.id;
      _providerName = p.fullName;
      _errors.remove('provider');
    });
  }

  Future<void> _addInvited() async {
    final p = await pickProvider(context);
    if (p == null || _invited.any((e) => e.id == p.id)) return;
    setState(() => _invited.add(p));
  }

  /// Catégorie à envoyer : sous-service, sinon catégorie, sinon « Autre ».
  String? _resolveCategoryId(List<Category> categories) {
    if (_other) {
      final other = otherCategoryOf(categories);
      if (other != null) return other.id;
      return _parent?.id ?? (categories.isEmpty ? null : categories.last.id);
    }
    if (_sub != null) return _sub!.id;
    return _parent?.id;
  }

  bool _validate(List<Category> categories) {
    _errors.clear();
    if (_resolveCategoryId(categories) == null) _errors['category'] = 'Choisissez un service.';
    if (_other && _otherService.text.trim().length < 3) {
      _errors['other'] = 'Précisez le service recherché.';
    }
    if (_description.text.trim().length < 5) {
      _errors['description'] = 'Décrivez votre besoin en quelques mots.';
    }
    if (_address.text.trim().isEmpty) _errors['address'] = 'Indiquez l’adresse.';
    if (_urgency == Urgency.scheduled && _scheduledAt == null) {
      _errors['schedule'] = 'Choisissez la date et l’heure.';
    }
    if (_mode == JobMode.direct && _providerId == null) {
      _errors['provider'] = 'Choisissez votre prestataire.';
    }
    if (_mode == JobMode.tender) {
      final min = parseAmount(_budgetMin.text), max = parseAmount(_budgetMax.text);
      if (min > 0 && max > 0 && min > max) {
        _errors['range'] = 'Le minimum doit être inférieur au maximum.';
      }
      if (_bidDeadline == null || _bidDeadline!.isBefore(DateTime.now())) {
        _errors['deadline'] = 'Choisissez une date limite dans le futur.';
      }
      if (_visibility == 'invited' && _invited.isEmpty) {
        _errors['invited'] = 'Invitez au moins un prestataire.';
      }
    } else if (_budgetValue < 500) {
      _errors['budget'] = 'Budget minimum : ${formatMoney(500)}.';
    }
    if (_milestones.isNotEmpty && _mode != JobMode.tender) {
      final sum = _milestones.fold<int>(0, (s, m) => s + m.amount);
      if (sum != _budgetValue) {
        _errors['milestones'] = 'Le total des étapes doit être égal au budget.';
      }
    }
    setState(() {});
    return _errors.isEmpty;
  }

  Future<void> _submit(List<Category> categories) async {
    if (_submitting) return;
    if (_uploading) {
      showSnack(context, 'Patientez, la photo est en cours d’envoi…');
      return;
    }
    if (!_validate(categories)) {
      showSnack(context, _errors.values.first, error: true);
      return;
    }
    final categoryId = _resolveCategoryId(categories)!;
    final point = _point ?? const LatLng(3.8480, 11.5021);
    final description = _other && otherCategoryOf(categories) == null
        ? '[Autre service : ${_otherService.text.trim()}] ${_description.text.trim()}'
        : _description.text.trim();
    final tender = _mode == JobMode.tender;
    final min = parseAmount(_budgetMin.text), max = parseAmount(_budgetMax.text);
    setState(() => _submitting = true);
    try {
      final job = await ref.read(apiProvider).createJob(
            mode: _mode,
            categoryId: categoryId,
            description: description,
            address: _address.text.trim(),
            lat: point.latitude,
            lng: point.longitude,
            urgency: _urgency,
            scheduledAt: _urgency == Urgency.scheduled ? _scheduledAt : null,
            budget: tender ? (max > 0 ? max : (min > 0 ? min : null)) : _budgetValue,
            providerId: _mode == JobMode.direct ? _providerId : null,
            photoUrl: _photoUrl,
            otherService: _other ? _otherService.text.trim() : null,
            bidDeadline: tender ? _bidDeadline : null,
            visibility: tender ? _visibility : null,
            invitedProviderIds:
                tender && _visibility == 'invited' ? _invited.map((p) => p.id).toList() : null,
            budgetMin: tender && min > 0 ? min : null,
            budgetMax: tender && max > 0 ? max : null,
            propertyId: _propertyId,
            milestones: _milestones,
          );
      if (!mounted) return;
      showSnack(
        context,
        switch (_mode) {
          JobMode.tender => 'Appel d’offres publié. Les devis arrivent ici.',
          JobMode.direct => 'Demande envoyée à ${_providerName ?? 'votre prestataire'}.',
          _ => 'Demande envoyée aux prestataires proches.',
        },
      );
      context.pushReplacement(tender ? '/jobs/${job.id}/tender' : '/jobs/${job.id}/waiting');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = ref.watch(categoriesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Nouvelle demande')),
      body: AsyncView(
        value: categories,
        onRetry: () => ref.invalidate(categoriesProvider),
        loadingMessage: 'Chargement des services…',
        data: (list) {
          _initFromQuery(list);
          return Column(
            children: [
              Expanded(child: _buildForm(context, list)),
              BottomActionBar(children: [
                TaskoButton(
                  label: switch (_mode) {
                    JobMode.tender => 'Publier l’appel d’offres',
                    JobMode.direct => 'Envoyer la demande',
                    _ => 'Trouver un prestataire',
                  },
                  icon: switch (_mode) {
                    JobMode.tender => Icons.campaign_outlined,
                    JobMode.direct => Icons.send,
                    _ => Icons.search,
                  },
                  loading: _submitting,
                  onPressed: () => _submit(list),
                ),
              ]),
            ],
          );
        },
      ),
    );
  }

  Widget _stepTitle(String n, String title) => Padding(
        padding: const EdgeInsets.only(top: 22, bottom: 10),
        child: Row(
          children: [
            CircleAvatar(
              radius: 13,
              backgroundColor: TaskoColors.primary,
              child: Text(n, style: const TextStyle(color: Colors.white, fontSize: 13)),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(title,
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 16, color: TaskoColors.primaryDark)),
            ),
          ],
        ),
      );

  Widget? _errorText(String key) => _errors[key] == null
      ? null
      : Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(_errors[key]!, style: const TextStyle(color: TaskoColors.danger, fontSize: 13.5)),
        );

  Widget _buildForm(BuildContext context, List<Category> categories) {
    final quote = _quote;
    final isBusiness = ref.watch(authProvider).user?.isBusiness ?? false;
    final tender = _mode == JobMode.tender;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        _stepTitle('1', 'Comment trouver votre prestataire ?'),
        _ModeCard(
          icon: Icons.bolt,
          title: 'Le premier disponible',
          subtitle: 'Rapide : les prestataires proches sont alertés, le premier qui accepte vient.',
          selected: _mode == JobMode.instant,
          onTap: () => setState(() => _mode = JobMode.instant),
        ),
        _ModeCard(
          icon: Icons.person_search,
          title: 'J’ai déjà mon prestataire',
          subtitle: 'Retrouvez-le par son nom, son code Tasko ou son numéro.',
          selected: _mode == JobMode.direct,
          onTap: () => setState(() => _mode = JobMode.direct),
        ),
        _ModeCard(
          icon: Icons.request_quote_outlined,
          title: 'Appel d’offres (plusieurs devis)',
          subtitle: 'Pour les gros travaux : recevez plusieurs devis et choisissez.',
          selected: tender,
          onTap: () => setState(() => _mode = JobMode.tender),
        ),
        if (_mode == JobMode.direct) ...[
          const SizedBox(height: 4),
          if (_providerId != null)
            TaskoCard(
              color: TaskoColors.chip,
              child: Row(
                children: [
                  TaskoAvatar(name: _providerName, url: _provider?.avatarUrl, size: 40),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_providerName ?? 'Prestataire choisi',
                            style: const TextStyle(fontWeight: FontWeight.w700)),
                        const Text('Demande envoyée à lui seul (non diffusée)',
                            style: TextStyle(fontSize: 13, color: TaskoColors.textMuted)),
                      ],
                    ),
                  ),
                  TextButton(
                    onPressed: _pickProvider,
                    style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                    child: const Text('Changer'),
                  ),
                ],
              ),
            )
          else
            TaskoButton(
              label: 'Choisir mon prestataire',
              icon: Icons.person_search,
              variant: TaskoButtonVariant.outline,
              onPressed: _pickProvider,
            ),
          if (_errorText('provider') != null) _errorText('provider')!,
        ],
        _stepTitle('2', 'Quel service ?'),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final c in categories.where((c) => !isOtherCategory(c)))
              TaskoChip(
                label: c.name,
                icon: iconForKey(c.icon),
                color: colorFromHex(c.color),
                selected: _parent?.id == c.id && !_other,
                onTap: () => setState(() {
                  _parent = c;
                  _sub = null;
                  _other = false;
                  _errors.remove('category');
                }),
              ),
            TaskoChip(
              label: 'Autre service',
              icon: Icons.more_horiz,
              color: TaskoColors.textMuted,
              selected: _other,
              onTap: () => setState(() {
                _other = true;
                _sub = null;
                _errors.remove('category');
              }),
            ),
          ],
        ),
        if (_errorText('category') != null) _errorText('category')!,
        if (!_other && _parent != null && _parent!.children.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text('Précisez (${_parent!.name})',
              style: const TextStyle(fontSize: 14, color: TaskoColors.textMuted)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final s in _parent!.children)
                TaskoChip(
                  label: s.name,
                  icon: iconForKey(s.icon),
                  color: colorFromHex(_parent!.color),
                  selected: _sub?.id == s.id,
                  onTap: () => setState(() => _sub = s),
                ),
            ],
          ),
        ],
        if (_other) ...[
          const SizedBox(height: 14),
          TextField(
            controller: _otherService,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => setState(() => _errors.remove('other')),
            decoration: InputDecoration(
              labelText: 'Quel service recherchez-vous ?',
              hintText: 'Ex. : montage de meuble, cours de guitare…',
              prefixIcon: const Icon(Icons.edit_note),
              errorText: _errors['other'],
            ),
          ),
        ],
        _stepTitle('3', 'Décrivez votre besoin'),
        TextField(
          controller: _description,
          minLines: 3,
          maxLines: 6,
          textCapitalization: TextCapitalization.sentences,
          onChanged: (_) {
            if (_errors.containsKey('description')) setState(() => _errors.remove('description'));
          },
          decoration: InputDecoration(
            hintText: 'Ex. : fuite d’eau sous l’évier de la cuisine.',
            errorText: _errors['description'],
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Semantics(
              button: true,
              label: 'Ajouter une photo',
              child: InkWell(
                onTap: _uploading ? null : _pickPhoto,
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  width: 84,
                  height: 84,
                  decoration: BoxDecoration(
                    color: TaskoColors.surfaceMuted,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: TaskoColors.border),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: _photoBytes != null
                      ? Stack(
                          fit: StackFit.expand,
                          children: [
                            Image.memory(_photoBytes!, fit: BoxFit.cover),
                            if (_uploading)
                              const ColoredBox(
                                color: Colors.black38,
                                child: Center(
                                  child: CircularProgressIndicator(color: Colors.white),
                                ),
                              ),
                          ],
                        )
                      : const Icon(Icons.add_a_photo_outlined, color: TaskoColors.primary),
                ),
              ),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Text(
                'Une photo (optionnel) aide le prestataire à comprendre le travail.',
                style: TextStyle(fontSize: 14, color: TaskoColors.textMuted),
              ),
            ),
          ],
        ),
        _stepTitle('4', 'Où et quand ?'),
        TextField(
          controller: _address,
          onChanged: (_) => setState(() => _errors.remove('address')),
          decoration: InputDecoration(
            hintText: 'Quartier, repère… (ex. Bastos, près de l’ambassade)',
            prefixIcon: const Icon(Icons.place_outlined),
            errorText: _errors['address'],
            suffixIcon: IconButton(
              tooltip: 'Utiliser ma position',
              icon: _locating
                  ? const SizedBox(
                      width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.my_location, color: TaskoColors.primary),
              onPressed: _locating ? null : _locate,
            ),
          ),
        ),
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: BorderRadius.circular(TaskoRadius.card),
          child: SizedBox(
            height: 160,
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _mapController,
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
                Positioned(
                  left: 8,
                  bottom: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text('Touchez la carte pour ajuster',
                        style: TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            for (final u in const [Urgency.now, Urgency.today, Urgency.scheduled]) ...[
              Expanded(
                child: _UrgencyOption(
                  label: Urgency.label(u),
                  icon: switch (u) {
                    Urgency.now => Icons.bolt,
                    Urgency.today => Icons.today,
                    _ => Icons.event,
                  },
                  selected: _urgency == u,
                  onTap: () {
                    setState(() {
                      _urgency = u;
                      _errors.remove('schedule');
                    });
                    if (u == Urgency.scheduled && _scheduledAt == null) _pickSchedule();
                  },
                ),
              ),
              if (u != Urgency.scheduled) const SizedBox(width: 8),
            ],
          ],
        ),
        if (_urgency == Urgency.scheduled) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _pickSchedule,
            icon: const Icon(Icons.schedule),
            label: Text(_scheduledAt == null
                ? 'Choisir la date et l’heure'
                : 'Le ${formatDateTime(_scheduledAt)}'),
          ),
          if (_errorText('schedule') != null) _errorText('schedule')!,
        ],
        if (tender) ..._tenderFields() else ..._budgetFields(quote),
        const SizedBox(height: 16),
        Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            initiallyExpanded: isBusiness || _propertyId != null || _milestones.isNotEmpty,
            tilePadding: EdgeInsets.zero,
            leading: const Icon(Icons.tune, color: TaskoColors.primary),
            title: const Text('Options avancées',
                style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
            subtitle: const Text('Bien immobilier, paiement en plusieurs étapes',
                style: TextStyle(fontSize: 13)),
            childrenPadding: const EdgeInsets.only(bottom: 8),
            children: [_propertySelector(), const SizedBox(height: 12), _milestonesSection()],
          ),
        ),
      ],
    );
  }

  List<Widget> _budgetFields(Quote? quote) => [
        _stepTitle('5', 'Votre budget'),
        AmountField(controller: _budget, onChanged: (_) => _onBudgetChanged()),
        if (_errorText('budget') != null) _errorText('budget')!,
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final v in const [2000, 5000, 10000, 20000, 50000])
              TaskoChip(
                label: formatMoney(v),
                selected: _budgetValue == v,
                onTap: () {
                  _budget.text = formatMoney(v, withCurrency: false);
                  _onBudgetChanged();
                },
              ),
          ],
        ),
        const SizedBox(height: 12),
        if (quote == null)
          const Text('Indiquez un budget pour voir le prix total.',
              style: TextStyle(color: TaskoColors.textMuted))
        else ...[
          AmountSummary(
            price: quote.price,
            serviceFee: quote.serviceFee,
            total: quote.total,
            providerReceives: quote.providerPayout > 0 ? quote.providerPayout : quote.price,
          ),
          if (_quoting) const LinearProgressIndicator(minHeight: 2, color: TaskoColors.primary),
        ],
        const SizedBox(height: 8),
        const Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.lock_outline, size: 16, color: TaskoColors.primary),
            SizedBox(width: 6),
            Expanded(
              child: Text(
                'Vous ne payez qu’après l’accord du prestataire. L’argent reste bloqué chez Tasko '
                'jusqu’à ce que vous validiez le travail.',
                style: TextStyle(fontSize: 13, color: TaskoColors.textMuted),
              ),
            ),
          ],
        ),
      ];

  List<Widget> _tenderFields() => [
        _stepTitle('5', 'Votre appel d’offres'),
        Row(
          children: [
            Expanded(child: AmountField(controller: _budgetMin, label: 'Budget min.')),
            const SizedBox(width: 10),
            Expanded(child: AmountField(controller: _budgetMax, label: 'Budget max.')),
          ],
        ),
        const Padding(
          padding: EdgeInsets.only(top: 4),
          child: Text('Budget indicatif, optionnel.',
              style: TextStyle(fontSize: 13, color: TaskoColors.textMuted)),
        ),
        if (_errorText('range') != null) _errorText('range')!,
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () async {
            final d = await _pickDateTime(initial: _bidDeadline, maxDays: 90);
            if (d != null) setState(() => _bidDeadline = d);
          },
          icon: const Icon(Icons.timer_outlined),
          label: Text(_bidDeadline == null
              ? 'Date limite des devis'
              : 'Devis jusqu’au ${formatDateTime(_bidDeadline)}'),
        ),
        if (_errorText('deadline') != null) _errorText('deadline')!,
        const SizedBox(height: 12),
        const Text('Qui peut envoyer un devis ?', style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'public', label: Text('Tous'), icon: Icon(Icons.public)),
            ButtonSegment(
                value: 'invited', label: Text('Sur invitation'), icon: Icon(Icons.mail_outline)),
          ],
          selected: {_visibility},
          onSelectionChanged: (s) => setState(() => _visibility = s.first),
        ),
        const SizedBox(height: 6),
        Text(
          _visibility == 'public'
              ? 'Tous les prestataires de ce métier dans votre ville sont prévenus.'
              : 'Seuls les prestataires que vous invitez peuvent répondre.',
          style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted),
        ),
        if (_visibility == 'invited') ...[
          const SizedBox(height: 8),
          for (final p in _invited)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: TaskoAvatar(name: p.fullName, url: p.avatarUrl, size: 36),
              title: Text(p.fullName),
              trailing: IconButton(
                tooltip: 'Retirer ${p.fullName}',
                icon: const Icon(Icons.close),
                onPressed: () => setState(() => _invited.remove(p)),
              ),
            ),
          OutlinedButton.icon(
            onPressed: _addInvited,
            icon: const Icon(Icons.person_add_alt),
            label: const Text('Inviter un prestataire'),
          ),
          if (_errorText('invited') != null) _errorText('invited')!,
        ],
      ];

  Widget _propertySelector() {
    final props = ref.watch(propertiesProvider);
    return props.when(
      loading: () => const LinearProgressIndicator(minHeight: 2),
      error: (_, _) => const SizedBox.shrink(),
      data: (list) {
        if (list.isEmpty) {
          return Row(
            children: [
              const Icon(Icons.apartment, color: TaskoColors.textMuted),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Propriétaire ? Enregistrez vos biens pour suivre les dépenses.',
                    style: TextStyle(fontSize: 13.5)),
              ),
              TextButton(
                onPressed: () => context.push('/properties'),
                style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                child: const Text('Mes biens'),
              ),
            ],
          );
        }
        return DropdownButtonFormField<String?>(
          initialValue: list.any((p) => p.id == _propertyId) ? _propertyId : null,
          decoration: const InputDecoration(
            labelText: 'Bien immobilier concerné',
            prefixIcon: Icon(Icons.apartment),
          ),
          items: [
            const DropdownMenuItem<String?>(value: null, child: Text('Aucun')),
            for (final Property p in list)
              DropdownMenuItem<String?>(value: p.id, child: Text(p.name)),
          ],
          onChanged: (v) => setState(() => _propertyId = v),
        );
      },
    );
  }

  Widget _milestonesSection() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Gros travaux ? Payez en plusieurs étapes : chaque étape est payée avant de commencer.',
            style: TextStyle(fontSize: 13.5, color: TaskoColors.textMuted),
          ),
          const SizedBox(height: 8),
          MilestonesEditor(
            initial: _milestones,
            expectedTotal: _mode == JobMode.tender ? null : _budgetValue,
            onChanged: (v) => setState(() {
              _milestones = v;
              _errors.remove('milestones');
            }),
          ),
          if (_errorText('milestones') != null) _errorText('milestones')!,
        ],
      );
}

/// Carte de choix du mode de demande.
class _ModeCard extends StatelessWidget {
  const _ModeCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(
        selected: selected,
        button: true,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(TaskoRadius.card),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: selected ? TaskoColors.chip : Colors.white,
              borderRadius: BorderRadius.circular(TaskoRadius.card),
              border: Border.all(
                color: selected ? TaskoColors.primary : TaskoColors.border,
                width: selected ? 2 : 1,
              ),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 22,
                  backgroundColor: selected ? TaskoColors.primary : TaskoColors.surfaceMuted,
                  child: Icon(icon, color: selected ? Colors.white : TaskoColors.primary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      Text(subtitle,
                          style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted)),
                    ],
                  ),
                ),
                Icon(
                  selected ? Icons.radio_button_checked : Icons.radio_button_off,
                  color: selected ? TaskoColors.primary : TaskoColors.textMuted,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _UrgencyOption extends StatelessWidget {
  const _UrgencyOption({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(TaskoRadius.button),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          constraints: const BoxConstraints(minHeight: 56),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: selected ? TaskoColors.primary : Colors.white,
            borderRadius: BorderRadius.circular(TaskoRadius.button),
            border: Border.all(color: selected ? TaskoColors.primary : TaskoColors.border),
          ),
          child: Column(
            children: [
              Icon(icon, color: selected ? Colors.white : TaskoColors.primary),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: selected ? Colors.white : TaskoColors.text,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
