import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/auth_screens.dart';
import '../features/auth/onboarding_screen.dart';
import '../features/auth/splash_screen.dart';
import '../features/chat/chat_screen.dart';
import '../features/disputes/mediation_screen.dart';
import '../features/disputes/open_dispute_screen.dart';
import '../features/explore/explore_screen.dart';
import '../features/home/home_screen.dart';
import '../features/home/home_shell.dart';
import '../features/jobs/create_job_screen.dart';
import '../features/jobs/job_detail_screen.dart';
import '../features/jobs/job_done_screen.dart';
import '../features/jobs/milestones_screen.dart';
import '../features/jobs/proposal_screen.dart';
import '../features/jobs/receipt_screen.dart';
import '../features/jobs/tracking_screen.dart';
import '../features/jobs/waiting_screen.dart';
import '../features/menu/menu_screens.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/profile/business_screen.dart';
import '../features/properties/properties_screens.dart';
import '../features/payment/payment_screen.dart';
import '../features/provider_mode/offers_screen.dart';
import '../features/provider_mode/propose_job_screen.dart';
import '../features/provider_mode/provider_mission_screen.dart';
import '../features/provider_mode/provider_setup_screen.dart';
import '../features/provider_mode/skills_screen.dart';
import '../features/provider_mode/wallet_screen.dart';
import '../features/provider_profile/provider_profile_screen.dart';
import '../features/tenders/tender_screens.dart';
import '../models/conversation.dart';
import 'providers.dart';

/// Notifie go_router quand l'état d'authentification change.
class _AuthRefresh extends ChangeNotifier {
  void ping() => notifyListeners();
}

const _publicPaths = {'/', '/onboarding', '/login', '/register', '/about'};

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _AuthRefresh();
  ref.listen(authProvider.select((s) => s.isLoggedIn), (_, _) => refresh.ping());
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final loggedIn = ref.read(authProvider).isLoggedIn;
      final path = state.uri.path;
      final isPublic = _publicPaths.contains(path);
      if (!loggedIn && !isPublic) return '/';
      if (loggedIn && isPublic && path != '/about') return '/home';
      return null;
    },
    errorBuilder: (context, state) => Scaffold(
      appBar: AppBar(),
      body: Center(child: Text('Page introuvable : ${state.uri.path}')),
    ),
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => SplashScreen(
          onStart: () {
            final done = ref.read(authProvider.notifier).onboardingDone;
            context.go(done ? '/register' : '/onboarding');
          },
          onLogin: () => context.go('/login'),
        ),
      ),
      GoRoute(path: '/onboarding', builder: (_, _) => const OnboardingScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, _) => const RegisterScreen()),
      GoRoute(path: '/home', builder: (_, _) => const HomeShell()),
      GoRoute(path: '/categories', builder: (_, _) => const CategoriesScreen()),
      GoRoute(
        path: '/categories/:id',
        builder: (_, s) => ExploreScreen(categoryId: s.pathParameters['id']),
      ),
      GoRoute(
        path: '/explore',
        builder: (_, s) => ExploreScreen(
          initialQuery: s.uri.queryParameters['q'],
          categoryId: s.uri.queryParameters['category_id'],
        ),
      ),
      GoRoute(
        path: '/provider/:id',
        builder: (_, s) => ProviderProfileScreen(providerId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/provider/:id/reviews',
        builder: (_, s) => ProviderReviewsScreen(providerId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/chat/:id',
        builder: (_, s) => ChatScreen(
          conversationId: s.pathParameters['id']!,
          otherUser: s.extra is ChatUser ? s.extra as ChatUser : null,
        ),
      ),
      GoRoute(
        path: '/jobs/new',
        builder: (_, s) {
          final q = s.uri.queryParameters;
          return CreateJobScreen(
            categoryId: q['category_id'],
            providerId: q['provider_id'],
            providerName: q['provider_name'],
            urgency: q['urgency'],
            other: q['other'] == '1',
            propertyId: q['property_id'],
            mode: q['mode'],
          );
        },
      ),
      GoRoute(
        path: '/jobs/:id',
        builder: (_, s) => JobDetailScreen(jobId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/jobs/:id/waiting',
        builder: (_, s) => WaitingScreen(jobId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/jobs/:id/pay',
        builder: (_, s) => PaymentScreen(
          jobId: s.pathParameters['id']!,
          milestoneId: s.uri.queryParameters['milestone_id'],
        ),
      ),
      GoRoute(
        path: '/jobs/:id/track',
        builder: (_, s) => TrackingScreen(jobId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/jobs/:id/done',
        builder: (_, s) => JobDoneScreen(jobId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/jobs/:id/proposal',
        builder: (_, s) => ProposalScreen(jobId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/jobs/:id/milestones',
        builder: (_, s) => MilestonesScreen(jobId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/jobs/:id/receipt',
        builder: (_, s) => ReceiptScreen(jobId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/jobs/:id/tender',
        builder: (_, s) => ClientTenderScreen(jobId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/jobs/:id/dispute',
        builder: (_, s) => OpenDisputeScreen(
          jobId: s.pathParameters['id']!,
          milestoneId: s.uri.queryParameters['milestone_id'],
        ),
      ),
      GoRoute(
        path: '/disputes/:id',
        builder: (_, s) => MediationScreen(disputeId: s.pathParameters['id']!),
      ),
      GoRoute(path: '/tenders', builder: (_, _) => const TendersScreen()),
      GoRoute(
        path: '/tenders/:id',
        builder: (_, s) => TenderDetailScreen(jobId: s.pathParameters['id']!),
      ),
      GoRoute(path: '/business', builder: (_, _) => const BusinessScreen()),
      GoRoute(path: '/properties', builder: (_, _) => const PropertiesScreen()),
      GoRoute(path: '/properties/new', builder: (_, _) => const PropertyFormScreen()),
      GoRoute(
        path: '/properties/:id',
        builder: (_, s) => PropertyDetailScreen(propertyId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/properties/:id/edit',
        builder: (_, s) => PropertyFormScreen(propertyId: s.pathParameters['id']!),
      ),
      GoRoute(path: '/provider-mode/wallet', builder: (_, _) => const WalletScreen()),
      GoRoute(path: '/provider-mode/propose', builder: (_, _) => const ProposeJobScreen()),
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
      GoRoute(path: '/about', builder: (_, _) => const AboutScreen()),
      GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen()),
      GoRoute(path: '/help', builder: (_, _) => const HelpScreen()),
      GoRoute(path: '/payments', builder: (_, _) => const PaymentsScreen()),
      GoRoute(path: '/my-reviews', builder: (_, _) => const MyReviewsScreen()),
      GoRoute(path: '/favorites', builder: (_, _) => const FavoritesScreen()),
      GoRoute(path: '/provider-mode/setup', builder: (_, _) => const ProviderSetupScreen()),
      GoRoute(
        path: '/provider-mode/skills',
        builder: (_, s) => SkillsScreen(onboarding: s.uri.queryParameters['onboarding'] == '1'),
      ),
      GoRoute(path: '/provider-mode/offers', builder: (_, _) => const OffersScreen()),
      GoRoute(
        path: '/provider-mode/mission/:id',
        builder: (_, s) => ProviderMissionScreen(jobId: s.pathParameters['id']!),
      ),
    ],
  );
});
