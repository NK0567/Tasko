import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/icon_map.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/category.dart';
import '../../models/user.dart';
import '../../widgets/common.dart';
import '../../widgets/tasko_button.dart';

/// « Ce que je sais faire » : sélection multiple de sous-services + prix de base.
class SkillsScreen extends ConsumerStatefulWidget {
  const SkillsScreen({super.key, this.onboarding = false});
  final bool onboarding;

  @override
  ConsumerState<SkillsScreen> createState() => _SkillsScreenState();
}

class _SkillsScreenState extends ConsumerState<SkillsScreen> {
  /// category_id → prix de base.
  final Map<String, int> _selected = {};
  final Map<String, TextEditingController> _priceControllers = {};
  bool _saving = false;
  String _filter = '';

  @override
  void initState() {
    super.initState();
    final skills = ref.read(authProvider).user?.provider?.skills ?? const [];
    for (final s in skills) {
      _selected[s.categoryId] = s.basePrice;
    }
  }

  @override
  void dispose() {
    for (final c in _priceControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  TextEditingController _priceController(String id) => _priceControllers.putIfAbsent(
        id,
        () => TextEditingController(text: '${_selected[id] ?? 5000}'),
      );

  void _toggle(String id, bool on) {
    setState(() {
      if (on) {
        _selected[id] = int.tryParse(_priceController(id).text) ?? 5000;
      } else {
        _selected.remove(id);
      }
    });
  }

  Future<void> _save() async {
    if (_selected.isEmpty) {
      showSnack(context, 'Sélectionnez au moins un service.', error: true);
      return;
    }
    if (_selected.values.any((p) => p < 500)) {
      showSnack(context, 'Prix minimum : 500 FCFA.', error: true);
      return;
    }
    setState(() => _saving = true);
    try {
      final user = await ref.read(apiProvider).saveSkills([
        for (final e in _selected.entries)
          ProviderSkill(categoryId: e.key, name: '', basePrice: e.value),
      ]);
      ref.read(authProvider.notifier).setUser(user);
      if (!mounted) return;
      showSnack(context, 'Compétences enregistrées !');
      if (widget.onboarding) {
        context.go('/home');
      } else {
        context.pop();
      }
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = ref.watch(categoriesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Ce que je sais faire')),
      body: AsyncView(
        value: categories,
        onRetry: () => ref.invalidate(categoriesProvider),
        data: (list) => _buildList(list),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: TaskoButton(
            label: _selected.isEmpty
                ? 'Enregistrer'
                : 'Enregistrer (${_selected.length} service${_selected.length > 1 ? 's' : ''})',
            loading: _saving,
            onPressed: _save,
          ),
        ),
      ),
    );
  }

  Widget _buildList(List<Category> categories) {
    final f = _filter.toLowerCase();
    bool matches(Category c) => f.isEmpty || c.name.toLowerCase().contains(f);
    final visible = categories
        .where((c) => matches(c) || c.children.any(matches))
        .toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      children: [
        if (widget.onboarding)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text(
              'Dernière étape ! Choisissez les services que vous proposez et votre prix de départ. '
              'Vous recevrez les demandes correspondantes autour de vous.',
              style: TextStyle(color: TaskoColors.textMuted),
            ),
          ),
        TextField(
          onChanged: (v) => setState(() => _filter = v.trim()),
          decoration: const InputDecoration(
            hintText: 'Rechercher un service…',
            prefixIcon: Icon(Icons.search),
          ),
        ),
        const SizedBox(height: 12),
        if (visible.isEmpty) const EmptyView(compact: true, title: 'Aucun service trouvé'),
        for (final c in visible) _buildCategory(c, matches),
      ],
    );
  }

  Widget _buildCategory(Category c, bool Function(Category) matches) {
    final color = colorFromHex(c.color);
    final items = c.children.isEmpty ? [c] : c.children.where((s) => matches(s) || matches(c)).toList();
    final count = items.where((s) => _selected.containsKey(s.id)).length;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TaskoCard(
        padding: EdgeInsets.zero,
        child: Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            initiallyExpanded: count > 0 || _filter.isNotEmpty,
            leading: CategoryIcon(icon: c.icon, color: color, size: 40),
            title: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: count == 0
                ? null
                : Text('$count sélectionné${count > 1 ? 's' : ''}',
                    style: const TextStyle(color: TaskoColors.primary, fontSize: 12)),
            childrenPadding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
            children: [
              for (final s in items)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Checkbox(
                        value: _selected.containsKey(s.id),
                        activeColor: TaskoColors.primary,
                        onChanged: (v) => _toggle(s.id, v ?? false),
                      ),
                      Icon(iconForKey(s.icon), size: 18, color: color),
                      const SizedBox(width: 6),
                      Expanded(child: Text(s.name)),
                      if (_selected.containsKey(s.id))
                        SizedBox(
                          width: 118,
                          child: TextField(
                            controller: _priceController(s.id),
                            keyboardType: TextInputType.number,
                            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                            onChanged: (v) => _selected[s.id] = int.tryParse(v) ?? 0,
                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                            decoration: const InputDecoration(
                              isDense: true,
                              suffixText: 'FCFA',
                              contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
