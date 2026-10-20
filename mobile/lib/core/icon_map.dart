import 'package:flutter/material.dart';

/// Correspondance entre les clés d'icônes du contrat d'API et les Material Icons.
const Map<String, IconData> kCategoryIcons = {
  'construction': Icons.construction,
  'home_repair_service': Icons.home_repair_service,
  'spa': Icons.spa,
  'computer': Icons.computer,
  'school': Icons.school,
  'local_shipping': Icons.local_shipping,
  'shopping_basket': Icons.shopping_basket,
  'directions_car': Icons.directions_car,
  'checkroom': Icons.checkroom,
  'celebration': Icons.celebration,
  'yard': Icons.yard,
  'build': Icons.build,
  'handyman': Icons.handyman,
  'plumbing': Icons.plumbing,
  'electrical_services': Icons.electrical_services,
  'cleaning_services': Icons.cleaning_services,
  'local_laundry_service': Icons.local_laundry_service,
  'content_cut': Icons.content_cut,
  'face': Icons.face,
  'brush': Icons.brush,
  'photo_camera': Icons.photo_camera,
  'restaurant': Icons.restaurant,
  'phone_android': Icons.phone_android,
  'ac_unit': Icons.ac_unit,
  'chair': Icons.chair,
  'child_care': Icons.child_care,
  'translate': Icons.translate,
  'description': Icons.description,
  'print': Icons.print,
  'design_services': Icons.design_services,
  'videocam': Icons.videocam,
  'music_note': Icons.music_note,
  'pets': Icons.pets,
  'agriculture': Icons.agriculture,
  'fitness_center': Icons.fitness_center,
  'security': Icons.security,
  'key': Icons.key,
  'format_paint': Icons.format_paint,
  'moving': Icons.moving,
  'volunteer_activism': Icons.volunteer_activism,
  'more_horiz': Icons.more_horiz,
};

/// Icône de repli si la clé est inconnue.
const IconData kFallbackCategoryIcon = Icons.miscellaneous_services;

IconData iconForKey(String? key) =>
    kCategoryIcons[key ?? ''] ?? kFallbackCategoryIcon;

/// Couleur hexadécimale (« #E91E63 » ou « E91E63 ») → [Color], avec repli.
Color colorFromHex(String? hex, {Color fallback = const Color(0xFF0F7A3D)}) {
  if (hex == null) return fallback;
  var h = hex.trim().replaceFirst('#', '');
  if (h.length == 3) {
    h = h.split('').map((c) => '$c$c').join();
  }
  if (h.length == 6) h = 'FF$h';
  if (h.length != 8) return fallback;
  final v = int.tryParse(h, radix: 16);
  return v == null ? fallback : Color(v);
}
