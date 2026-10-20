import 'dart:async';

import 'package:dio/dio.dart';

import '../models/json.dart';
import 'config.dart';

/// Erreur normalisée selon le contrat :
/// `{ "error": { "code", "message", "details" } }`.
class ApiException implements Exception {
  final String code;
  final String message;
  final int? statusCode;
  final Object? details;

  const ApiException({
    required this.code,
    required this.message,
    this.statusCode,
    this.details,
  });

  bool get isUnauthorized => code == 'UNAUTHORIZED' || statusCode == 401;
  bool get isNetwork => code == 'NETWORK';

  @override
  String toString() => message;

  static ApiException from(Object error) {
    if (error is ApiException) return error;
    if (error is DioException) {
      final inner = error.error;
      if (inner is ApiException) return inner;
      final response = error.response;
      if (response != null) {
        final body = asMap(response.data);
        final err = asMap(body?['error']);
        if (err != null) {
          return ApiException(
            code: asString(err['code'], 'INTERNAL'),
            message: asString(err['message'], 'Une erreur est survenue.'),
            statusCode: response.statusCode,
            details: err['details'],
          );
        }
        return ApiException(
          code: _codeForStatus(response.statusCode),
          message: _messageForStatus(response.statusCode),
          statusCode: response.statusCode,
        );
      }
      switch (error.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.receiveTimeout:
          return const ApiException(
            code: 'NETWORK',
            message: 'Le serveur met trop de temps à répondre. Réessayez.',
          );
        case DioExceptionType.cancel:
          return const ApiException(code: 'CANCELLED', message: 'Requête annulée.');
        default:
          return const ApiException(
            code: 'NETWORK',
            message:
                'Impossible de joindre le serveur Tasko. Vérifiez votre connexion.',
          );
      }
    }
    return ApiException(code: 'INTERNAL', message: error.toString());
  }

  static String _codeForStatus(int? s) => switch (s) {
        400 => 'VALIDATION_ERROR',
        401 => 'UNAUTHORIZED',
        402 => 'PAYMENT_FAILED',
        403 => 'FORBIDDEN',
        404 => 'NOT_FOUND',
        409 => 'CONFLICT',
        _ => 'INTERNAL',
      };

  static String _messageForStatus(int? s) => switch (s) {
        400 => 'Données invalides.',
        401 => 'Session expirée, veuillez vous reconnecter.',
        402 => 'Le paiement a échoué.',
        403 => 'Action non autorisée.',
        404 => 'Élément introuvable.',
        409 => 'Action impossible dans l’état actuel.',
        _ => 'Une erreur est survenue. Réessayez.',
      };
}

/// Client HTTP Dio avec intercepteur JWT.
class ApiClient {
  ApiClient({String? baseUrl, this.onUnauthorized})
      : dio = Dio(
          BaseOptions(
            baseUrl: baseUrl ?? AppConfig.apiBaseUrl,
            connectTimeout: const Duration(seconds: 12),
            receiveTimeout: const Duration(seconds: 20),
            sendTimeout: const Duration(seconds: 30),
            contentType: Headers.jsonContentType,
            responseType: ResponseType.json,
          ),
        ) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final t = token;
          if (t != null && t.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $t';
          }
          handler.next(options);
        },
        onError: (e, handler) {
          final apiError = ApiException.from(e);
          final hadToken = e.requestOptions.headers.containsKey('Authorization');
          if (apiError.isUnauthorized && hadToken) {
            onUnauthorized?.call();
          }
          handler.next(e.copyWith(error: apiError, message: apiError.message));
        },
      ),
    );
  }

  final Dio dio;
  String? token;
  void Function()? onUnauthorized;

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _wrap(() => dio.get(path, queryParameters: _clean(query)));

  Future<dynamic> post(String path, {Object? body, Map<String, dynamic>? query}) =>
      _wrap(() => dio.post(path, data: body ?? const {}, queryParameters: _clean(query)));

  Future<dynamic> put(String path, {Object? body}) =>
      _wrap(() => dio.put(path, data: body ?? const {}));

  /// PUT avec un corps JSON littéral `null` (ex. retour en compte particulier).
  Future<dynamic> putNull(String path) => _wrap(() => dio.put(path, data: 'null'));

  Future<dynamic> patch(String path, {Object? body}) =>
      _wrap(() => dio.patch(path, data: body ?? const {}));

  Future<dynamic> delete(String path) => _wrap(() => dio.delete(path));

  /// Envoi multipart d'un fichier (bytes : compatible web et mobile).
  Future<dynamic> upload(
    String path, {
    required List<int> bytes,
    required String filename,
    Map<String, dynamic>? fields,
  }) {
    final form = FormData.fromMap({
      ...?fields,
      'file': MultipartFile.fromBytes(bytes, filename: filename),
    });
    return _wrap(() => dio.post(path, data: form));
  }

  Map<String, dynamic>? _clean(Map<String, dynamic>? q) {
    if (q == null) return null;
    final out = <String, dynamic>{};
    q.forEach((k, v) {
      if (v != null && v.toString().isNotEmpty) out[k] = v;
    });
    return out;
  }

  Future<dynamic> _wrap(Future<Response<dynamic>> Function() call) async {
    try {
      final res = await call();
      return res.data;
    } catch (e) {
      throw ApiException.from(e);
    }
  }
}
