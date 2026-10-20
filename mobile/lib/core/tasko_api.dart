import '../models/category.dart';
import '../models/conversation.dart';
import '../models/dispute.dart';
import '../models/job.dart';
import '../models/json.dart';
import '../models/notification.dart';
import '../models/property.dart';
import '../models/provider_card.dart';
import '../models/review.dart';
import '../models/settings.dart';
import '../models/transaction.dart';
import '../models/user.dart';
import '../models/wallet.dart';
import 'api_client.dart';

/// Résultat d'authentification `{token, user}`.
class AuthResult {
  final String token;
  final User user;
  const AuthResult(this.token, this.user);
}

/// Accès typé à toutes les routes du contrat d'API.
class TaskoApi {
  TaskoApi(this.client);
  final ApiClient client;

  // ---------------------------------------------------------------- Auth
  Future<String?> requestOtp(String phone) async {
    final data = asMap(await client.post('/auth/otp/request', body: {'phone': phone}));
    return asStringOrNull(data?['dev_code']);
  }

  Future<AuthResult> register({
    required String fullName,
    required String phone,
    required String password,
    String? otpCode,
    String? city,
  }) async {
    final data = asMap(await client.post('/auth/register', body: {
      'full_name': fullName,
      'phone': phone,
      'password': password,
      if (otpCode != null && otpCode.isNotEmpty) 'otp_code': otpCode,
      'city': ?city,
    }))!;
    return AuthResult(asString(data['token']), User.fromJson(asMap(data['user'])!));
  }

  Future<AuthResult> login(String phone, String password) async {
    final data = asMap(await client.post('/auth/login', body: {
      'phone': phone,
      'password': password,
    }))!;
    return AuthResult(asString(data['token']), User.fromJson(asMap(data['user'])!));
  }

  Future<User> me() async => User.fromJson(asMap(await client.get('/me'))!);

  Future<User> updateMe({String? fullName, String? email, String? city}) async =>
      User.fromJson(asMap(await client.patch('/me', body: {
        'full_name': ?fullName,
        'email': ?email,
        'city': ?city,
      }))!);

  Future<User> uploadAvatar(List<int> bytes, String filename) async =>
      User.fromJson(asMap(await client.upload('/me/avatar', bytes: bytes, filename: filename))!);

  Future<User> setupProvider({
    required String headline,
    required String bio,
    required String providerType,
    required int yearsExperience,
    required String momoNumber,
    required String momoOperator,
    required List<int> availableDays,
  }) async =>
      User.fromJson(asMap(await client.put('/me/provider', body: {
        'headline': headline,
        'bio': bio,
        'provider_type': providerType,
        'years_experience': yearsExperience,
        'momo_number': momoNumber,
        'momo_operator': momoOperator,
        'available_days': availableDays,
      }))!);

  Future<User> setOnline(bool online) async => User.fromJson(
      asMap(await client.patch('/me/provider/status', body: {'is_online': online}))!);

  Future<void> sendLocation(double lat, double lng) =>
      client.post('/me/location', body: {'lat': lat, 'lng': lng});

  Future<User> saveSkills(List<ProviderSkill> skills) async => User.fromJson(asMap(
      await client.put('/me/skills', body: {
        'skills': skills.map((s) => s.toJson()).toList(),
      }))!);

  Future<ProviderProfile> addPortfolio(List<int> bytes, String filename, String title) async =>
      ProviderProfile.fromJson(asMap(await client.upload('/me/portfolio',
          bytes: bytes, filename: filename, fields: {'title': title}))!);

  Future<Earnings> earnings() async =>
      Earnings.fromJson(asMap(await client.get('/me/earnings')) ?? const {});

  Future<Transaction> subscribePro({required String method, required String phone}) async {
    final data = asMap(await client.post('/me/subscription',
        body: {'plan': 'pro', 'method': method, 'phone': phone}))!;
    return Transaction.fromJson(asMap(data['transaction']) ?? data);
  }

  Future<Transaction> boost({
    required String duration,
    required String method,
    required String phone,
  }) async {
    final data = asMap(await client.post('/me/boost',
        body: {'duration': duration, 'method': method, 'phone': phone}))!;
    return Transaction.fromJson(asMap(data['transaction']) ?? data);
  }

  Future<List<ProviderCard>> favorites() async =>
      itemsOf(await client.get('/me/favorites'), ProviderCard.fromJson);

  // ----------------------------------------------------------- Catalogue
  Future<List<Category>> categories() async {
    final list = itemsOf(await client.get('/categories'), Category.fromJson)
        .where((c) => c.isActive)
        .toList()
      ..sort((a, b) => a.position.compareTo(b.position));
    return list;
  }

  Future<List<City>> cities() async =>
      itemsOf(await client.get('/cities'), City.fromJson).where((c) => c.isActive).toList();

  Future<PublicSettings> publicSettings() async =>
      PublicSettings.fromJson(asMap(await client.get('/settings/public')) ?? const {});

  // -------------------------------------------------------- Prestataires
  Future<List<ProviderCard>> providers({
    double? lat,
    double? lng,
    double? radiusKm,
    String? categoryId,
    String? q,
    String? sort,
    bool? online,
    int? limit,
  }) async =>
      itemsOf(
        await client.get('/providers', query: {
          'lat': lat,
          'lng': lng,
          'radius_km': radiusKm,
          'category_id': categoryId,
          'q': q,
          'sort': sort,
          if (online == true) 'online': 'true',
          'limit': limit,
        }),
        ProviderCard.fromJson,
      );

  Future<ProviderDetail> provider(String id, {double? lat, double? lng}) async =>
      ProviderDetail.fromJson(
          asMap(await client.get('/providers/$id', query: {'lat': lat, 'lng': lng}))!);

  Future<List<Review>> providerReviews(String id, {int page = 1, int limit = 20}) async =>
      itemsOf(
        await client.get('/providers/$id/reviews', query: {'page': page, 'limit': limit}),
        Review.fromJson,
      );

  Future<bool> toggleFollow(String id) async =>
      asBool(asMap(await client.post('/providers/$id/follow'))?['is_followed']);

  /// Recherche d'un prestataire par code Tasko (`TSK-XXXXX`) ou par téléphone.
  Future<ProviderCard> lookupProvider({String? code, String? phone}) async =>
      ProviderCard.fromJson(asMap(await client.get('/providers/lookup', query: {
        'code': code,
        'phone': phone,
      }))!);

  /// Invitation SMS d'une personne sans compte Tasko.
  Future<void> invite(String phone) => client.post('/invitations', body: {'phone': phone});

  // ------------------------------------------------------------ Missions
  Future<Quote> quote(int price) async =>
      Quote.fromJson(asMap(await client.get('/jobs/quote', query: {'price': price}))!);

  Future<Job> createJob({
    required String categoryId,
    required String description,
    required String address,
    required double lat,
    required double lng,
    required String urgency,
    DateTime? scheduledAt,
    int? budget,
    String? providerId,
    String? photoUrl,
    String? otherService,
    String mode = JobMode.instant,
    String? title,
    DateTime? bidDeadline,
    String? visibility,
    List<String>? invitedProviderIds,
    int? budgetMin,
    int? budgetMax,
    String? propertyId,
    List<MilestoneDraft>? milestones,
  }) async =>
      Job.fromJson(asMap(await client.post('/jobs', body: {
        'mode': mode,
        'category_id': categoryId,
        'title': ?title,
        'description': description,
        'address': address,
        'lat': lat,
        'lng': lng,
        'urgency': urgency,
        if (scheduledAt != null) 'scheduled_at': scheduledAt.toUtc().toIso8601String(),
        'budget': ?budget,
        'provider_id': ?providerId,
        'photo_url': ?photoUrl,
        'other_label': ?otherService,
        if (bidDeadline != null) 'bid_deadline': bidDeadline.toUtc().toIso8601String(),
        'visibility': ?visibility,
        if (invitedProviderIds != null && invitedProviderIds.isNotEmpty)
          'invited_provider_ids': invitedProviderIds,
        'budget_min': ?budgetMin,
        'budget_max': ?budgetMax,
        'property_id': ?propertyId,
        if (milestones != null && milestones.isNotEmpty)
          'milestones': milestones.map((m) => m.toJson()).toList(),
      }))!);

  /// Le prestataire propose une mission déjà négociée à un client (`POST /jobs/offer`).
  Future<Job> offerJob({
    required String clientPhone,
    required String categoryId,
    String? title,
    required String description,
    required int price,
    String? address,
    double? lat,
    double? lng,
    DateTime? scheduledAt,
    List<MilestoneDraft>? milestones,
  }) async =>
      Job.fromJson(asMap(await client.post('/jobs/offer', body: {
        'client_phone': clientPhone,
        'category_id': categoryId,
        if (title != null && title.isNotEmpty) 'title': title,
        'description': description,
        'price': price,
        if (address != null && address.isNotEmpty) 'address': address,
        'lat': ?lat,
        'lng': ?lng,
        if (scheduledAt != null) 'scheduled_at': scheduledAt.toUtc().toIso8601String(),
        if (milestones != null && milestones.isNotEmpty)
          'milestones': milestones.map((m) => m.toJson()).toList(),
      }))!);

  Future<String> upload(List<int> bytes, String filename) async =>
      asString(asMap(await client.upload('/uploads', bytes: bytes, filename: filename))?['url']);

  Future<List<Job>> jobs({String? as, String? status}) async => itemsOf(
      await client.get('/jobs', query: {'as': as, 'status': status}), Job.fromJson);

  Future<List<Job>> nearbyJobs({double? lat, double? lng}) async => itemsOf(
      await client.get('/jobs/nearby', query: {'lat': lat, 'lng': lng}), Job.fromJson);

  Future<Job> job(String id) async => Job.fromJson(asMap(await client.get('/jobs/$id'))!);

  Future<Job> acceptJob(String id, {int? price}) async => Job.fromJson(
      asMap(await client.post('/jobs/$id/accept', body: {'price': ?price}))!);

  Future<void> declineJob(String id) => client.post('/jobs/$id/decline');

  Future<PaymentResult> payJob(
    String id, {
    required String method,
    required String phone,
    String? milestoneId,
  }) async =>
      PaymentResult.fromJson(asMap(await client.post('/jobs/$id/pay', body: {
        'method': method,
        'phone': phone,
        'milestone_id': ?milestoneId,
      }))!);

  /// Avance le statut (prestataire). `in_progress` exige [startCode] ;
  /// `done` accepte des photos de preuve et une note.
  Future<Job> updateJobStatus(
    String id,
    String status, {
    String? startCode,
    List<String>? proofPhotos,
    String? note,
  }) async =>
      Job.fromJson(asMap(await client.post('/jobs/$id/status', body: {
        'status': status,
        'start_code': ?startCode,
        if (proofPhotos != null && proofPhotos.isNotEmpty) 'proof_photos': proofPhotos,
        if (note != null && note.isNotEmpty) 'note': note,
      }))!);

  Future<Job> submitMilestone(
    String jobId,
    String milestoneId, {
    List<String>? proofPhotos,
    String? note,
  }) async =>
      Job.fromJson(asMap(await client.post('/jobs/$jobId/milestones/$milestoneId/submit', body: {
        if (proofPhotos != null && proofPhotos.isNotEmpty) 'proof_photos': proofPhotos,
        if (note != null && note.isNotEmpty) 'note': note,
      }))!);

  Future<Job> releaseMilestone(String jobId, String milestoneId) async => Job.fromJson(
      asMap(await client.post('/jobs/$jobId/milestones/$milestoneId/release'))!);

  Future<Receipt> receipt(String jobId) async =>
      Receipt.fromJson(asMap(await client.get('/jobs/$jobId/receipt'))!);

  Future<Job> completeJob(String id, {int? rating, String? comment}) async =>
      Job.fromJson(asMap(await client.post('/jobs/$id/complete', body: {
        'rating': ?rating,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
      }))!);

  Future<Review> reviewJob(String id, {required int rating, String? comment}) async =>
      Review.fromJson(asMap(await client.post('/jobs/$id/review', body: {
        'rating': rating,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
      }))!);

  Future<Job> cancelJob(String id, {String? reason}) async => Job.fromJson(
      asMap(await client.post('/jobs/$id/cancel', body: {'reason': ?reason}))!);

  Future<Job> disputeJob(
    String id,
    String reason, {
    String kind = 'other',
    List<String>? photos,
    String? milestoneId,
  }) async =>
      Job.fromJson(asMap(await client.post('/jobs/$id/dispute', body: {
        'reason': reason,
        'kind': kind,
        if (photos != null && photos.isNotEmpty) 'photos': photos,
        'milestone_id': ?milestoneId,
      }))!);

  /// Le client signale que le prestataire n'est pas venu (RG-G11).
  Future<Job> reportNoShow(String id, {String? message}) async =>
      Job.fromJson(asMap(await client.post('/jobs/$id/no-show', body: {
        if (message != null && message.isNotEmpty) 'message': message,
      }))!);

  // ------------------------------------------------- Litiges / médiation
  Future<Dispute> dispute(String id) async =>
      Dispute.fromJson(asMap(await client.get('/disputes/$id'))!);

  Future<List<Message>> disputeMessages(String id) async =>
      itemsOf(await client.get('/disputes/$id/messages'), Message.fromJson);

  /// Message du salon de médiation (`text` ou `image`, body = URL pour une image).
  Future<Message> sendDisputeMessage(String id, {String type = 'text', required String body}) async =>
      Message.fromJson(asMap(
          await client.post('/disputes/$id/messages', body: {'type': type, 'body': body}))!);

  Future<Proposal> propose(String id, {required int providerAmount, String? message}) async =>
      Proposal.fromJson(asMap(await client.post('/disputes/$id/proposals', body: {
        'provider_amount': providerAmount,
        if (message != null && message.isNotEmpty) 'message': message,
      }))!);

  Future<Dispute> answerProposal(String id, String proposalId, {required bool accept}) async =>
      Dispute.fromJson(asMap(await client
          .post('/disputes/$id/proposals/$proposalId/${accept ? 'accept' : 'reject'}'))!);

  // ------------------------------------------------------ Appels d'offres
  Future<List<Job>> tenders({String? categoryId, String? q}) async => itemsOf(
      await client.get('/tenders', query: {'category_id': categoryId, 'q': q}), Job.fromJson);

  Future<Bid> submitBid(
    String jobId, {
    required int amount,
    int? durationDays,
    String? message,
    List<String>? attachments,
    List<MilestoneDraft>? milestones,
  }) async =>
      Bid.fromJson(asMap(await client.post('/jobs/$jobId/bids', body: {
        'amount': amount,
        'duration_days': ?durationDays,
        if (message != null && message.isNotEmpty) 'message': message,
        if (attachments != null && attachments.isNotEmpty) 'attachments': attachments,
        if (milestones != null && milestones.isNotEmpty)
          'milestones': milestones.map((m) => m.toJson()).toList(),
      }))!);

  Future<List<Bid>> bids(String jobId) async =>
      itemsOf(await client.get('/jobs/$jobId/bids'), Bid.fromJson);

  Future<void> withdrawBid(String jobId, String bidId) =>
      client.delete('/jobs/$jobId/bids/$bidId');

  Future<Job> awardBid(String jobId, String bidId) async =>
      Job.fromJson(asMap(await client.post('/jobs/$jobId/bids/$bidId/award'))!);

  // ------------------------------------------------ Entreprise & immobilier
  /// Passe en compte entreprise (ou revient en particulier avec `null`).
  Future<User> setBusiness(BusinessInfo? business) async =>
      User.fromJson(asMap(business == null
          ? await client.putNull('/me/business')
          : await client.put('/me/business', body: business.toJson()))!);

  Future<List<Property>> properties() async =>
      itemsOf(await client.get('/properties'), Property.fromJson);

  Future<PropertyDetail> property(String id) async =>
      PropertyDetail.fromJson(asMap(await client.get('/properties/$id'))!);

  Future<Property> createProperty(Json body) async =>
      Property.fromJson(asMap(await client.post('/properties', body: body))!);

  Future<Property> updateProperty(String id, Json body) async =>
      Property.fromJson(asMap(await client.patch('/properties/$id', body: body))!);

  Future<void> deleteProperty(String id) => client.delete('/properties/$id');

  Future<List<RecurringJob>> recurringJobs() async =>
      itemsOf(await client.get('/recurring-jobs'), RecurringJob.fromJson);

  Future<RecurringJob> createRecurringJob(Json body) async =>
      RecurringJob.fromJson(asMap(await client.post('/recurring-jobs', body: body))!);

  Future<RecurringJob> updateRecurringJob(String id, Json body) async =>
      RecurringJob.fromJson(asMap(await client.patch('/recurring-jobs/$id', body: body))!);

  Future<void> deleteRecurringJob(String id) => client.delete('/recurring-jobs/$id');

  // --------------------------------------------------------- Portefeuille
  Future<Wallet> wallet() async =>
      Wallet.fromJson(asMap(await client.get('/me/wallet')) ?? const {});

  Future<Transaction> withdraw({
    required int amount,
    required String method,
    required String phone,
  }) async {
    final data = asMap(await client.post('/me/wallet/withdraw',
        body: {'amount': amount, 'method': method, 'phone': phone}))!;
    return Transaction.fromJson(asMap(data['transaction']) ?? data);
  }

  Future<Transaction> transaction(String id) async =>
      Transaction.fromJson(asMap(await client.get('/transactions/$id'))!);

  // ---------------------------------------------------------- Messagerie
  Future<List<Conversation>> conversations() async =>
      itemsOf(await client.get('/conversations'), Conversation.fromJson);

  Future<Conversation> openConversation(String userId, {String? jobId}) async =>
      Conversation.fromJson(asMap(await client.post('/conversations', body: {
        'user_id': userId,
        'job_id': ?jobId,
      }))!);

  Future<List<Message>> messages(String conversationId, {DateTime? before, int limit = 50}) async =>
      itemsOf(
        await client.get('/conversations/$conversationId/messages', query: {
          'before': before?.toUtc().toIso8601String(),
          'limit': limit,
        }),
        Message.fromJson,
      );

  Future<Message> sendMessage(
    String conversationId, {
    String type = 'text',
    String? body,
    double? lat,
    double? lng,
  }) async =>
      Message.fromJson(asMap(await client.post('/conversations/$conversationId/messages', body: {
        'type': type,
        'body': ?body,
        'lat': ?lat,
        'lng': ?lng,
      }))!);

  Future<void> markConversationRead(String conversationId) =>
      client.post('/conversations/$conversationId/read');

  // ------------------------------------------------------- Notifications
  Future<NotificationPage> notifications({String? type}) async => NotificationPage.fromJson(
      asMap(await client.get('/notifications', query: {'type': type})) ?? const {});

  Future<void> readAllNotifications() => client.post('/notifications/read-all');
}
