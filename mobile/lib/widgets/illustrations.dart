import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Chemins centralisés des illustrations vectorielles locales.
class Illustrations {
  Illustrations._();
  static const logoPin = 'assets/illustrations/logo_pin.svg';
  static const skyline = 'assets/illustrations/skyline.svg';
  static const provider = 'assets/illustrations/onboarding_provider.svg';
  static const map = 'assets/illustrations/onboarding_map.svg';
  static const payment = 'assets/illustrations/onboarding_payment.svg';
  static const community = 'assets/illustrations/onboarding_community.svg';
  static const emptyBox = 'assets/illustrations/empty_box.svg';

  static Widget svg(
    String path, {
    double? width,
    double? height,
    BoxFit fit = BoxFit.contain,
    Alignment alignment = Alignment.center,
  }) =>
      SvgPicture.asset(
        path,
        width: width,
        height: height,
        fit: fit,
        alignment: alignment,
        placeholderBuilder: (_) => SizedBox(width: width, height: height),
      );
}
