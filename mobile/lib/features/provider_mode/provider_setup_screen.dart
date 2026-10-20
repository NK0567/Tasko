import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/user.dart';
import '../../widgets/common.dart';
import '../../widgets/tasko_button.dart';
import '../provider_profile/provider_profile_screen.dart';

/// Onboarding prestataire : headline, bio, type, expérience, MoMo, disponibilités.
class ProviderSetupScreen extends ConsumerStatefulWidget {
  const ProviderSetupScreen({super.key});

  @override
  ConsumerState<ProviderSetupScreen> createState() => _ProviderSetupScreenState();
}

class _ProviderSetupScreenState extends ConsumerState<ProviderSetupScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _headline;
  late final TextEditingController _bio;
  late final TextEditingController _years;
  late final TextEditingController _momo;
  String _type = 'freelancer';
  String _operator = 'mtn';
  List<int> _days = [1, 2, 3, 4, 5, 6];
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    final p = user?.provider;
    _headline = TextEditingController(text: p?.headline ?? '');
    _bio = TextEditingController(text: p?.bio ?? '');
    _years = TextEditingController(text: '${p?.yearsExperience ?? 0}');
    final momo = p?.momoNumber ?? user?.phone ?? '';
    _momo = TextEditingController(text: momo.startsWith('+237') ? momo.substring(4) : momo);
    if (p != null) {
      _type = p.providerType;
      _operator = p.momoOperator ?? 'mtn';
      if (p.availableDays.isNotEmpty) _days = [...p.availableDays];
    }
  }

  @override
  void dispose() {
    _headline.dispose();
    _bio.dispose();
    _years.dispose();
    _momo.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (_days.isEmpty) {
      showSnack(context, 'Choisissez au moins un jour de disponibilité.', error: true);
      return;
    }
    final wasProvider = ref.read(authProvider).user?.isProvider ?? false;
    setState(() => _saving = true);
    try {
      final user = await ref.read(apiProvider).setupProvider(
            headline: _headline.text.trim(),
            bio: _bio.text.trim(),
            providerType: _type,
            yearsExperience: int.tryParse(_years.text) ?? 0,
            momoNumber: normalizeCameroonPhone(_momo.text)!,
            momoOperator: _operator,
            availableDays: _days..sort(),
          );
      final notifier = ref.read(authProvider.notifier);
      notifier.setUser(user);
      await notifier.setProviderMode(true);
      ref.read(shellTabProvider.notifier).set(0);
      if (!mounted) return;
      showSnack(context, 'Profil prestataire enregistré !');
      if (!wasProvider || (user.provider?.skills.isEmpty ?? true)) {
        context.pushReplacement('/provider-mode/skills?onboarding=1');
      } else {
        context.pop();
      }
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mon profil prestataire')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TaskoCard(
              color: TaskoColors.chip,
              child: const Row(
                children: [
                  Icon(Icons.rocket_launch_outlined, color: TaskoColors.primary),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Proposez vos compétences et gagnez de l’argent près de chez vous. '
                      'Vos gains sont versés sur votre Mobile Money.',
                      style: TextStyle(fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            const SectionHeader(title: 'Je suis…'),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final e in kProviderTypeLabels.entries)
                  TaskoChip(
                    label: e.value,
                    icon: switch (e.key) {
                      'artisan' => Icons.handyman_outlined,
                      'student' => Icons.school_outlined,
                      'professional' => Icons.business_center_outlined,
                      'company' => Icons.apartment_outlined,
                      _ => Icons.bolt_outlined,
                    },
                    selected: _type == e.key,
                    onTap: () => setState(() => _type = e.key),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _headline,
              decoration: const InputDecoration(
                labelText: 'Titre (ex. Plombier, Étudiant / Informaticien)',
                prefixIcon: Icon(Icons.badge_outlined),
              ),
              validator: (v) => (v ?? '').trim().length < 3 ? 'Indiquez votre métier' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _bio,
              minLines: 3,
              maxLines: 6,
              decoration: const InputDecoration(
                labelText: 'À propos de moi',
                hintText: 'Votre expérience, vos points forts, votre zone d’intervention…',
                alignLabelWithHint: true,
              ),
              validator: (v) => (v ?? '').trim().length < 10 ? 'Présentez-vous en quelques mots' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _years,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Années d’expérience',
                prefixIcon: Icon(Icons.timeline),
              ),
            ),
            const SizedBox(height: 20),
            const SectionHeader(title: 'Paiement de mes gains'),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: _OperatorOption(
                    label: 'MTN MoMo',
                    color: TaskoColors.mtn,
                    selected: _operator == 'mtn',
                    onTap: () => setState(() => _operator = 'mtn'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _OperatorOption(
                    label: 'Orange Money',
                    color: TaskoColors.orange,
                    selected: _operator == 'orange',
                    onTap: () => setState(() => _operator = 'orange'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _momo,
              keyboardType: TextInputType.phone,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(9),
              ],
              decoration: const InputDecoration(
                labelText: 'Numéro Mobile Money',
                prefixText: '+237 ',
                prefixIcon: Icon(Icons.phone_android),
              ),
              validator: (v) => normalizeCameroonPhone(v ?? '') == null ? 'Numéro invalide' : null,
            ),
            const SizedBox(height: 20),
            const SectionHeader(title: 'Mes disponibilités'),
            const SizedBox(height: 8),
            AvailabilityRow(
              days: _days,
              onToggle: (d) => setState(() {
                _days.contains(d) ? _days.remove(d) : _days.add(d);
              }),
            ),
            const SizedBox(height: 28),
            TaskoButton(label: 'Continuer', loading: _saving, onPressed: _save),
          ],
        ),
      ),
    );
  }
}

class _OperatorOption extends StatelessWidget {
  const _OperatorOption({
    required this.label,
    required this.color,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final Color color;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(TaskoRadius.button),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(TaskoRadius.button),
          color: selected ? color.withValues(alpha: 0.15) : Colors.white,
          border: Border.all(color: selected ? color : TaskoColors.border, width: selected ? 2 : 1),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircleAvatar(radius: 8, backgroundColor: color),
            const SizedBox(width: 8),
            Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}
