import 'package:intl/intl.dart';

/// Espace insécable utilisée pour les montants (« 5 000 FCFA »).
const String nbsp = ' ';

final NumberFormat _moneyFormat = NumberFormat('#,##0', 'fr');

/// Formate un montant entier en FCFA : `5000` → « 5 000 FCFA ».
String formatMoney(num? amount, {bool withCurrency = true}) {
  final value = (amount ?? 0).round();
  // intl « fr » utilise une espace fine insécable (U+202F) : on la normalise.
  final digits = _moneyFormat
      .format(value)
      .replaceAll(' ', nbsp)
      .replaceAll(' ', nbsp);
  return withCurrency ? '$digits${nbsp}FCFA' : digits;
}

/// Distance lisible : 0.45 → « 450 m », 2.3 → « 2,3 km ».
String formatDistance(num? km) {
  if (km == null) return '';
  if (km < 1) {
    final m = (km * 1000).round();
    return '$m${nbsp}m';
  }
  final rounded = km >= 10 ? km.round().toString() : km.toStringAsFixed(1);
  return '${rounded.replaceAll('.', ',')}${nbsp}km';
}

/// Note : 4.75 → « 4,8 ».
String formatRating(num? rating) =>
    (rating ?? 0).toDouble().toStringAsFixed(1).replaceAll('.', ',');

/// Temps relatif en français : « À l'instant », « Il y a 5 min », « Il y a 2 h »…
String formatRelative(DateTime? date, {DateTime? now}) {
  if (date == null) return '';
  final ref = now ?? DateTime.now();
  final diff = ref.difference(date.toLocal());
  if (diff.inSeconds < 60) return "À l'instant";
  if (diff.inMinutes < 60) return 'Il y a ${diff.inMinutes} min';
  if (diff.inHours < 24) return 'Il y a ${diff.inHours} h';
  if (diff.inDays == 1) return 'Hier';
  if (diff.inDays < 7) return 'Il y a ${diff.inDays} j';
  final d = date.toLocal();
  return '${_two(d.day)}/${_two(d.month)}/${d.year}';
}

/// Heure « 10:24 ».
String formatTime(DateTime? date) {
  if (date == null) return '';
  final d = date.toLocal();
  return '${_two(d.hour)}:${_two(d.minute)}';
}

/// Date « 12/04/2026 à 10:24 ».
String formatDateTime(DateTime? date) {
  if (date == null) return '';
  final d = date.toLocal();
  return '${_two(d.day)}/${_two(d.month)}/${d.year} à ${formatTime(d)}';
}

String formatDate(DateTime? date) {
  if (date == null) return '';
  final d = date.toLocal();
  return '${_two(d.day)}/${_two(d.month)}/${d.year}';
}

String _two(int v) => v.toString().padLeft(2, '0');

/// Normalise un numéro camerounais vers `+237XXXXXXXXX` (null si invalide).
String? normalizeCameroonPhone(String input) {
  var digits = input.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.startsWith('00237')) digits = digits.substring(5);
  if (digits.startsWith('237') && digits.length == 12) digits = digits.substring(3);
  if (digits.length != 9) return null;
  if (!(digits.startsWith('6') || digits.startsWith('2'))) return null;
  return '+237$digits';
}

/// Initiales d'un nom : « Moussa Kamga » → « MK ».
String initialsOf(String? name) {
  final parts = (name ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return (parts.first.substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
}

/// Frais de service calculés localement (aperçu hors ligne, l'API fait foi).
int estimateServiceFee(int price, {double rate = 0.05, int minFee = 100}) {
  final fee = (price * rate).round();
  return fee < minFee ? minFee : fee;
}

/// Date courte « 17/10 à 14:30 » (échéances, libération automatique).
String formatShortDateTime(DateTime? date) {
  if (date == null) return '';
  final d = date.toLocal();
  return '${_two(d.day)}/${_two(d.month)} à ${formatTime(d)}';
}

/// Compte à rebours lisible : « 47 h 05 min », « 12 min 05 s », « 2 j 03 h ».
/// Renvoie « Échéance atteinte » quand la durée est nulle ou négative.
String formatCountdown(Duration remaining) {
  if (remaining.inSeconds <= 0) return 'Échéance atteinte';
  final days = remaining.inDays;
  final hours = remaining.inHours;
  final minutes = remaining.inMinutes.remainder(60);
  final seconds = remaining.inSeconds.remainder(60);
  if (days >= 3) return '$days${nbsp}j ${_two(remaining.inHours.remainder(24))}${nbsp}h';
  if (hours >= 1) return '$hours${nbsp}h ${_two(minutes)}${nbsp}min';
  return '${remaining.inMinutes}${nbsp}min ${_two(seconds)}${nbsp}s';
}

/// Supprime les emojis et pictogrammes (non rendus par les polices web :
/// carrés « tofu ») d'un texte venant du serveur.
String stripEmoji(String input) {
  final cleaned = input.replaceAll(
    RegExp(
      '[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]',
      unicode: true,
    ),
    '',
  );
  return cleaned.replaceAll(RegExp(r'\s{2,}'), ' ').trim();
}

/// Numéro masqué pour l'affichage : `+237690000001` → « +237 6•• •• •• 01 ».
String maskPhone(String? phone) {
  final digits = (phone ?? '').replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.length < 9) return '••• •• •• ••';
  final local = digits.substring(digits.length - 9);
  return '+237 ${local[0]}•• •• •• ${local.substring(7)}';
}
