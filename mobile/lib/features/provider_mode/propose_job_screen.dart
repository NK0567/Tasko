import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/job.dart';
import '../../models/category.dart';
import '../../widgets/common.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/milestones.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/ux.dart';

/// Prestataire : « Proposer une mission à un client » (accord déjà conclu hors de l'app).
class ProposeJobScreen extends ConsumerStatefulWidget {
  const ProposeJobScreen({super.key});

  @override
  ConsumerState<ProposeJobScreen> createState() => _ProposeJobScreenState();
}

class _ProposeJobScreenState extends ConsumerState<ProposeJobScreen> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _price = TextEditingController();
  final _address = TextEditingController();
  String? _categoryId;
  DateTime? _scheduledAt;
  List<MilestoneDraft> _milestones = const [];
  bool _busy = false;

  @override
  void dispose() {
    _phone.dispose();
    _title.dispose();
    _description.dispose();
    _price.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      firstDate: now,
      lastDate: now.add(const Duration(days: 90)),
      initialDate: now.add(const Duration(days: 1)),
      locale: const Locale('fr'),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: const TimeOfDay(hour: 9, minute: 0));
    if (time == null) return;
    setState(() => _scheduledAt = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  Future<void> _invite(String phone) async {
    final ok = await confirmAction(
      context,
      title: 'Ce client n’a pas encore Tasko',
      message: 'Envoyer une invitation par SMS au ${phone.replaceFirst('+237', '+237 ')} ? '
          'Dès qu’il aura créé son compte, vous pourrez lui proposer la mission.',
      confirmLabel: 'Envoyer l’invitation',
    );
    if (!ok || !mounted) return;
    try {
      await ref.read(apiProvider).invite(phone);
      if (mounted) showSnack(context, 'Invitation envoyée.');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    }
  }

  Future<void> _submit() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    final price = parseAmount(_price.text);
    if (_milestones.isNotEmpty && _milestones.fold<int>(0, (s, m) => s + m.amount) != price) {
      showSnack(context, 'Le total des étapes doit être égal au prix.', error: true);
      return;
    }
    final phone = normalizeCameroonPhone(_phone.text)!;
    final ok = await confirmAction(
      context,
      title: 'Envoyer la proposition ?',
      message: 'Le client recevra « ${_title.text.trim()} » pour ${formatMoney(price)}. '
          'La mission démarre dès qu’il a payé : l’argent est alors bloqué chez Tasko '
          'et vous êtes sûr d’être payé.',
      confirmLabel: 'Oui, envoyer',
    );
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      final job = await ref.read(apiProvider).offerJob(
            clientPhone: phone,
            categoryId: _categoryId!,
            title: _title.text.trim(),
            description: _description.text.trim(),
            price: price,
            address: _address.text.trim(),
            scheduledAt: _scheduledAt,
            milestones: _milestones,
          );
      if (!mounted) return;
      showSnack(context, 'Proposition envoyée. Vous serez prévenu dès que le client paie.');
      context.pushReplacement('/provider-mode/mission/${job.id}');
    } catch (e) {
      if (!mounted) return;
      final canInvite = e is ApiException &&
          e.statusCode == 404 &&
          e.details is Map &&
          (e.details as Map)['can_invite'] == true;
      if (canInvite) {
        await _invite(phone);
      } else {
        showSnack(context, errorMessage(e), error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    final skills = user?.provider?.skills ?? const [];
    final all = ref.watch(categoriesProvider).value ?? const <Category>[];
    final options = <(String, String)>[
      for (final s in skills) (s.categoryId, s.name),
      if (skills.isEmpty)
        for (final c in all) ...[
          for (final child in c.children) (child.id, child.name),
          if (c.children.isEmpty) (c.id, c.name),
        ],
    ];
    final price = parseAmount(_price.text);
    final s = ref.watch(settingsValueProvider);
    final commission = (price * s.providerCommissionRate).round();
    return Scaffold(
      appBar: AppBar(title: const Text('Proposer une mission')),
      body: Column(
        children: [
          Expanded(
            child: Form(
              key: _form,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const InfoBox(
                    icon: Icons.handshake_outlined,
                    text: 'Vous êtes déjà d’accord avec un client ? Envoyez-lui la mission au prix convenu. '
                        'Il paie dans l’application : votre paiement est garanti.',
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(9),
                    ],
                    autovalidateMode: AutovalidateMode.onUserInteraction,
                    validator: (v) => normalizeCameroonPhone(v ?? '') == null
                        ? 'Numéro invalide (9 chiffres, commence par 6 ou 2)'
                        : null,
                    decoration: const InputDecoration(
                      labelText: 'Téléphone du client',
                      prefixText: '+237 ',
                      prefixIcon: Icon(Icons.phone),
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _categoryId,
                    isExpanded: true,
                    validator: (v) => v == null ? 'Choisissez le service.' : null,
                    decoration: const InputDecoration(labelText: 'Service'),
                    items: [
                      for (final (id, name) in options)
                        DropdownMenuItem(value: id, child: Text(name)),
                    ],
                    onChanged: (v) => setState(() => _categoryId = v),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _title,
                    textCapitalization: TextCapitalization.sentences,
                    autovalidateMode: AutovalidateMode.onUserInteraction,
                    validator: (v) => (v ?? '').trim().length < 3 ? 'Donnez un titre.' : null,
                    decoration: const InputDecoration(
                      labelText: 'Titre',
                      hintText: 'Ex. : Peinture du salon',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _description,
                    minLines: 3,
                    maxLines: 6,
                    textCapitalization: TextCapitalization.sentences,
                    autovalidateMode: AutovalidateMode.onUserInteraction,
                    validator: (v) =>
                        (v ?? '').trim().length < 5 ? 'Décrivez le travail convenu.' : null,
                    decoration: const InputDecoration(labelText: 'Ce qui est convenu'),
                  ),
                  const SizedBox(height: 12),
                  AmountField(
                    controller: _price,
                    label: 'Prix convenu',
                    onChanged: (_) => setState(() {}),
                    validator: (v) => parseAmount(v ?? '') < 500 ? 'Prix minimum : 500 FCFA.' : null,
                  ),
                  if (price > 0)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        'Vous recevrez ${formatMoney(price - commission)}.',
                        style: const TextStyle(color: TaskoColors.primary, fontSize: 14),
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
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _pickDate,
                    icon: const Icon(Icons.event),
                    label: Text(_scheduledAt == null
                        ? 'Date de la mission (optionnel)'
                        : 'Le ${formatDateTime(_scheduledAt)}'),
                  ),
                  const SizedBox(height: 12),
                  Theme(
                    data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                    child: ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      leading: const Icon(Icons.tune, color: TaskoColors.primary),
                      title: const Text('Options avancées',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: const Text('Paiement en plusieurs étapes',
                          style: TextStyle(fontSize: 13)),
                      children: [
                        MilestonesEditor(
                          initial: _milestones,
                          expectedTotal: price,
                          onChanged: (v) => _milestones = v,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          BottomActionBar(children: [
            TaskoButton(
              label: 'Envoyer la proposition',
              icon: Icons.send,
              loading: _busy,
              onPressed: _submit,
            ),
          ]),
        ],
      ),
    );
  }
}

