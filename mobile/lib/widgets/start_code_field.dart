import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';

/// Saisie du code de démarrage à 4 chiffres (type PIN).
///
/// Un champ texte invisible capte la saisie (clavier numérique, collage) ;
/// quatre cases affichent les chiffres saisis.
class StartCodeField extends StatefulWidget {
  const StartCodeField({
    super.key,
    this.length = 4,
    this.onChanged,
    this.onCompleted,
    this.autofocus = true,
    this.error = false,
    this.enabled = true,
  });

  final int length;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onCompleted;
  final bool autofocus;
  final bool error;
  final bool enabled;

  @override
  State<StartCodeField> createState() => StartCodeFieldState();
}

class StartCodeFieldState extends State<StartCodeField> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  String get value => _controller.text;

  void clear() {
    _controller.clear();
    setState(() {});
    _focus.requestFocus();
  }

  @override
  void initState() {
    super.initState();
    _focus.addListener(_onFocus);
  }

  void _onFocus() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _focus.removeListener(_onFocus);
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    setState(() {});
    widget.onChanged?.call(v);
    if (v.length == widget.length) widget.onCompleted?.call(v);
  }

  @override
  Widget build(BuildContext context) {
    final text = _controller.text;
    final borderColor = widget.error ? TaskoColors.danger : TaskoColors.primary;
    return Semantics(
      label: 'Code de démarrage à ${widget.length} chiffres',
      textField: true,
      child: SizedBox(
        height: 64,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < widget.length; i++)
                  Container(
                    width: 54,
                    height: 62,
                    margin: const EdgeInsets.symmetric(horizontal: 6),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: TaskoColors.surfaceMuted,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: (i == text.length && _focus.hasFocus) || i < text.length
                            ? borderColor
                            : TaskoColors.border,
                        width: i == text.length && _focus.hasFocus ? 2 : 1.4,
                      ),
                    ),
                    child: Text(
                      i < text.length ? text[i] : '',
                      key: ValueKey('start-code-digit-$i'),
                      style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w700,
                        color: TaskoColors.primaryDark,
                      ),
                    ),
                  ),
              ],
            ),
            Positioned.fill(
              child: TextField(
                key: const ValueKey('start-code-input'),
                controller: _controller,
                focusNode: _focus,
                enabled: widget.enabled,
                autofocus: widget.autofocus,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                maxLength: widget.length,
                showCursor: false,
                enableInteractiveSelection: false,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(widget.length),
                ],
                style: const TextStyle(color: Colors.transparent, fontSize: 1),
                decoration: const InputDecoration(
                  counterText: '',
                  filled: false,
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  disabledBorder: InputBorder.none,
                  contentPadding: EdgeInsets.zero,
                ),
                onTap: () => setState(() {}),
                onChanged: _onChanged,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
