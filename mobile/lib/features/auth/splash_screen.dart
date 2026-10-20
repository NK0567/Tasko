import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../widgets/illustrations.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/tasko_logo.dart';

/// Écran 1 — Démarrage : logo, slogan, skyline, 4 pictos, « Commencer ».
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key, this.onStart, this.onLogin});

  final VoidCallback? onStart;
  final VoidCallback? onLogin;

  static const _features = [
    (Icons.handyman_outlined, 'Demande\nun service'),
    (Icons.work_outline, 'Trouve\nun job'),
    (Icons.phone_android, 'Paie en\nligne'),
    (Icons.verified_user_outlined, "C'est\nsécurisé"),
  ];

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Scaffold(
      backgroundColor: const Color(0xFFFFF6D6),
      body: Stack(
        children: [
          Positioned.fill(
            child: Illustrations.svg(
              Illustrations.skyline,
              fit: BoxFit.cover,
              alignment: Alignment.bottomCenter,
            ),
          ),
          // Dégradé vert foncé en bas, comme sur la maquette.
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  stops: const [0.0, 0.35, 0.62, 1.0],
                  colors: [
                    Colors.white.withValues(alpha: 0.92),
                    Colors.white.withValues(alpha: 0.55),
                    TaskoColors.primaryDark.withValues(alpha: 0.55),
                    TaskoColors.primaryDark,
                  ],
                ),
              ),
            ),
          ),
          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Column(
                    children: [
                      const Spacer(flex: 2),
                      const TaskoLogo(size: 64, vertical: true),
                      const SizedBox(height: 14),
                      Text(
                        'La marketplace des services, compétences\net petits jobs du quotidien.',
                        textAlign: TextAlign.center,
                        style: textTheme.bodyMedium?.copyWith(
                          color: TaskoColors.primary,
                          fontWeight: FontWeight.w600,
                          height: 1.4,
                        ),
                      ),
                      const Spacer(flex: 5),
                      Row(
                        children: [
                          for (final f in _features)
                            Expanded(
                              child: Column(
                                children: [
                                  Container(
                                    width: 46,
                                    height: 46,
                                    decoration: BoxDecoration(
                                      color: Colors.white.withValues(alpha: 0.14),
                                      borderRadius: BorderRadius.circular(14),
                                      border: Border.all(color: Colors.white24),
                                    ),
                                    child: Icon(f.$1, color: TaskoColors.accent, size: 24),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    f.$2,
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 11.5,
                                      height: 1.25,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 26),
                      TaskoButton(label: 'Commencer', onPressed: onStart),
                      const SizedBox(height: 10),
                      TextButton(
                        onPressed: onLogin,
                        child: Text.rich(
                          TextSpan(
                            text: 'Déjà un compte ? ',
                            style: const TextStyle(color: Colors.white70),
                            children: [
                              TextSpan(
                                text: 'Se connecter',
                                style: TextStyle(
                                  color: TaskoColors.accent.withValues(alpha: 0.95),
                                  fontWeight: FontWeight.w600,
                                  decoration: TextDecoration.underline,
                                  decorationColor: TaskoColors.accent,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
