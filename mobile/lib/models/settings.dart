import 'json.dart';

/// Paramètres publics de la plateforme (`GET /settings/public`).
/// Les valeurs par défaut sont celles du contrat (repli hors ligne).
class PublicSettings {
  final double clientFeeRate;
  final double providerCommissionRate;
  final int minServiceFee;
  final String currency;
  final double searchRadiusKm;
  final int autoReleaseHours;
  final bool requireStartCode;
  final int cancellationFeeEnRoute;
  final int proPlanPrice;
  final int boostDayPrice;
  final int boostMonthPrice;

  /// Délai de réponse du prestataire signalé absent (RG-G11).
  final int noShowResponseHours;

  /// Numéro du support (si exposé par le serveur).
  final String? supportPhone;

  const PublicSettings({
    this.clientFeeRate = 0.05,
    this.providerCommissionRate = 0,
    this.minServiceFee = 100,
    this.currency = 'XAF',
    this.searchRadiusKm = 10,
    this.autoReleaseHours = 48,
    this.requireStartCode = true,
    this.cancellationFeeEnRoute = 1000,
    this.proPlanPrice = 3000,
    this.boostDayPrice = 500,
    this.boostMonthPrice = 5000,
    this.supportPhone,
    this.noShowResponseHours = 12,
  });

  factory PublicSettings.fromJson(Json j) {
    const d = PublicSettings();
    return PublicSettings(
      clientFeeRate: asDouble(j['client_fee_rate'], d.clientFeeRate),
      providerCommissionRate: asDouble(j['provider_commission_rate'], d.providerCommissionRate),
      minServiceFee: asInt(j['min_service_fee'], d.minServiceFee),
      currency: asString(j['currency'], d.currency),
      searchRadiusKm: asDouble(j['search_radius_km'], d.searchRadiusKm),
      autoReleaseHours: asInt(j['auto_release_hours'], d.autoReleaseHours),
      requireStartCode: asBool(j['require_start_code'], d.requireStartCode),
      cancellationFeeEnRoute: asInt(j['cancellation_fee_en_route'], d.cancellationFeeEnRoute),
      proPlanPrice: asInt(j['pro_plan_price'], d.proPlanPrice),
      boostDayPrice: asInt(j['boost_day_price'], d.boostDayPrice),
      boostMonthPrice: asInt(j['boost_month_price'], d.boostMonthPrice),
      supportPhone: asStringOrNull(j['support_phone']),
      noShowResponseHours: asInt(j['no_show_response_hours'], d.noShowResponseHours),
    );
  }
}
