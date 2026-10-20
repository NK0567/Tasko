import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tasko/core/theme.dart';
import 'package:tasko/features/auth/splash_screen.dart';

void main() {
  testWidgets('Le splash affiche le logo, le slogan, les pictos et les actions',
      (tester) async {
    var started = false;
    var login = false;
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: TaskoTheme.light(useGoogleFonts: false),
        home: SplashScreen(onStart: () => started = true, onLogin: () => login = true),
      ),
    );
    await tester.pump();

    expect(find.text('Tasko'), findsOneWidget);
    expect(find.textContaining('La marketplace des services'), findsOneWidget);
    expect(find.text('Demande\nun service'), findsOneWidget);
    expect(find.text('Trouve\nun job'), findsOneWidget);
    expect(find.text('Paie en\nligne'), findsOneWidget);
    expect(find.text("C'est\nsécurisé"), findsOneWidget);
    expect(find.text('Commencer'), findsOneWidget);

    await tester.tap(find.text('Commencer'));
    expect(started, isTrue);

    await tester.tap(find.textContaining('Déjà un compte'));
    expect(login, isTrue);
  });
}
