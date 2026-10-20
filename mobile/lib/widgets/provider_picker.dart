import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/formatters.dart';
import '../core/providers.dart';
import '../core/theme.dart';
import '../models/provider_card.dart';
import 'common.dart';
import 'provider_tile.dart';
import 'tasko_button.dart';

enum _LookupBy { name, code, phone }

/// Recherche de « mon prestataire » : par nom, par code Tasko (`TSK-XXXXX`)
/// ou par numéro de téléphone. Renvoie le prestataire choisi.
Future<ProviderCard?> pickProvider(BuildContext context) {
  return showModalBottomSheet<ProviderCard>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => const _ProviderPickerSheet(),
  );
}

class _ProviderPickerSheet extends ConsumerStatefulWidget {
  const _ProviderPickerSheet();

  @override
  ConsumerState<_ProviderPickerSheet> createState() => _ProviderPickerSheetState();
}

class _ProviderPickerSheetState extends ConsumerState<_ProviderPickerSheet> {
  _LookupBy _by = _LookupBy.code;
  final _query = TextEditingController();
  bool _loading = false;
  String? _error;
  List<ProviderCard> _results = const [];

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final q = _query.text.trim();
    setState(() {
      _error = null;
      _results = const [];
    });
    if (q.isEmpty) {
      setState(() => _error = 'Saisissez une valeur à rechercher.');
      return;
    }
    final api = ref.read(apiProvider);
    setState(() => _loading = true);
    try {
      switch (_by) {
        case _LookupBy.name:
          final pos = ref.read(positionProvider).value;
          final list = await api.providers(q: q, lat: pos?.lat, lng: pos?.lng, limit: 20);
          setState(() => _results = list);
          if (list.isEmpty) _error = 'Aucun prestataire trouvé pour « $q ».';
        case _LookupBy.code:
          var code = q.toUpperCase().replaceAll(' ', '');
          if (!code.startsWith('TSK-')) code = 'TSK-${code.replaceFirst('TSK', '')}';
          final p = await api.lookupProvider(code: code);
          setState(() => _results = [p]);
        case _LookupBy.phone:
          final phone = normalizeCameroonPhone(q);
          if (phone == null) {
            setState(() => _error = 'Numéro invalide : 9 chiffres commençant par 6 ou 2.');
            return;
          }
          final p = await api.lookupProvider(phone: phone);
          setState(() => _results = [p]);
      }
    } catch (e) {
      setState(() => _error = e is ApiException && e.statusCode == 404
          ? 'Aucun prestataire Tasko ne correspond.'
          : errorMessage(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final (label, hint, keyboard) = switch (_by) {
      _LookupBy.code => ('Code Tasko', 'TSK-7F3K9', TextInputType.text),
      _LookupBy.phone => ('Téléphone du prestataire', '6XX XX XX XX', TextInputType.phone),
      _LookupBy.name => ('Nom du prestataire', 'Ex. : Bika Services', TextInputType.name),
    };
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Trouver mon prestataire',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
              const SizedBox(height: 4),
              const Text(
                'Demandez-lui son code Tasko (sur son profil) ou son numéro.',
                style: TextStyle(color: TaskoColors.textMuted, fontSize: 14),
              ),
              const SizedBox(height: 12),
              SegmentedButton<_LookupBy>(
                segments: const [
                  ButtonSegment(value: _LookupBy.code, label: Text('Code'), icon: Icon(Icons.qr_code_2)),
                  ButtonSegment(value: _LookupBy.phone, label: Text('Téléphone'), icon: Icon(Icons.phone)),
                  ButtonSegment(value: _LookupBy.name, label: Text('Nom'), icon: Icon(Icons.search)),
                ],
                selected: {_by},
                onSelectionChanged: (s) => setState(() {
                  _by = s.first;
                  _query.clear();
                  _results = const [];
                  _error = null;
                }),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _query,
                autofocus: true,
                keyboardType: keyboard,
                textCapitalization:
                    _by == _LookupBy.code ? TextCapitalization.characters : TextCapitalization.words,
                inputFormatters: _by == _LookupBy.phone
                    ? [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(9)]
                    : null,
                onSubmitted: (_) => _search(),
                decoration: InputDecoration(
                  labelText: label,
                  hintText: hint,
                  prefixText: _by == _LookupBy.phone ? '+237 ' : null,
                  errorText: _error,
                  errorMaxLines: 2,
                ),
              ),
              const SizedBox(height: 12),
              TaskoButton(
                label: 'Rechercher',
                icon: Icons.search,
                loading: _loading,
                onPressed: _search,
              ),
              const SizedBox(height: 12),
              for (final p in _results)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: ProviderTile(
                    provider: p,
                    onTap: () => Navigator.pop(context, p),
                    trailing: TextButton(
                      onPressed: () => Navigator.pop(context, p),
                      style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                      child: const Text('Choisir'),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
