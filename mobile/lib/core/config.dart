import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';

/// Configuration globale de l'application.
///
/// L'URL du serveur se règle à la compilation :
/// `flutter run --dart-define=API_URL=http://192.168.1.10:4300`
class AppConfig {
  AppConfig._();

  static const String _definedApiUrl = String.fromEnvironment('API_URL');

  /// Origine du serveur (sans `/api/v1`), ex. `http://localhost:4300`.
  static String get serverUrl {
    if (_definedApiUrl.isNotEmpty) {
      var url = _definedApiUrl.trim();
      while (url.endsWith('/')) {
        url = url.substring(0, url.length - 1);
      }
      if (url.endsWith('/api/v1')) {
        url = url.substring(0, url.length - '/api/v1'.length);
      }
      return url;
    }
    if (kIsWeb) return 'http://localhost:4300';
    if (defaultTargetPlatform == TargetPlatform.android) {
      // L'émulateur Android voit la machine hôte sous 10.0.2.2.
      return 'http://10.0.2.2:4300';
    }
    return 'http://localhost:4300';
  }

  static String get apiBaseUrl => '$serverUrl/api/v1';
  static String get socketUrl => serverUrl;

  /// Transforme une URL relative (`/uploads/x.jpg`) en URL absolue.
  static String? mediaUrl(String? url) {
    if (url == null || url.isEmpty) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('/')) return '$serverUrl$url';
    return '$serverUrl/$url';
  }

  /// Position par défaut quand la géolocalisation est indisponible : Yaoundé.
  static const LatLng defaultPosition = LatLng(3.8480, 11.5021);
  static const LatLng doualaPosition = LatLng(4.0511, 9.7679);

  static const String tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  static const String userAgentPackage = 'com.tasko.tasko';

  static const double clientFeeRate = 0.05;
  static const int minServiceFee = 100;
}
