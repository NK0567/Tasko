import 'package:flutter/material.dart';

import '../core/icon_map.dart';
import '../core/theme.dart';
import '../models/category.dart';
import 'common.dart';

/// Tuile de catégorie (grille de l'accueil) — icône + couleur venant de l'API.
class CategoryTile extends StatelessWidget {
  const CategoryTile({super.key, required this.category, this.onTap, this.selected = false});

  final Category category;
  final VoidCallback? onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final color = colorFromHex(category.color);
    return InkWell(
      borderRadius: BorderRadius.circular(TaskoRadius.card),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
        decoration: selected
            ? BoxDecoration(
                color: color.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(TaskoRadius.card),
                border: Border.all(color: color, width: 1.4),
              )
            : null,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CategoryIcon(icon: category.icon, color: color, size: 52),
            const SizedBox(height: 6),
            Text(
              category.name,
              maxLines: 2,
              textAlign: TextAlign.center,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11.5, height: 1.2, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }
}
