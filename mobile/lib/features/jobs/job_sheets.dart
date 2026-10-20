import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../models/job_rules.dart';
import '../../widgets/guarantee.dart';
import '../../widgets/start_code_field.dart';
import '../../widgets/tasko_button.dart';

/// Feuille « Entrer le code de démarrage ». [onSubmit] renvoie un message
/// d'erreur à afficher, ou `null` si le code est accepté (la feuille se ferme).
Future<bool> showStartCodeSheet(
  BuildContext context, {
  required Future<String?> Function(String code) onSubmit,
}) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => StartCodeSheet(onSubmit: onSubmit),
  );
  return ok == true;
}

class StartCodeSheet extends StatefulWidget {
  const StartCodeSheet({super.key, required this.onSubmit});
  final Future<String?> Function(String code) onSubmit;

  @override
  State<StartCodeSheet> createState() => _StartCodeSheetState();
}

class _StartCodeSheetState extends State<StartCodeSheet> {
  final _field = GlobalKey<StartCodeFieldState>();
  String _code = '';
  String? _error;
  bool _busy = false;

  Future<void> _submit() async {
    if (_busy || _code.length != 4) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final error = await widget.onSubmit(_code);
    if (!mounted) return;
    if (error == null) {
      Navigator.pop(context, true);
      return;
    }
    setState(() {
      _busy = false;
      _error = error;
    });
    _field.currentState?.clear();
    _code = '';
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Code de démarrage',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 19)),
              const SizedBox(height: 6),
              const Text(
                'Demandez au client son code à 4 chiffres. Il le voit dans son application.',
                style: TextStyle(fontSize: 15, color: TaskoColors.textMuted),
              ),
              const SizedBox(height: 18),
              StartCodeField(
                key: _field,
                error: _error != null,
                enabled: !_busy,
                onChanged: (v) => setState(() {
                  _code = v;
                  if (v.isNotEmpty) _error = null;
                }),
                onCompleted: (v) {
                  _code = v;
                  _submit();
                },
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(_error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: TaskoColors.danger, fontSize: 14)),
                ),
              const SizedBox(height: 18),
              TaskoButton(
                label: 'Commencer la mission',
                icon: Icons.play_arrow_rounded,
                loading: _busy,
                onPressed: _code.length == 4 ? _submit : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Résultat de la feuille « J'ai terminé » : photos de preuve + note.
class FinishResult {
  final List<String> photos;
  final String note;
  const FinishResult(this.photos, this.note);
}

/// Feuille de fin de mission / d'étape : photos de preuve (POST /uploads) + note.
Future<FinishResult?> showFinishSheet(
  BuildContext context, {
  String title = 'J’ai terminé',
  String confirmLabel = 'Envoyer et terminer',
}) {
  return showModalBottomSheet<FinishResult>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _FinishSheet(title: title, confirmLabel: confirmLabel),
  );
}

class _FinishSheet extends StatefulWidget {
  const _FinishSheet({required this.title, required this.confirmLabel});
  final String title;
  final String confirmLabel;

  @override
  State<_FinishSheet> createState() => _FinishSheetState();
}

class _FinishSheetState extends State<_FinishSheet> {
  List<String> _photos = const [];
  final _note = TextEditingController();
  bool _uploading = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 19)),
              const SizedBox(height: 6),
              const Text(
                'Prenez 1 à 3 photos du travail fini. Elles vous protègent en cas de désaccord.',
                style: TextStyle(fontSize: 15, color: TaskoColors.textMuted),
              ),
              const SizedBox(height: 14),
              PhotoUploader(
                urls: _photos,
                label: 'Ajouter une photo du travail',
                onChanged: (v) => setState(() => _photos = v),
                onBusyChanged: (v) => setState(() => _uploading = v),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _note,
                minLines: 2,
                maxLines: 4,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Note pour le client (optionnel)',
                  hintText: 'Ex. : joint changé, robinet testé, aucune fuite.',
                ),
              ),
              if (_photos.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 10),
                  child: InfoBox(
                    icon: Icons.photo_camera_outlined,
                    color: TaskoColors.warning,
                    text: 'Sans photo, vous aurez moins de preuves si le client conteste.',
                  ),
                ),
              const SizedBox(height: 16),
              TaskoButton(
                label: widget.confirmLabel,
                icon: Icons.check_circle_outline,
                onPressed: _uploading
                    ? null
                    : () => Navigator.pop(context, FinishResult(_photos, _note.text.trim())),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Confirmation d'annulation avec la règle applicable et un motif optionnel.
/// Renvoie le motif (chaîne éventuellement vide) si confirmé, sinon `null`.
Future<String?> showCancelSheet(BuildContext context, CancellationPolicy policy,
    {String confirmLabel = 'Oui, annuler la mission'}) {
  final reason = TextEditingController();
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(ctx).bottom),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Annuler la mission ?',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 19)),
              const SizedBox(height: 12),
              CancellationPolicyCard(policy: policy),
              const SizedBox(height: 12),
              TextField(
                controller: reason,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: 'Motif (optionnel)'),
              ),
              const SizedBox(height: 16),
              TaskoButton(
                label: confirmLabel,
                variant: TaskoButtonVariant.danger,
                icon: Icons.cancel_outlined,
                onPressed: () => Navigator.pop(ctx, reason.text.trim()),
              ),
              const SizedBox(height: 4),
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                child: const Text('Non, garder la mission'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// Petit rappel utilisé autour des litiges.
class EscrowLockedNote extends StatelessWidget {
  const EscrowLockedNote({super.key});

  @override
  Widget build(BuildContext context) => const InfoBox(
        icon: Icons.lock_outline,
        text: 'L’argent reste bloqué chez Tasko : ni le client ni le prestataire ne peuvent le récupérer seuls.',
      );
}
