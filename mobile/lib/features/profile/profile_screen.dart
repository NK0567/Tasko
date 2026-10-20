import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/user.dart';
import '../../widgets/avatar.dart';
import '../../widgets/common.dart';
import '../../widgets/tasko_button.dart';
import '../home/shell_widgets.dart';
import '../provider_profile/provider_profile_screen.dart';

/// Onglet Profil (mon compte).
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  bool _uploadingAvatar = false;
  bool _uploadingPortfolio = false;

  Future<void> _changeAvatar() async {
    try {
      final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 800,
        imageQuality: 80,
      );
      if (file == null) return;
      setState(() => _uploadingAvatar = true);
      final user = await ref.read(apiProvider).uploadAvatar(await file.readAsBytes(), file.name);
      ref.read(authProvider.notifier).setUser(user);
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _uploadingAvatar = false);
    }
  }

  Future<void> _addPortfolio() async {
    final file = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 1600,
      imageQuality: 80,
    );
    if (file == null || !mounted) return;
    final title = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Nouvelle réalisation'),
        content: TextField(
          controller: title,
          decoration: const InputDecoration(hintText: 'Ex. : Réparation de fuite'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Ajouter')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _uploadingPortfolio = true);
    try {
      await ref.read(apiProvider).addPortfolio(
            await file.readAsBytes(),
            file.name,
            title.text.trim().isEmpty ? 'Réalisation' : title.text.trim(),
          );
      await ref.read(authProvider.notifier).refreshMe();
      if (mounted) showSnack(context, 'Réalisation ajoutée.');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _uploadingPortfolio = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final user = auth.user;
    if (user == null) return const LoadingView();
    final provider = user.provider;
    return Scaffold(
      appBar: AppBar(
        leading: const MenuButton(),
        title: const Text('Mon profil'),
        actions: [
          IconButton(
            tooltip: 'Paramètres',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push('/settings'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(authProvider.notifier).refreshMe(),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Center(
              child: Stack(
                children: [
                  TaskoAvatar(name: user.fullName, url: user.avatarUrl, size: 96),
                  Positioned(
                    right: 0,
                    bottom: 0,
                    child: InkWell(
                      onTap: _uploadingAvatar ? null : _changeAvatar,
                      child: CircleAvatar(
                        radius: 16,
                        backgroundColor: TaskoColors.primary,
                        child: _uploadingAvatar
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white),
                              )
                            : const Icon(Icons.camera_alt, size: 16, color: Colors.white),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Text(
              user.fullName,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: TaskoColors.primaryDark,
              ),
            ),
            Text(
              user.headline,
              textAlign: TextAlign.center,
              style: const TextStyle(color: TaskoColors.textMuted),
            ),
            const SizedBox(height: 4),
            Text(
              '${user.phone}${user.city == null ? '' : ' · ${user.city}'}',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12.5, color: TaskoColors.textMuted),
            ),
            const SizedBox(height: 14),
            _VerificationCard(level: user.verificationLevel),
            const SizedBox(height: 12),
            _AccountCard(user: user),
            const SizedBox(height: 16),
            if (provider == null)
              TaskoCard(
                color: TaskoColors.primaryDark,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Proposez vos compétences sur Tasko',
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Étudiant, artisan, débrouillard ? Recevez des missions près de chez vous et soyez payé via Mobile Money.',
                      style: TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                    const SizedBox(height: 12),
                    TaskoButton(
                      label: 'Devenir prestataire',
                      variant: TaskoButtonVariant.accent,
                      onPressed: () => context.push('/provider-mode/setup'),
                    ),
                  ],
                ),
              )
            else ...[
              _ProviderSection(
                user: user,
                profile: provider,
                uploadingPortfolio: _uploadingPortfolio,
                onAddPortfolio: _addPortfolio,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Compte entreprise + biens immobiliers.
class _AccountCard extends StatelessWidget {
  const _AccountCard({required this.user});
  final User user;

  @override
  Widget build(BuildContext context) {
    final business = user.business;
    return TaskoCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          ListTile(
            minTileHeight: 56,
            leading: const Icon(Icons.business_center_outlined, color: TaskoColors.primary),
            title: Text(user.isBusiness && business != null
                ? business.name
                : 'Passer en compte entreprise'),
            subtitle: Text(user.isBusiness && business != null
                ? businessKindLabel(business.kind)
                : 'Reçus à votre nom, appels d’offres, gestion de biens'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/business'),
          ),
          const Divider(height: 1),
          ListTile(
            minTileHeight: 56,
            leading: const Icon(Icons.apartment, color: TaskoColors.primary),
            title: const Text('Mes biens immobiliers'),
            subtitle: const Text('Interventions, dépenses, missions récurrentes'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/properties'),
          ),
        ],
      ),
    );
  }
}

/// Code Tasko du prestataire, à partager aux clients qui le connaissent déjà.
class PublicCodeCard extends StatelessWidget {
  const PublicCodeCard({super.key, required this.code, required this.name});
  final String code;
  final String name;

  String get _message =>
      'Retrouvez-moi sur Tasko avec mon code $code ($name). Paiement sécurisé par Mobile Money.';

  @override
  Widget build(BuildContext context) {
    return TaskoCard(
      color: TaskoColors.accent.withValues(alpha: 0.12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Mon code Tasko', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          SelectableText(code,
              style: const TextStyle(
                  fontSize: 24, fontWeight: FontWeight.w800, letterSpacing: 1.5,
                  color: TaskoColors.primaryDark)),
          const Text(
            'Donnez ce code à vos clients : ils vous retrouvent en un instant et vous envoient '
            'leurs demandes directement.',
            style: TextStyle(fontSize: 13.5, color: TaskoColors.textMuted),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              OutlinedButton.icon(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: code));
                  if (context.mounted) showSnack(context, 'Code copié.');
                },
                icon: const Icon(Icons.copy, size: 18),
                label: const Text('Copier'),
              ),
              OutlinedButton.icon(
                onPressed: () => launchUrl(
                  Uri.parse('https://wa.me/?text=${Uri.encodeComponent(_message)}'),
                  mode: LaunchMode.externalApplication,
                ),
                icon: const Icon(Icons.share_outlined, size: 18),
                label: const Text('Partager'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _VerificationCard extends StatelessWidget {
  const _VerificationCard({required this.level});
  final int level;

  static const _labels = {
    1: 'Compte créé',
    2: 'Téléphone vérifié',
    3: 'Identité vérifiée',
    4: 'Compétence vérifiée',
    5: 'Prestataire recommandé',
  };

  @override
  Widget build(BuildContext context) {
    return TaskoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.verified_user, color: TaskoColors.primary, size: 20),
              const SizedBox(width: 8),
              Text('Niveau de vérification $level/5',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              const Spacer(),
              Text(_labels[level] ?? '',
                  style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted)),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              for (var i = 1; i <= 5; i++)
                Expanded(
                  child: Container(
                    height: 6,
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    decoration: BoxDecoration(
                      color: i <= level ? TaskoColors.primary : TaskoColors.border,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ProviderSection extends StatelessWidget {
  const _ProviderSection({
    required this.user,
    required this.profile,
    required this.uploadingPortfolio,
    required this.onAddPortfolio,
  });

  final User user;
  final ProviderProfile profile;
  final bool uploadingPortfolio;
  final VoidCallback onAddPortfolio;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: TaskoColors.chip,
            borderRadius: BorderRadius.circular(TaskoRadius.card),
          ),
          child: Row(
            children: [
              _stat('${profile.missionsCompleted}', 'Missions'),
              _stat(formatRating(profile.ratingAvg), '${profile.ratingCount} avis'),
              _stat('${profile.completionRate} %', 'Réussite'),
              _stat(profile.isPro ? 'PRO' : 'Gratuit', 'Formule'),
            ],
          ),
        ),
        if (profile.publicCode != null) ...[
          const SizedBox(height: 12),
          PublicCodeCard(code: profile.publicCode!, name: user.fullName),
        ],
        const SizedBox(height: 16),
        SectionHeader(
          title: 'Ce que je sais faire',
          action: 'Modifier',
          onAction: () => context.push('/provider-mode/skills'),
        ),
        if (profile.skills.isEmpty)
          const Text('Aucune compétence renseignée.',
              style: TextStyle(color: TaskoColors.textMuted))
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final s in profile.skills)
                TaskoChip(label: '${s.name} · ${formatMoney(s.basePrice)}'),
            ],
          ),
        const SizedBox(height: 16),
        SectionHeader(
          title: 'Mes disponibilités',
          action: 'Modifier',
          onAction: () => context.push('/provider-mode/setup'),
        ),
        AvailabilityRow(days: profile.availableDays),
        const SizedBox(height: 16),
        SectionHeader(
          title: 'Mes réalisations',
          action: uploadingPortfolio ? 'Envoi…' : 'Ajouter',
          onAction: uploadingPortfolio ? null : onAddPortfolio,
        ),
        if (profile.portfolio.isEmpty)
          const Text('Ajoutez des photos de vos travaux pour rassurer vos clients.',
              style: TextStyle(color: TaskoColors.textMuted))
        else
          PortfolioStrip(items: profile.portfolio),
        const SizedBox(height: 20),
        TaskoButton(
          label: 'Voir mon profil public',
          variant: TaskoButtonVariant.outline,
          icon: Icons.visibility_outlined,
          onPressed: () => context.push('/provider/${user.id}'),
        ),
        const SizedBox(height: 10),
        TaskoButton(
          label: 'Tasko Pro & Boost',
          variant: TaskoButtonVariant.accent,
          icon: Icons.workspace_premium,
          onPressed: () => context.push('/provider-mode/offers'),
        ),
      ],
    );
  }

  Widget _stat(String value, String label) => Expanded(
        child: Column(
          children: [
            Text(value,
                style: const TextStyle(
                    fontWeight: FontWeight.w700, fontSize: 16, color: TaskoColors.primaryDark)),
            Text(label, style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted)),
          ],
        ),
      );
}
