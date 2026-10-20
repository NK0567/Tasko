import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';

import '../core/config.dart';
import '../core/theme.dart';
import 'avatar.dart';

/// Couche de tuiles OpenStreetMap (sans clé).
TileLayer osmTileLayer() => TileLayer(
      urlTemplate: AppConfig.tileUrl,
      userAgentPackageName: AppConfig.userAgentPackage,
      maxZoom: 19,
    );

/// Attribution OSM obligatoire.
Widget osmAttribution() => const Align(
      alignment: Alignment.bottomLeft,
      child: Padding(
        padding: EdgeInsets.all(4),
        child: DecoratedBox(
          decoration: BoxDecoration(color: Color(0xB3FFFFFF)),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 4, vertical: 1),
            child: Text('© OpenStreetMap', style: TextStyle(fontSize: 9)),
          ),
        ),
      ),
    );

/// Point bleu « ma position ».
class MyPositionDot extends StatelessWidget {
  const MyPositionDot({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: TaskoColors.info.withValues(alpha: 0.2),
      ),
      alignment: Alignment.center,
      child: Container(
        width: 16,
        height: 16,
        decoration: BoxDecoration(
          color: TaskoColors.info,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4)],
        ),
      ),
    );
  }
}

/// Pin avatar d'un prestataire sur la carte.
class AvatarPin extends StatelessWidget {
  const AvatarPin({
    super.key,
    required this.name,
    this.url,
    this.selected = false,
    this.online = true,
  });

  final String name;
  final String? url;
  final bool selected;
  final bool online;

  @override
  Widget build(BuildContext context) {
    final color = selected ? TaskoColors.accent : (online ? TaskoColors.primary : Colors.grey);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 6, offset: Offset(0, 2))],
          ),
          child: TaskoAvatar(name: name, url: url, size: selected ? 40 : 34),
        ),
        CustomPaint(size: const Size(12, 8), painter: _TrianglePainter(color)),
      ],
    );
  }
}

/// Pin de destination (vert à centre jaune, comme le logo).
class DestinationPin extends StatelessWidget {
  const DestinationPin({super.key, this.size = 40});
  final double size;

  @override
  Widget build(BuildContext context) {
    return Icon(Icons.location_on, color: TaskoColors.primary, size: size, shadows: const [
      Shadow(color: Colors.black26, blurRadius: 6),
    ]);
  }
}

class _TrianglePainter extends CustomPainter {
  _TrianglePainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(covariant _TrianglePainter old) => old.color != color;
}
