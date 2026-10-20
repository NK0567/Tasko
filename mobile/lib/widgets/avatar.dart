import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../core/config.dart';
import '../core/formatters.dart';
import '../core/theme.dart';

/// Couleurs des avatars par initiales (déterministes selon le nom).
const List<Color> kAvatarPalette = [
  Color(0xFF0F7A3D),
  Color(0xFF2F80ED),
  Color(0xFFE91E63),
  Color(0xFFF59E0B),
  Color(0xFF7B61FF),
  Color(0xFF00A3A3),
  Color(0xFFEF6C00),
  Color(0xFF0B3D2E),
  Color(0xFF8E24AA),
  Color(0xFF6D4C41),
];

Color avatarColorFor(String? seed) {
  final s = seed ?? '';
  var hash = 0;
  for (final c in s.codeUnits) {
    hash = (hash * 31 + c) & 0x7fffffff;
  }
  return kAvatarPalette[hash % kAvatarPalette.length];
}

/// Avatar rond : photo si `avatar_url`, sinon initiales colorées.
class TaskoAvatar extends StatelessWidget {
  const TaskoAvatar({
    super.key,
    required this.name,
    this.url,
    this.size = 44,
    this.online,
    this.borderColor,
  });

  final String? name;
  final String? url;
  final double size;
  final bool? online;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final color = avatarColorFor(name);
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [color.withValues(alpha: 0.85), color],
        ),
      ),
      child: Text(
        initialsOf(name),
        style: TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w600,
          fontSize: size * 0.38,
        ),
      ),
    );
    final resolved = AppConfig.mediaUrl(url);
    Widget image = resolved == null
        ? fallback
        : ClipOval(
            child: CachedNetworkImage(
              imageUrl: resolved,
              width: size,
              height: size,
              fit: BoxFit.cover,
              placeholder: (_, _) => fallback,
              errorWidget: (_, _, _) => fallback,
            ),
          );
    if (borderColor != null) {
      image = Container(
        padding: const EdgeInsets.all(2),
        decoration: BoxDecoration(shape: BoxShape.circle, color: borderColor),
        child: image,
      );
    }
    if (online == null) return image;
    final dot = size * 0.26;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        image,
        Positioned(
          right: 0,
          bottom: 0,
          child: Container(
            width: dot,
            height: dot,
            decoration: BoxDecoration(
              color: online! ? TaskoColors.primaryLight : Colors.grey,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2),
            ),
          ),
        ),
      ],
    );
  }
}
