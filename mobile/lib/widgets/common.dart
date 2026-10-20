import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/formatters.dart';
import '../core/icon_map.dart';
import '../core/theme.dart';
import '../models/job.dart';
import 'illustrations.dart';
import 'tasko_button.dart';

/// Étoiles de notation (affichage ou saisie).
class RatingStars extends StatelessWidget {
  const RatingStars({
    super.key,
    required this.rating,
    this.size = 16,
    this.onChanged,
    this.color = TaskoColors.accent,
  });

  final double rating;
  final double size;
  final ValueChanged<int>? onChanged;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (i) {
        final v = i + 1;
        final icon = rating >= v
            ? Icons.star_rounded
            : rating >= v - 0.5
                ? Icons.star_half_rounded
                : Icons.star_outline_rounded;
        final star = Icon(icon, size: size, color: color);
        if (onChanged == null) return star;
        return InkWell(
          customBorder: const CircleBorder(),
          onTap: () => onChanged!(v),
          child: Padding(padding: const EdgeInsets.all(4), child: star),
        );
      }),
    );
  }
}

/// Note compacte « ★ 4,8 (23 avis) ».
class RatingLabel extends StatelessWidget {
  const RatingLabel({super.key, required this.rating, this.count, this.fontSize = 13});
  final double rating;
  final int? count;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.star_rounded, size: fontSize + 3, color: TaskoColors.accent),
        const SizedBox(width: 2),
        Text(
          formatRating(rating),
          style: TextStyle(fontWeight: FontWeight.w600, fontSize: fontSize),
        ),
        if (count != null)
          Text(
            ' ($count avis)',
            style: TextStyle(color: TaskoColors.textMuted, fontSize: fontSize - 1),
          ),
      ],
    );
  }
}

/// Badge de statut de mission coloré.
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status, this.label});
  final String status;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final color = JobStatus.color(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label ?? JobStatus.label(status),
        style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 12),
      ),
    );
  }
}

/// Montant formaté « 5 000 FCFA ».
class MoneyText extends StatelessWidget {
  const MoneyText(this.amount, {super.key, this.style, this.color, this.size});
  final num? amount;
  final TextStyle? style;
  final Color? color;
  final double? size;

  @override
  Widget build(BuildContext context) {
    final base = style ?? const TextStyle(fontWeight: FontWeight.w700);
    return Text(
      formatMoney(amount),
      style: base.copyWith(color: color ?? base.color, fontSize: size ?? base.fontSize),
    );
  }
}

/// Puce verte claire.
class TaskoChip extends StatelessWidget {
  const TaskoChip({
    super.key,
    required this.label,
    this.icon,
    this.selected = false,
    this.onTap,
    this.color = TaskoColors.primary,
  });

  final String label;
  final IconData? icon;
  final bool selected;
  final VoidCallback? onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? Colors.white : color;
    return Material(
      color: selected ? color : color.withValues(alpha: 0.10),
      borderRadius: BorderRadius.circular(TaskoRadius.chip),
      child: InkWell(
        borderRadius: BorderRadius.circular(TaskoRadius.chip),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 15, color: fg), const SizedBox(width: 5)],
              Text(
                label,
                style: TextStyle(color: fg, fontSize: 12.5, fontWeight: FontWeight.w500),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Titre de section avec action optionnelle (« Tout voir »).
class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.action, this.onAction});
  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w600, color: TaskoColors.primaryDark),
          ),
        ),
        if (action != null)
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(0, 32),
            ),
            child: Text(action!, style: const TextStyle(fontSize: 13)),
          ),
      ],
    );
  }
}

/// Icône ronde de catégorie (clé Material + couleur).
class CategoryIcon extends StatelessWidget {
  const CategoryIcon({super.key, required this.icon, this.color, this.size = 48});
  final String? icon;
  final Color? color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = color ?? TaskoColors.primary;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(size * 0.3),
      ),
      child: Icon(iconForKey(icon), color: c, size: size * 0.52),
    );
  }
}

/// Carte blanche arrondie 16 px.
class TaskoCard extends StatelessWidget {
  const TaskoCard({super.key, required this.child, this.padding, this.onTap, this.color});
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color ?? Colors.white,
      borderRadius: BorderRadius.circular(TaskoRadius.card),
      child: InkWell(
        borderRadius: BorderRadius.circular(TaskoRadius.card),
        onTap: onTap,
        child: Container(
          padding: padding ?? const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(TaskoRadius.card),
            border: Border.all(color: TaskoColors.border),
          ),
          child: child,
        ),
      ),
    );
  }
}

/// Ligne « libellé ……… valeur » pour les récapitulatifs.
class AmountRow extends StatelessWidget {
  const AmountRow({super.key, required this.label, required this.amount, this.bold = false});
  final String label;
  final num amount;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
      fontSize: bold ? 16 : 14,
      color: bold ? TaskoColors.primaryDark : TaskoColors.text,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(formatMoney(amount), style: style),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// États chargement / erreur / vide
// ---------------------------------------------------------------------------

class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.message});
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(color: TaskoColors.primary),
          if (message != null) ...[
            const SizedBox(height: 12),
            Text(message!, style: const TextStyle(color: TaskoColors.textMuted)),
          ],
        ],
      ),
    );
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry, this.compact = false});
  final Object error;
  final VoidCallback? onRetry;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final api = error is ApiException ? error as ApiException : null;
    final offline = api?.isNetwork ?? false;
    final message = offline
        ? 'Pas de connexion. Vérifiez votre réseau puis réessayez — votre saisie est conservée.'
        : (api?.message ?? 'Une erreur est survenue.');
    final content = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(offline ? Icons.wifi_off_rounded : Icons.error_outline,
            size: compact ? 32 : 56, color: TaskoColors.textMuted),
        const SizedBox(height: 10),
        Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: TaskoColors.textMuted),
        ),
        if (onRetry != null) ...[
          const SizedBox(height: 14),
          TaskoButton(
            label: 'Réessayer',
            icon: Icons.refresh,
            expand: false,
            height: 44,
            variant: TaskoButtonVariant.light,
            onPressed: onRetry,
          ),
        ],
      ],
    );
    return Center(
      child: Padding(padding: const EdgeInsets.all(24), child: content),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.compact = false,
  });

  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Illustrations.svg(Illustrations.emptyBox, width: compact ? 90 : 150),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
            ),
            if (message != null) ...[
              const SizedBox(height: 6),
              Text(
                message!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: TaskoColors.textMuted),
              ),
            ],
            if (actionLabel != null) ...[
              const SizedBox(height: 16),
              TaskoButton(label: actionLabel!, expand: false, onPressed: onAction),
            ],
          ],
        ),
      ),
    );
  }
}

/// Affiche un [AsyncValue] avec les trois états standard.
class AsyncView<T> extends StatelessWidget {
  const AsyncView({
    super.key,
    required this.value,
    required this.data,
    this.onRetry,
    this.loadingMessage,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback? onRetry;
  final String? loadingMessage;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: true,
      skipLoadingOnReload: true,
      data: data,
      loading: () => LoadingView(message: loadingMessage),
      error: (e, _) => ErrorView(error: e, onRetry: onRetry),
    );
  }
}

void showSnack(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? TaskoColors.danger : TaskoColors.primaryDark,
      ),
    );
}

String errorMessage(Object e) {
  if (e is ApiException) {
    if (e.isNetwork) return 'Pas de connexion. Vérifiez votre réseau puis réessayez.';
    return e.message;
  }
  return 'Une erreur est survenue. Réessayez.';
}

/// Vrai si l'erreur signale une mission déjà attribuée à un autre prestataire (409).
bool isAlreadyAssigned(Object e) =>
    e is ApiException && (e.statusCode == 409 || e.code == 'CONFLICT');

/// Message à l'acceptation d'une mission : « Mission déjà attribuée » sur un 409.
String acceptErrorMessage(Object e) => isAlreadyAssigned(e)
    ? 'Mission déjà attribuée : un autre prestataire a été plus rapide.'
    : errorMessage(e);
