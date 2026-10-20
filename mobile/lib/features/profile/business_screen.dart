import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/user.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';

/// « Passer en compte entreprise » : nom, type, NIU, RCCM, adresse.
class BusinessScreen extends ConsumerStatefulWidget {
  const BusinessScreen({super.key});

  @override
  ConsumerState<BusinessScreen> createState() => _BusinessScreenState();
}

class _BusinessScreenState extends ConsumerState<BusinessScreen> {
  final _form = GlobalKey<FormState>();
  late final BusinessInfo? _initial = ref.read(authProvider).user?.business;
  late final _name = TextEditingController(text: _initial?.name ?? '');
  late final _niu = TextEditingController(text: _initial?.niu ?? '');
  late final _rccm = TextEditingController(text: _initial?.rccm ?? '');
  late final _address = TextEditingController(text: _initial?.address ?? '');
  late String _kind =
      kBusinessKindLabels.containsKey(_initial?.kind) ? _initial!.kind : 'company';
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _niu.dispose();
    _rccm.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      final user = await ref.read(apiProvider).setBusiness(BusinessInfo(
            name: _name.text.trim(),
            kind: _kind,
            niu: _niu.text.trim(),
            rccm: _rccm.text.trim(),
            address: _address.text.trim(),
          ));
      ref.read(authProvider.notifier).setUser(user);
      if (!mounted) return;
      showSnack(context, 'Compte entreprise enregistré.');
      context.pop();
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _revert() async {
    final ok = await confirmAction(
      context,
      title: 'Revenir en compte particulier ?',
      message: 'Les informations de votre entreprise ne figureront plus sur vos reçus.',
      confirmLabel: 'Oui, revenir',
      danger: true,
    );
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      final user = await ref.read(apiProvider).setBusiness(null);
      ref.read(authProvider.notifier).setUser(user);
      if (mounted) context.pop();
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isBusiness = ref.watch(authProvider).user?.isBusiness ?? false;
    return Scaffold(
      appBar: AppBar(title: Text(isBusiness ? 'Mon entreprise' : 'Compte entreprise')),
      body: Column(
        children: [
          Expanded(
            child: Form(
              key: _form,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const InfoBox(
                    icon: Icons.business_center_outlined,
                    text: 'Entreprises, agences immobilières, ONG, administrations : reçus à votre nom, '
                        'appels d’offres, suivi des biens et missions récurrentes.',
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _name,
                    textCapitalization: TextCapitalization.words,
                    autovalidateMode: AutovalidateMode.onUserInteraction,
                    validator: (v) => (v ?? '').trim().length < 2 ? 'Indiquez le nom.' : null,
                    decoration: const InputDecoration(
                      labelText: 'Nom de la structure',
                      prefixIcon: Icon(Icons.business),
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _kind,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Type de structure'),
                    items: [
                      for (final e in kBusinessKindLabels.entries)
                        DropdownMenuItem(value: e.key, child: Text(e.value)),
                    ],
                    onChanged: (v) => setState(() => _kind = v ?? 'company'),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _niu,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'NIU (optionnel)',
                      helperText: 'Numéro d’identifiant unique (impôts)',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _rccm,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'RCCM (optionnel)',
                      helperText: 'Registre du commerce',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _address,
                    decoration: const InputDecoration(
                      labelText: 'Adresse (optionnel)',
                      prefixIcon: Icon(Icons.place_outlined),
                    ),
                  ),
                  if (isBusiness) ...[
                    const SizedBox(height: 20),
                    TextButton.icon(
                      onPressed: _busy ? null : _revert,
                      style: TextButton.styleFrom(
                          foregroundColor: TaskoColors.danger, minimumSize: const Size(48, 48)),
                      icon: const Icon(Icons.person_outline),
                      label: const Text('Revenir en compte particulier'),
                    ),
                  ],
                ],
              ),
            ),
          ),
          BottomActionBar(children: [
            TaskoButton(
              label: isBusiness ? 'Enregistrer' : 'Passer en compte entreprise',
              icon: Icons.check,
              loading: _busy,
              onPressed: _save,
            ),
          ]),
        ],
      ),
    );
  }
}
