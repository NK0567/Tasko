import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Drapeau du Cameroun dessiné (vert / rouge / jaune + étoile jaune).
///
/// Remplace l'emoji drapeau, non rendu par les polices web (carré « tofu »).
class CameroonFlag extends StatelessWidget {
  const CameroonFlag({super.key, this.width = 24});
  final double width;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Cameroun',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(width * 0.08),
        child: CustomPaint(
          size: Size(width, width * 2 / 3),
          painter: const CameroonFlagPainter(),
        ),
      ),
    );
  }
}

class CameroonFlagPainter extends CustomPainter {
  const CameroonFlagPainter();

  static const green = Color(0xFF007A5E);
  static const red = Color(0xFFCE1126);
  static const yellow = Color(0xFFFCD116);

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width / 3;
    canvas.drawRect(Rect.fromLTWH(0, 0, w, size.height), Paint()..color = green);
    canvas.drawRect(Rect.fromLTWH(w, 0, w, size.height), Paint()..color = red);
    canvas.drawRect(Rect.fromLTWH(2 * w, 0, size.width - 2 * w, size.height),
        Paint()..color = yellow);
    // Étoile à cinq branches au centre de la bande rouge.
    final center = Offset(size.width / 2, size.height / 2);
    final outer = size.height * 0.22;
    final inner = outer * 0.382;
    final path = Path();
    for (var i = 0; i < 10; i++) {
      final r = i.isEven ? outer : inner;
      final angle = -math.pi / 2 + i * math.pi / 5;
      final p = center + Offset(r * math.cos(angle), r * math.sin(angle));
      if (i == 0) {
        path.moveTo(p.dx, p.dy);
      } else {
        path.lineTo(p.dx, p.dy);
      }
    }
    path.close();
    canvas.drawPath(path, Paint()..color = yellow);
  }

  @override
  bool shouldRepaint(covariant CameroonFlagPainter oldDelegate) => false;
}
