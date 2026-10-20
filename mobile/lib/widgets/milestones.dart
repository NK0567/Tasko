import 'package:flutter/material.dart';

import '../core/formatters.dart';
import '../core/theme.dart';
import '../models/job.dart';
import 'ux.dart';

/// Frise verticale des étapes de paiement, avec statut et actions.
class MilestoneTimeline extends StatelessWidget {
  const MilestoneTimeline({super.key, required this.milestones, this.actionsBuilder});
  final List<Milestone> milestones;

  /// Actions sous une étape (payer, déclarer terminée, valider…).
  final Widget? Function(Milestone m, int index)? actionsBuilder;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < milestones.length; i++)
          _MilestoneTile(
            milestone: milestones[i],
            index: i + 1,
            count: milestones.length,
            last: i == milestones.length - 1,
            actions: actionsBuilder?.call(milestones[i], i + 1),
          ),
      ],
    );
  }
}

class _MilestoneTile extends StatelessWidget {
  const _MilestoneTile({
    required this.milestone,
    required this.index,
    required this.count,
    required this.last,
    this.actions,
  });

  final Milestone milestone;
  final int index;
  final int count;
  final bool last;
  final Widget? actions;

  @override
  Widget build(BuildContext context) {
    final m = milestone;
    final color = MilestoneStatus.color(m.status);
    final done = m.status == MilestoneStatus.released;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 34,
            child: Column(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: done ? color : Colors.white,
                    border: Border.all(color: color, width: 2.5),
                  ),
                  child: done
                      ? const Icon(Icons.check, size: 16, color: Colors.white)
                      : Text('$index',
                          style: TextStyle(fontWeight: FontWeight.w700, color: color)),
                ),
                if (!last)
                  Expanded(child: Container(width: 2.5, color: TaskoColors.border)),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text('Étape $index/$count · ${m.title}',
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(MilestoneStatus.label(m.status),
                            style: TextStyle(
                                color: color, fontWeight: FontWeight.w600, fontSize: 12)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(formatMoney(m.amount),
                      style: const TextStyle(
                          color: TaskoColors.primary, fontWeight: FontWeight.w700, fontSize: 15)),
                  if (m.status == MilestoneStatus.submitted && m.autoReleaseAt != null)
                    Text('Paiement automatique le ${formatShortDateTime(m.autoReleaseAt)}',
                        style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted)),
                  if (m.releasedAt != null)
                    Text('Payé le ${formatDate(m.releasedAt)}',
                        style: const TextStyle(fontSize: 13, color: TaskoColors.textMuted)),
                  if (actions != null) ...[const SizedBox(height: 8), actions!],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Saisie d'étapes de paiement `{title, amount}` (optionnelles).
class MilestonesEditor extends StatefulWidget {
  const MilestonesEditor({
    super.key,
    required this.onChanged,
    this.initial = const [],
    this.expectedTotal,
  });

  final ValueChanged<List<MilestoneDraft>> onChanged;
  final List<MilestoneDraft> initial;

  /// Si renseigné, affiche l'écart avec le total attendu.
  final int? expectedTotal;

  @override
  State<MilestonesEditor> createState() => _MilestonesEditorState();
}

class _MilestonesEditorState extends State<MilestonesEditor> {
  final List<(TextEditingController, TextEditingController)> _rows = [];

  @override
  void initState() {
    super.initState();
    for (final m in widget.initial) {
      _rows.add((
        TextEditingController(text: m.title),
        TextEditingController(text: formatMoney(m.amount, withCurrency: false)),
      ));
    }
  }

  @override
  void dispose() {
    for (final r in _rows) {
      r.$1.dispose();
      r.$2.dispose();
    }
    super.dispose();
  }

  void _emit() {
    final list = <MilestoneDraft>[];
    for (final r in _rows) {
      final amount = parseAmount(r.$2.text);
      final title = r.$1.text.trim();
      if (title.isNotEmpty && amount > 0) list.add(MilestoneDraft(title: title, amount: amount));
    }
    widget.onChanged(list);
    setState(() {});
  }

  void _add() {
    setState(() => _rows.add((TextEditingController(), TextEditingController())));
  }

  void _remove(int i) {
    final r = _rows.removeAt(i);
    r.$1.dispose();
    r.$2.dispose();
    _emit();
  }

  @override
  Widget build(BuildContext context) {
    final total = _rows.fold<int>(0, (s, r) => s + parseAmount(r.$2.text));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < _rows.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: _rows[i].$1,
                    onChanged: (_) => _emit(),
                    decoration: InputDecoration(labelText: 'Étape ${i + 1}', hintText: 'Ex. : Gros œuvre'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: _rows[i].$2,
                    keyboardType: TextInputType.number,
                    inputFormatters: [ThousandsInputFormatter()],
                    onChanged: (_) => _emit(),
                    decoration: const InputDecoration(labelText: 'Montant', suffixText: 'FCFA'),
                  ),
                ),
                IconButton(
                  tooltip: 'Supprimer l’étape ${i + 1}',
                  icon: const Icon(Icons.delete_outline, color: TaskoColors.danger),
                  onPressed: () => _remove(i),
                ),
              ],
            ),
          ),
        if (_rows.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              widget.expectedTotal != null && widget.expectedTotal! > 0 && total != widget.expectedTotal
                  ? 'Total des étapes : ${formatMoney(total)} (le prix est ${formatMoney(widget.expectedTotal)})'
                  : 'Total des étapes : ${formatMoney(total)}',
              style: TextStyle(
                fontSize: 13,
                color: widget.expectedTotal != null &&
                        widget.expectedTotal! > 0 &&
                        total != widget.expectedTotal
                    ? TaskoColors.danger
                    : TaskoColors.textMuted,
              ),
            ),
          ),
        OutlinedButton.icon(
          onPressed: _add,
          icon: const Icon(Icons.add),
          label: Text(_rows.isEmpty ? 'Payer en plusieurs étapes' : 'Ajouter une étape'),
        ),
      ],
    );
  }
}
