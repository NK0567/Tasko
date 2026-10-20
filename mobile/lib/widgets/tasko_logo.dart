import 'package:flutter/material.dart';

import '../core/theme.dart';
import 'illustrations.dart';

/// Logo Tasko : pin vert à centre jaune + texte « Tasko » vert foncé.
class TaskoLogo extends StatelessWidget {
  const TaskoLogo({
    super.key,
    this.size = 28,
    this.showText = true,
    this.vertical = false,
    this.textColor = TaskoColors.primaryDark,
  });

  final double size;
  final bool showText;
  final bool vertical;
  final Color textColor;

  @override
  Widget build(BuildContext context) {
    final pin = Illustrations.svg(Illustrations.logoPin, width: size * 0.8, height: size);
    if (!showText) return pin;
    final text = Text(
      'Tasko',
      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
            fontSize: vertical ? size * 0.9 : size * 0.85,
            fontWeight: FontWeight.w700,
            color: textColor,
            letterSpacing: -0.5,
            height: 1.0,
          ),
    );
    if (vertical) {
      return Column(mainAxisSize: MainAxisSize.min, children: [pin, const SizedBox(height: 8), text]);
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [pin, SizedBox(width: size * 0.2), text],
    );
  }
}
