import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tasko/core/theme.dart';
import 'package:tasko/features/jobs/job_sheets.dart';
import 'package:tasko/widgets/cameroon_flag.dart';
import 'package:tasko/widgets/start_code_field.dart';

Widget _wrap(Widget child) => MaterialApp(
      theme: TaskoTheme.light(useGoogleFonts: false),
      home: Scaffold(body: Center(child: child)),
    );

void main() {
  testWidgets('Saisie du code de démarrage : 4 chiffres, filtrage, validation', (tester) async {
    String? completed;
    final changes = <String>[];
    await tester.pumpWidget(_wrap(StartCodeField(
      onChanged: changes.add,
      onCompleted: (v) => completed = v,
    )));

    final input = find.byKey(const ValueKey('start-code-input'));
    expect(input, findsOneWidget);

    await tester.enterText(input, '48');
    await tester.pump();
    expect(find.text('4'), findsOneWidget);
    expect(find.text('8'), findsOneWidget);
    expect(completed, isNull);

    // Les caractères non numériques sont ignorés ; au-delà de 4 chiffres, tronqué.
    await tester.enterText(input, '4a8b21999');
    await tester.pump();
    expect(completed, '4821');
    for (final (i, d) in ['4', '8', '2', '1'].indexed) {
      final text = tester.widget<Text>(find.byKey(ValueKey('start-code-digit-$i')));
      expect(text.data, d);
    }
    expect(changes.last, '4821');
  });

  testWidgets('Feuille du code : erreur serveur affichée puis succès', (tester) async {
    final submitted = <String>[];
    var ok = false;
    await tester.pumpWidget(_wrap(Builder(
      builder: (context) => ElevatedButton(
        onPressed: () async {
          ok = await showStartCodeSheet(context, onSubmit: (code) async {
            submitted.add(code);
            return code == '4821' ? null : 'Code incorrect. Redemandez-le au client.';
          });
        },
        child: const Text('Ouvrir'),
      ),
    )));
    await tester.tap(find.text('Ouvrir'));
    await tester.pumpAndSettle();
    expect(find.text('Code de démarrage'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('start-code-input')), '1111');
    await tester.pumpAndSettle();
    expect(submitted, ['1111']);
    expect(find.text('Code incorrect. Redemandez-le au client.'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('start-code-input')), '4821');
    await tester.pumpAndSettle();
    expect(submitted, ['1111', '4821']);
    expect(ok, isTrue);
    expect(find.text('Code de démarrage'), findsNothing);
  });

  testWidgets('Drapeau du Cameroun dessiné (pas d’emoji)', (tester) async {
    await tester.pumpWidget(_wrap(const CameroonFlag(width: 30)));
    expect(find.byType(CustomPaint), findsWidgets);
    expect(find.bySemanticsLabel('Cameroun'), findsOneWidget);
    expect(tester.getSize(find.byType(CameroonFlag)), const Size(30, 20));
  });
}
