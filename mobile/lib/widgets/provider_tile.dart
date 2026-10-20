import 'package:flutter/material.dart';

import '../core/formatters.dart';
import '../core/theme.dart';
import '../models/provider_card.dart';
import 'avatar.dart';
import 'common.dart';

/// Carte « ProviderCard » : prestataire recommandé / résultat de recherche.
class ProviderTile extends StatelessWidget {
  const ProviderTile({super.key, required this.provider, this.onTap, this.trailing});

  final ProviderCard provider;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final p = provider;
    return TaskoCard(
      onTap: onTap,
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          TaskoAvatar(name: p.fullName, url: p.avatarUrl, size: 54, online: p.isOnline),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        p.fullName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                      ),
                    ),
                    if (p.verificationLevel >= 3) ...[
                      const SizedBox(width: 4),
                      const Icon(Icons.verified, size: 16, color: TaskoColors.info),
                    ],
                    if (p.isPro) ...[
                      const SizedBox(width: 4),
                      const _MiniBadge(label: 'PRO', color: TaskoColors.accent),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  p.headline.isEmpty
                      ? (p.skills.isEmpty ? 'Prestataire' : p.skills.first)
                      : p.headline,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: TaskoColors.textMuted, fontSize: 13),
                ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 10,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    RatingLabel(rating: p.ratingAvg, count: p.ratingCount, fontSize: 12),
                    if (p.distanceKm != null)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.place_outlined, size: 14, color: TaskoColors.textMuted),
                          Text(
                            formatDistance(p.distanceKm),
                            style: const TextStyle(fontSize: 12, color: TaskoColors.textMuted),
                          ),
                        ],
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          trailing ??
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (p.minPrice != null) ...[
                    const Text('dès', style: TextStyle(fontSize: 11, color: TaskoColors.textMuted)),
                    MoneyText(
                      p.minPrice,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        color: TaskoColors.primary,
                        fontSize: 13,
                      ),
                    ),
                  ],
                  if (p.etaMin != null)
                    Text(
                      '~${p.etaMin} min',
                      style: const TextStyle(fontSize: 11, color: TaskoColors.textMuted),
                    ),
                ],
              ),
        ],
      ),
    );
  }
}

class _MiniBadge extends StatelessWidget {
  const _MiniBadge({required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(6)),
        child: Text(
          label,
          style: const TextStyle(
            fontSize: 9,
            fontWeight: FontWeight.w700,
            color: TaskoColors.primaryDark,
          ),
        ),
      );
}
