import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Palette Tasko (fidèle à la maquette).
class TaskoColors {
  TaskoColors._();

  static const Color primary = Color(0xFF0F7A3D);
  static const Color primaryDark = Color(0xFF0B3D2E);
  static const Color primaryLight = Color(0xFF23A455);
  static const Color accent = Color(0xFFF5B700);
  static const Color chip = Color(0xFFE7F5EC);
  static const Color chipBorder = Color(0xFFCDEBD8);
  static const Color background = Color(0xFFFFFFFF);
  static const Color surfaceMuted = Color(0xFFF6F8F7);
  static const Color border = Color(0xFFE6EBE8);
  static const Color text = Color(0xFF16231D);
  static const Color textMuted = Color(0xFF6B7A72);
  static const Color danger = Color(0xFFE53935);
  static const Color info = Color(0xFF2F80ED);
  static const Color warning = Color(0xFFF59E0B);
  static const Color bubbleOther = Color(0xFFF1F3F2);
  static const Color mtn = Color(0xFFFFCC00);
  static const Color orange = Color(0xFFFF7900);
}

/// Couleurs de statut partagées par toute l'app.
class StatusColors {
  StatusColors._();
  static const ok = Color(0xFF0F7A3D);
  static const waiting = Color(0xFFD97706);
  static const problem = Color(0xFFE53935);
  static const closed = Color(0xFF6B7A72);
}

class TaskoRadius {
  TaskoRadius._();
  static const double card = 16;
  static const double button = 14;
  static const double chip = 20;
}

class TaskoTheme {
  TaskoTheme._();

  /// [useGoogleFonts] vaut `false` dans les tests (pas d'accès réseau).
  static ThemeData light({bool useGoogleFonts = true}) {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: TaskoColors.primary,
        primary: TaskoColors.primary,
        secondary: TaskoColors.accent,
        surface: TaskoColors.background,
        error: TaskoColors.danger,
      ),
      scaffoldBackgroundColor: TaskoColors.background,
    );
    final textTheme0 = (useGoogleFonts
            ? GoogleFonts.poppinsTextTheme(base.textTheme)
            : base.textTheme)
        .apply(bodyColor: TaskoColors.text, displayColor: TaskoColors.text);
    // Lisibilité : corps de texte 15–16 sp (respecte l'échelle de police du système).
    final textTheme = textTheme0.copyWith(
      bodyLarge: textTheme0.bodyLarge?.copyWith(fontSize: 16),
      bodyMedium: textTheme0.bodyMedium?.copyWith(fontSize: 15),
      bodySmall: textTheme0.bodySmall?.copyWith(fontSize: 13),
    );

    return base.copyWith(
      textTheme: textTheme,
      appBarTheme: AppBarTheme(
        backgroundColor: TaskoColors.background,
        foregroundColor: TaskoColors.primaryDark,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        titleTextStyle: textTheme.titleMedium?.copyWith(
          fontWeight: FontWeight.w600,
          color: TaskoColors.primaryDark,
          fontSize: 18,
        ),
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TaskoRadius.card),
          side: const BorderSide(color: TaskoColors.border),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: TaskoColors.primary,
          foregroundColor: Colors.white,
          elevation: 0,
          minimumSize: const Size(64, 52),
          textStyle: textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(TaskoRadius.button),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: TaskoColors.primary,
          minimumSize: const Size(64, 52),
          side: const BorderSide(color: TaskoColors.primary, width: 1.4),
          textStyle: textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(TaskoRadius.button),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: TaskoColors.primary),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: TaskoColors.surfaceMuted,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TaskoRadius.button),
          borderSide: const BorderSide(color: TaskoColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TaskoRadius.button),
          borderSide: const BorderSide(color: TaskoColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TaskoRadius.button),
          borderSide: const BorderSide(color: TaskoColors.primary, width: 1.5),
        ),
        hintStyle: const TextStyle(color: TaskoColors.textMuted, fontSize: 14),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: TaskoColors.chip,
        selectedColor: TaskoColors.primary,
        side: BorderSide.none,
        labelStyle: textTheme.bodySmall?.copyWith(
          color: TaskoColors.primary,
          fontWeight: FontWeight.w500,
        ),
        secondaryLabelStyle: textTheme.bodySmall?.copyWith(color: Colors.white),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TaskoRadius.chip),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? Colors.white : null,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? TaskoColors.primary : null,
        ),
      ),
      tabBarTheme: const TabBarThemeData(
        labelColor: TaskoColors.primary,
        unselectedLabelColor: TaskoColors.textMuted,
        indicatorColor: TaskoColors.primary,
      ),
      dividerTheme: const DividerThemeData(color: TaskoColors.border, space: 1),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}
