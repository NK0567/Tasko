import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/socket_service.dart';
import '../../models/job.dart';
import '../../widgets/common.dart';
import '../home/shell_widgets.dart';
import '../../widgets/ux.dart';
import '../tenders/tender_screens.dart';
import 'job_common.dart';

typedef JobsQuery = ({String as, String status});

final jobsListProvider =
    FutureProvider.autoDispose.family<List<Job>, JobsQuery>((ref, q) async {
  final list = await ref.watch(apiProvider).jobs(as: q.as, status: q.status);
  list.sort((a, b) => (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
  return list;
});

/// Mes jobs : onglets En cours / Historique (client ou prestataire selon le mode).
class MyJobsScreen extends ConsumerStatefulWidget {
  const MyJobsScreen({super.key});

  @override
  ConsumerState<MyJobsScreen> createState() => _MyJobsScreenState();
}

class _MyJobsScreenState extends ConsumerState<MyJobsScreen> {
  final List<StreamSubscription<dynamic>> _subs = [];

  @override
  void initState() {
    super.initState();
    _subs.add(SocketService.instance.on('job:updated').listen((_) => _refresh()));
    _subs.add(SocketService.instance.reconnected.listen((_) => _refresh()));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  void _refresh() {
    if (!mounted) return;
    ref.invalidate(jobsListProvider);
  }

  @override
  Widget build(BuildContext context) {
    final asProvider = ref.watch(authProvider.select((s) => s.isProviderMode));
    final role = asProvider ? 'provider' : 'client';
    return DefaultTabController(
      key: ValueKey(role),
      length: asProvider ? 3 : 2,
      child: Scaffold(
        appBar: AppBar(
          leading: const MenuButton(),
          title: Text(asProvider ? 'Mes missions' : 'Mes jobs'),
          actions: const [NotificationBell()],
          bottom: TabBar(
            isScrollable: asProvider,
            tabs: [
              const Tab(text: 'En cours'),
              if (asProvider) const Tab(text: 'Appels d’offres'),
              const Tab(text: 'Historique'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _JobsList(query: (as: role, status: 'active'), asProvider: asProvider),
            if (asProvider) const TendersList(),
            _JobsList(query: (as: role, status: 'history'), asProvider: asProvider),
          ],
        ),
      ),
    );
  }
}

class _JobsList extends ConsumerWidget {
  const _JobsList({required this.query, required this.asProvider});
  final JobsQuery query;
  final bool asProvider;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final jobs = ref.watch(jobsListProvider(query));
    if (jobs.isLoading && !jobs.hasValue) return const SkeletonList();
    return AsyncView(
      value: jobs,
      onRetry: () => ref.invalidate(jobsListProvider(query)),
      data: (list) {
        if (list.isEmpty) {
          return EmptyView(
            title: query.status == 'active' ? 'Aucune mission en cours' : 'Aucun historique',
            message: asProvider
                ? 'Passez en ligne depuis le tableau de bord pour recevoir des missions.'
                : 'Touchez « Demander un service » pour trouver un prestataire près de chez vous.',
            actionLabel: query.status != 'active'
                ? null
                : (asProvider ? 'Proposer une mission' : 'Demander un service'),
            onAction: () => context.push(asProvider ? '/provider-mode/propose' : '/jobs/new'),
          );
        }
        return RefreshIndicator(
          onRefresh: () => ref.refresh(jobsListProvider(query).future),
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: list.length,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
            itemBuilder: (_, i) => JobCard(
              job: list[i],
              asProvider: asProvider,
              onTap: () async {
                await context.push(jobRouteFor(list[i], asProvider: asProvider));
                ref.invalidate(jobsListProvider(query));
              },
            ),
          ),
        );
      },
    );
  }
}
