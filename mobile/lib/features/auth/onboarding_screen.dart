import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../widgets/illustrations.dart';
import '../../widgets/tasko_button.dart';

class _Page {
  final String asset;
  final String title;
  final String body;
  const _Page(this.asset, this.title, this.body);
}

const _pages = [
  _Page(
    Illustrations.provider,
    "Besoin d'aide ?\nTrouvez un professionnel près de chez vous !",
    'Plomberie, ménage, beauté, courses, chantier, études, informatique… et bien plus !',
  ),
  _Page(
    Illustrations.map,
    'Suivez votre prestataire en temps réel',
    'Voyez sur la carte où il se trouve, son heure d’arrivée estimée, et discutez avec lui dans le chat.',
  ),
  _Page(
    Illustrations.payment,
    'Payez en toute sécurité via Mobile Money',
    'MTN MoMo ou Orange Money : votre argent reste bloqué en sécurité chez Tasko et n’est versé que quand vous validez le travail.',
  ),
  _Page(
    Illustrations.community,
    'Proposez vos compétences et gagnez de l’argent',
    'Étudiants, artisans, débrouillards : basculez en mode Prestataire et recevez des missions près de chez vous.',
  ),
];

/// Écran 2 — Onboarding en 4 pages avec indicateurs.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _controller = PageController();
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await ref.read(authProvider.notifier).setOnboardingDone();
    if (mounted) context.go('/register');
  }

  @override
  Widget build(BuildContext context) {
    final last = _index == _pages.length - 1;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Column(
              children: [
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(onPressed: _finish, child: const Text('Passer')),
                ),
                Expanded(
                  child: PageView.builder(
                    controller: _controller,
                    itemCount: _pages.length,
                    onPageChanged: (i) => setState(() => _index = i),
                    itemBuilder: (_, i) {
                      final p = _pages[i];
                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Center(
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(28),
                                  child: Illustrations.svg(p.asset, fit: BoxFit.contain),
                                ),
                              ),
                            ),
                            const SizedBox(height: 24),
                            Text(
                              p.title,
                              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    color: TaskoColors.primaryDark,
                                    height: 1.25,
                                  ),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              p.body,
                              style: const TextStyle(color: TaskoColors.textMuted, height: 1.5),
                            ),
                            const SizedBox(height: 12),
                          ],
                        ),
                      );
                    },
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(
                    _pages.length,
                    (i) => AnimatedContainer(
                      duration: const Duration(milliseconds: 250),
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      width: i == _index ? 22 : 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: i == _index ? TaskoColors.primary : TaskoColors.chipBorder,
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
                  child: TaskoButton(
                    label: last ? 'Créer mon compte' : 'Suivant',
                    onPressed: () {
                      if (last) {
                        _finish();
                      } else {
                        _controller.nextPage(
                          duration: const Duration(milliseconds: 300),
                          curve: Curves.easeOut,
                        );
                      }
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
