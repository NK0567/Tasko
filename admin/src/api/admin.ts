import { http, request, upload } from './client';
import type {
  PaymentProviderInfo,
  ActivityItem,
  AdminReview,
  AdminStats,
  AdminTransaction,
  AuditLog,
  AuthResponse,
  Bid,
  Category,
  CategoryInput,
  CategoryStat,
  CategorySuggestion,
  City,
  CityInput,
  CityStat,
  Dispute,
  DisputeKind,
  DisputeStatus,
  MediationMessage,
  Proposal,
  ID,
  Job,
  JobQuery,
  LedgerPoint,
  ListResponse,
  Paginated,
  PayoutAccount,
  PayoutAccountInput,
  Promotion,
  PromotionInput,
  ResolveDisputeInput,
  Settings,
  TimeseriesPoint,
  TransactionStatus,
  TransactionType,
  Treasury,
  User,
  UserPatch,
  UserQuery,
  Withdrawal,
  WithdrawalInput,
} from './types';

type Ok = { ok: true };

export const authApi = {
  login: (phone: string, password: string) =>
    request<AuthResponse>('POST', '/auth/login', { body: { phone, password }, skipAuthRedirect: true }),
  me: () => http.get<User>('/me'),
};

export const statsApi = {
  overview: () => http.get<AdminStats>('/admin/stats'),
  timeseries: (days = 30) => http.get<ListResponse<TimeseriesPoint>>('/admin/stats/timeseries', { days }),
  categories: (days = 30) => http.get<ListResponse<CategoryStat>>('/admin/stats/categories', { days }),
  cities: (days = 30) => http.get<ListResponse<CityStat>>('/admin/stats/cities', { days }),
  activity: (limit = 20) => http.get<ListResponse<ActivityItem>>('/admin/activity', { limit }),
};

export const usersApi = {
  list: (q: UserQuery) => http.get<Paginated<User>>('/admin/users', { ...q }),
  update: (id: ID, patch: UserPatch) => http.patch<User>(`/admin/users/${id}`, patch),
};

export const categoriesApi = {
  list: () => http.get<ListResponse<Category>>('/admin/categories'),
  create: (input: CategoryInput) => http.post<Category>('/admin/categories', input),
  update: (id: ID, patch: Partial<CategoryInput>) => http.patch<Category>(`/admin/categories/${id}`, patch),
  remove: (id: ID) => http.del<Ok>(`/admin/categories/${id}`),
  reorder: (ids: ID[]) => http.post<Ok>('/admin/categories/reorder', { ids }),
  suggestions: () => http.get<ListResponse<CategorySuggestion>>('/admin/category-suggestions'),
};

export const jobsApi = {
  list: (q: JobQuery) => http.get<Paginated<Job>>('/admin/jobs', { ...q }),
  /** Offres d'un appel d'offres (§5.7 `GET /jobs/:id/bids`). */
  bids: (jobId: ID) => http.get<ListResponse<Bid>>(`/jobs/${jobId}/bids`),
};

export const transactionsApi = {
  list: (q: { type?: TransactionType | ''; status?: TransactionStatus | ''; page?: number; limit?: number }) =>
    http.get<Paginated<AdminTransaction>>('/admin/transactions', { ...q }),
};

export const disputesApi = {
  /** Triée par urgence (decision_due_at) côté serveur. */
  list: (status: DisputeStatus, kind?: DisputeKind | '') => http.get<ListResponse<Dispute>>('/admin/disputes', { status, kind }),
  /** Dossier complet (preuves, échéance) — `GET /disputes/:id`. */
  get: (id: ID) => http.get<Dispute>(`/disputes/${id}`),
  resolve: (id: ID, input: ResolveDisputeInput) => http.post<Dispute>(`/admin/disputes/${id}/resolve`, input),
  /** Double validation (second admin, différent du décideur). */
  confirm: (id: ID) => http.post<Dispute>(`/admin/disputes/${id}/confirm`),
  messages: (id: ID) => http.get<ListResponse<MediationMessage>>(`/disputes/${id}/messages`),
  sendMessage: (id: ID, input: { type: 'text' | 'image'; body: string }) =>
    http.post<MediationMessage>(`/disputes/${id}/messages`, input),
  propose: (id: ID, input: { provider_amount: number; message: string }) =>
    http.post<Proposal>(`/disputes/${id}/proposals`, input),
};

export const uploadsApi = {
  /** POST /uploads (multipart `file`) → { url } */
  image: (file: File) => upload('/uploads', file),
};

export const reviewsApi = {
  list: (q: { page?: number; limit?: number }) => http.get<Paginated<AdminReview>>('/admin/reviews', { ...q }),
  remove: (id: ID) => http.del<Ok>(`/admin/reviews/${id}`),
};

export const settingsApi = {
  get: () => http.get<Settings>('/admin/settings'),
  providers: () => http.get<ListResponse<PaymentProviderInfo>>('/admin/payment-providers'),
  update: (patch: Partial<Settings>) => http.put<Settings>('/admin/settings', patch),
};

export const promotionsApi = {
  list: () => http.get<ListResponse<Promotion>>('/admin/promotions'),
  create: (input: PromotionInput) => http.post<Promotion>('/admin/promotions', input),
  update: (id: ID, patch: Partial<PromotionInput>) => http.patch<Promotion>(`/admin/promotions/${id}`, patch),
  remove: (id: ID) => http.del<Ok>(`/admin/promotions/${id}`),
};

export const citiesApi = {
  list: () => http.get<ListResponse<City>>('/admin/cities'),
  create: (input: CityInput) => http.post<City>('/admin/cities', input),
  update: (id: ID, patch: Partial<CityInput>) => http.patch<City>(`/admin/cities/${id}`, patch),
};

// ---------- V2 : trésorerie ----------
export const treasuryApi = {
  overview: () => http.get<Treasury>('/admin/treasury'),
  ledger: (days = 30) => http.get<ListResponse<LedgerPoint>>('/admin/treasury/ledger', { days }),
  withdrawals: (q: { page?: number; limit?: number }) =>
    http.get<Paginated<Withdrawal>>('/admin/treasury/withdrawals', { ...q }),
  /**
   * Retrait des revenus. Un 401 signifie ici « mot de passe incorrect » : on ne déconnecte
   * donc pas automatiquement (skipAuthRedirect) ; l'erreur est affichée dans le formulaire.
   */
  withdraw: (input: WithdrawalInput) =>
    request<Withdrawal>('POST', '/admin/treasury/withdrawals', { body: input, skipAuthRedirect: true }),
};

export const payoutAccountsApi = {
  list: () => http.get<ListResponse<PayoutAccount>>('/admin/payout-accounts'),
  create: (input: PayoutAccountInput) => http.post<PayoutAccount>('/admin/payout-accounts', input),
  update: (id: ID, patch: Partial<Pick<PayoutAccountInput, 'label' | 'is_default'>>) =>
    http.patch<PayoutAccount>(`/admin/payout-accounts/${id}`, patch),
  remove: (id: ID) => http.del<Ok>(`/admin/payout-accounts/${id}`),
};

export const auditApi = {
  list: (q: { page?: number; limit?: number }) => http.get<Paginated<AuditLog>>('/admin/audit-logs', { ...q }),
};
