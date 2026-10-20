import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import 'config.dart';

/// Position obtenue + indicateur de repli (Yaoundé).
class UserPosition {
  final LatLng latLng;
  final bool isFallback;
  const UserPosition(this.latLng, {this.isFallback = false});

  double get lat => latLng.latitude;
  double get lng => latLng.longitude;
}

class LocationService {
  LocationService._();

  static UserPosition? _last;
  static UserPosition? get lastKnown => _last;

  /// Position courante ; si refusée / indisponible → Yaoundé.
  static Future<UserPosition> current({LatLng? fallback}) async {
    final defaultPos = fallback ?? AppConfig.defaultPosition;
    try {
      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!enabled) return _remember(UserPosition(defaultPos, isFallback: true));
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever ||
          permission == LocationPermission.unableToDetermine) {
        return _remember(UserPosition(defaultPos, isFallback: true));
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).timeout(const Duration(seconds: 10));
      return _remember(UserPosition(LatLng(pos.latitude, pos.longitude)));
    } catch (e) {
      debugPrint('[location] repli sur Yaoundé : $e');
      return _remember(UserPosition(_last?.latLng ?? defaultPos, isFallback: true));
    }
  }

  static UserPosition _remember(UserPosition p) {
    if (!p.isFallback || _last == null) _last = p;
    return p;
  }

  /// Flux de positions réelles (null si indisponible).
  static Future<Stream<LatLng>?> stream() async {
    try {
      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!enabled) return null;
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return null;
      }
      return Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 10,
        ),
      ).map((p) => LatLng(p.latitude, p.longitude));
    } catch (_) {
      return null;
    }
  }

  static const Distance _distance = Distance();

  static double distanceKm(LatLng a, LatLng b) =>
      _distance.as(LengthUnit.Meter, a, b) / 1000.0;

  /// Point situé à [fraction] du trajet a → b (simulation de déplacement).
  static LatLng interpolate(LatLng a, LatLng b, double fraction) => LatLng(
        a.latitude + (b.latitude - a.latitude) * fraction,
        a.longitude + (b.longitude - a.longitude) * fraction,
      );
}
