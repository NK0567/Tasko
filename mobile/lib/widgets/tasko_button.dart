import 'package:flutter/material.dart';

import '../core/theme.dart';

enum TaskoButtonVariant { primary, outline, light, accent, danger }

/// Bouton plein vert arrondi (avec état de chargement).
class TaskoButton extends StatelessWidget {
  const TaskoButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.loading = false,
    this.variant = TaskoButtonVariant.primary,
    this.expand = true,
    this.height = 52,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;
  final TaskoButtonVariant variant;
  final bool expand;
  final double height;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, border) = switch (variant) {
      TaskoButtonVariant.primary => (TaskoColors.primary, Colors.white, null),
      TaskoButtonVariant.outline => (Colors.white, TaskoColors.primary, TaskoColors.primary),
      TaskoButtonVariant.light => (TaskoColors.chip, TaskoColors.primary, null),
      TaskoButtonVariant.accent => (TaskoColors.accent, TaskoColors.primaryDark, null),
      TaskoButtonVariant.danger => (Colors.white, TaskoColors.danger, TaskoColors.danger),
    };
    final child = loading
        ? SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2.4, color: fg),
          )
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: 8)],
              Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
            ],
          );
    final button = ElevatedButton(
      onPressed: loading ? null : onPressed,
      style: ElevatedButton.styleFrom(
        backgroundColor: bg,
        foregroundColor: fg,
        disabledBackgroundColor: bg.withValues(alpha: 0.55),
        disabledForegroundColor: fg.withValues(alpha: 0.8),
        minimumSize: Size(expand ? double.infinity : 64, height),
        padding: const EdgeInsets.symmetric(horizontal: 18),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TaskoRadius.button),
          side: border == null ? BorderSide.none : BorderSide(color: border, width: 1.4),
        ),
      ),
      child: child,
    );
    return button;
  }
}
