import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/category.dart';
import '../models/json.dart';
import '../models/settings.dart';
import '../models/user.dart';
import 'api_client.dart';
import 'config.dart';
import 'location_service.dart';
import 'socket_service.dart';
import 'tasko_api.dart';

/// Préférences locales (injectées dans `main()`).
final prefsProvider = Provider<SharedPreferences>(
  (ref) => throw UnimplementedError('prefsProvider doit être surchargé'),
);

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

final apiProvider = Provider<TaskoApi>((ref) => TaskoApi(ref.watch(apiClientProvider)));

class _Keys {
  static const token = 'tasko.token';
  static const user = 'tasko.user';
  static const providerMode = 'tasko.provider_mode';
  static const onboardingDone = 'tasko.onboarding_done';
  static const city = 'tasko.city';
}

class AuthState {
  final String? token;
  final User? user;
  final bool providerMode;

  const AuthState({this.token, this.user, this.providerMode = false});

  bool get isLoggedIn => token != null && token!.isNotEmpty && user != null;

  /// Mode prestataire actif seulement si le profil prestataire existe.
  bool get isProviderMode => providerMode && (user?.isProvider ?? false);

  AuthState copyWith({String? token, User? user, bool? providerMode}) => AuthState(
        token: token ?? this.token,
        user: user ?? this.user,
        providerMode: providerMode ?? this.providerMode,
      );
}

class AuthNotifier extends Notifier<AuthState> {
  SharedPreferences get _prefs => ref.read(prefsProvider);
  TaskoApi get _api => ref.read(apiProvider);

  @override
  AuthState build() {
    final client = ref.read(apiClientProvider);
    client.onUnauthorized = logout;
    final token = _prefs.getString(_Keys.token);
    final rawUser = _prefs.getString(_Keys.user);
    User? user;
    if (rawUser != null) {
      try {
        user = User.fromJson(asMap(jsonDecode(rawUser))!);
      } catch (_) {}
    }
    if (token != null && user != null) {
      client.token = token;
      SocketService.instance.connect(token);
      Future.microtask(refreshMe);
    }
    return AuthState(
      token: token,
      user: user,
      providerMode: _prefs.getBool(_Keys.providerMode) ?? false,
    );
  }

  bool get onboardingDone => _prefs.getBool(_Keys.onboardingDone) ?? false;
  Future<void> setOnboardingDone() => _prefs.setBool(_Keys.onboardingDone, true);

  Future<void> _persist(String token, User user) async {
    ref.read(apiClientProvider).token = token;
    await _prefs.setString(_Keys.token, token);
    await _prefs.setString(_Keys.user, jsonEncode(user.toJson()));
    SocketService.instance.connect(token);
    state = state.copyWith(token: token, user: user);
  }

  Future<void> login(String phone, String password) async {
    final res = await _api.login(phone, password);
    await _persist(res.token, res.user);
  }

  Future<void> register({
    required String fullName,
    required String phone,
    required String password,
    String? otpCode,
    String? city,
  }) async {
    final res = await _api.register(
      fullName: fullName,
      phone: phone,
      password: password,
      otpCode: otpCode,
      city: city,
    );
    await _persist(res.token, res.user);
  }

  Future<void> refreshMe() async {
    if (state.token == null) return;
    try {
      final user = await _api.me();
      setUser(user);
    } on ApiException catch (_) {
      // 401 géré par l'intercepteur ; autres erreurs : on garde le cache.
    }
  }

  void setUser(User user) {
    _prefs.setString(_Keys.user, jsonEncode(user.toJson()));
    state = state.copyWith(user: user);
  }

  Future<void> setProviderMode(bool enabled) async {
    await _prefs.setBool(_Keys.providerMode, enabled);
    state = state.copyWith(providerMode: enabled);
  }

  void logout() {
    ref.read(apiClientProvider).token = null;
    _prefs.remove(_Keys.token);
    _prefs.remove(_Keys.user);
    _prefs.remove(_Keys.providerMode);
    SocketService.instance.disconnect();
    state = const AuthState();
  }
}

final authProvider = NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new);

/// Catégories dynamiques (GET /categories).
final categoriesProvider = FutureProvider<List<Category>>(
  (ref) => ref.watch(apiProvider).categories(),
);

/// Paramètres publics (tarifs Pro/Boost, délai de libération, frais d'annulation…).
/// En cas d'erreur réseau : valeurs par défaut du contrat.
final publicSettingsProvider = FutureProvider<PublicSettings>((ref) async {
  try {
    return await ref.watch(apiProvider).publicSettings();
  } catch (_) {
    return const PublicSettings();
  }
});

/// Valeur synchrone des paramètres (défauts tant que le chargement n'est pas fini).
final settingsValueProvider = Provider<PublicSettings>(
  (ref) => ref.watch(publicSettingsProvider).value ?? const PublicSettings(),
);

/// Villes actives.
final citiesProvider = FutureProvider<List<City>>((ref) => ref.watch(apiProvider).cities());

/// Ville choisie dans le sélecteur de l'accueil.
class SelectedCityNotifier extends Notifier<City?> {
  @override
  City? build() {
    final raw = ref.read(prefsProvider).getString(_Keys.city);
    if (raw == null) return null;
    try {
      return City.fromJson(asMap(jsonDecode(raw))!);
    } catch (_) {
      return null;
    }
  }

  void select(City city) {
    ref.read(prefsProvider).setString(
          _Keys.city,
          jsonEncode({'id': city.id, 'name': city.name, 'lat': city.lat, 'lng': city.lng}),
        );
    state = city;
  }
}

final selectedCityProvider =
    NotifierProvider<SelectedCityNotifier, City?>(SelectedCityNotifier.new);

/// Position de l'utilisateur (repli : ville choisie, puis Yaoundé).
final positionProvider = FutureProvider<UserPosition>((ref) async {
  final city = ref.watch(selectedCityProvider);
  final fallback = city == null ? AppConfig.defaultPosition : LatLng(city.lat, city.lng);
  final pos = await LocationService.current(fallback: fallback);
  // Si l'utilisateur a choisi une autre ville que celle où il se trouve,
  // on privilégie la ville choisie quand le GPS est indisponible.
  return pos;
});

/// Onglet actif de la coquille principale.
class ShellTabNotifier extends Notifier<int> {
  @override
  int build() => 0;
  void set(int index) => state = index;
}

final shellTabProvider = NotifierProvider<ShellTabNotifier, int>(ShellTabNotifier.new);
