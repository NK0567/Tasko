// Types reflétant docs/05-contrat-api.md (snake_case, montants entiers FCFA), V1 + V2 (§5).
// Les champs V2 sont optionnels quand ils enrichissent un objet V1, pour rester tolérant
// envers un backend partiellement migré.

export type ID = string;
export type ISODate = string;

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'PAYMENT_FAILED'
  | 'INTERNAL'
  | 'NETWORK';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: Record<string, unknown> };
}

export interface ListResponse<T> {
  items: T[];
}
export interface Paginated<T> extends ListResponse<T> {
  total: number;
  page: number;
  limit: number;
}

export type UserStatus = 'active' | 'suspended';
export type VerificationLevel = 1 | 2 | 3 | 4 | 5;
export type ProviderType = 'artisan' | 'student' | 'professional' | 'freelancer' | 'company';
export type MomoOperator = 'mtn' | 'orange';
export type Plan = 'free' | 'pro';

export interface ProviderSkill {
  category_id: ID;
  name: string;
  parent_name: string | null;
  icon: string;
  base_price: number;
}
export interface PortfolioItem {
  id: ID;
  title: string;
  image_url: string;
}
export interface ProviderProfile {
  user_id: ID;
  headline: string | null;
  bio: string | null;
  provider_type: ProviderType;
  years_experience: number;
  is_online: boolean;
  lat: number | null;
  lng: number | null;
  rating_avg: number;
  rating_count: number;
  missions_completed: number;
  completion_rate: number;
  momo_number: string | null;
  momo_operator: MomoOperator | null;
  plan: Plan;
  pro_until: ISODate | null;
  featured_until: ISODate | null;
  available_days: number[];
  skills: ProviderSkill[];
  portfolio: PortfolioItem[];
  /** V2 — code Tasko public (ex. TSK-7F3K9). */
  public_code?: string | null;
  /** V2 — annulations côté prestataire (impacte son score). */
  cancellations?: number;
  /** §5.9 — absences constatées / litiges perdus. */
  no_shows?: number;
  disputes_lost?: number;
  /** V2 — fonds libérés non encore versés (versement MoMo échoué / en attente). */
  wallet_available?: number;
}

export type AccountType = 'individual' | 'business';
export type BusinessKind = 'company' | 'real_estate' | 'ngo' | 'administration' | 'other';
export interface Business {
  name: string;
  kind: BusinessKind;
  niu: string | null;
  rccm: string | null;
  address: string | null;
}
/** Réputation du client (RG-G7). Signalé à l'admin si disputes_lost >= 3. */
export interface ClientTrust {
  rating_avg: number | null;
  rating_count: number;
  jobs_paid: number;
  disputes_lost: number;
}

export interface User {
  id: ID;
  full_name: string;
  phone: string;
  email: string | null;
  avatar_url: string | null;
  city: string | null;
  is_provider: boolean;
  is_admin: boolean;
  status: UserStatus;
  verification_level: VerificationLevel;
  created_at: ISODate;
  provider: ProviderProfile | null;
  /** V2 — type de compte (§5.4). */
  account_type?: AccountType;
  business?: Business | null;
  /** V2 — réputation client (RG-G7), si renvoyée par /admin/users. */
  trust?: ClientTrust | null;
}

export interface Category {
  id: ID;
  parent_id: ID | null;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
  color: string | null;
  position: number;
  is_active: boolean;
  providers_count: number;
  children?: Category[];
}
export interface CategoryInput {
  name: string;
  description?: string;
  icon: string;
  color?: string;
  parent_id?: ID | null;
  position?: number;
  is_active?: boolean;
}

export type JobStatus =
  | 'requested'
  | 'accepted'
  | 'funded'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'done'
  | 'completed'
  | 'cancelled'
  | 'disputed';
export type PaymentStatus = 'unpaid' | 'pending' | 'held' | 'released' | 'refunded';
export type Urgency = 'now' | 'today' | 'scheduled';

export interface JobParty {
  id: ID;
  full_name: string;
  avatar_url: string | null;
  /** V2 : null tant que funds_secured = false (RG-G8). */
  phone: string | null;
}
export interface JobClient extends JobParty {
  trust?: ClientTrust | null;
}
export interface JobProvider extends JobParty {
  headline: string | null;
  rating_avg: number;
  lat: number | null;
  lng: number | null;
  public_code?: string | null;
  /** §5.9 RG-G15 — compteurs du prestataire, si renvoyés. */
  no_shows?: number;
  disputes_lost?: number;
}

export type JobMode = 'instant' | 'direct' | 'tender';
export type JobOrigin = 'client' | 'provider_offer';
export type TenderVisibility = 'public' | 'invited';
export type CompletedBy = 'client' | 'auto' | 'admin';
export type CancelledBy = 'client' | 'provider' | 'admin' | 'system';
export type MilestoneStatus = 'pending' | 'funded' | 'submitted' | 'released' | 'refunded' | 'disputed';
export interface Milestone {
  id: ID;
  position: number;
  title: string;
  amount: number;
  service_fee: number;
  status: MilestoneStatus;
  funded_at: ISODate | null;
  submitted_at: ISODate | null;
  auto_release_at: ISODate | null;
  released_at: ISODate | null;
  proof_photos: string[];
  note: string | null;
}
export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';
export interface BidProvider {
  id: ID;
  full_name: string;
  avatar_url: string | null;
  headline?: string | null;
  rating_avg?: number;
  rating_count?: number;
  missions_completed?: number;
  verification_level?: number;
}
export interface Bid {
  id: ID;
  job_id: ID;
  provider: BidProvider;
  amount: number;
  duration_days: number | null;
  message: string | null;
  attachments: string[];
  milestones: { title: string; amount: number }[];
  status: BidStatus;
  created_at: ISODate;
}

export interface Job {
  id: ID;
  client: JobClient;
  provider: JobProvider | null;
  category: { id: ID; name: string; icon: string; parent_name: string | null };
  title: string;
  description: string;
  photo_url: string | null;
  address: string;
  lat: number;
  lng: number;
  urgency: Urgency;
  scheduled_at: ISODate | null;
  budget: number;
  price: number;
  service_fee: number;
  total: number;
  provider_commission: number;
  provider_payout: number;
  status: JobStatus;
  payment_status: PaymentStatus;
  distance_km?: number | null;
  created_at: ISODate;
  accepted_at: ISODate | null;
  started_at: ISODate | null;
  completed_at: ISODate | null;
  review: { rating: number; comment: string | null } | null;

  // ---- V2 (§5.6) ----
  mode?: JobMode;
  origin?: JobOrigin;
  visibility?: TenderVisibility | null;
  bid_deadline?: ISODate | null;
  budget_min?: number | null;
  budget_max?: number | null;
  bids_count?: number;
  funds_secured?: boolean;
  funded_at?: ISODate | null;
  /** Jamais affiché dans l'admin (réservé au client du job). */
  start_code?: string | null;
  done_at?: ISODate | null;
  auto_release_at?: ISODate | null;
  completed_by?: CompletedBy | null;
  completion_proof?: { photos: string[]; note: string | null } | null;
  cancellation_fee?: number;
  cancel_reason?: string | null;
  cancelled_by?: CancelledBy | null;
  milestones?: Milestone[];
  property?: { id: ID; name: string } | null;
  dispute?: { id: ID; status: DisputeStatus; reason: string } | null;
  /** §5.9 RG-G11 */
  arrival_deadline?: ISODate | null;
}

export interface JobQuery {
  status?: JobStatus | '';
  mode?: JobMode | '';
  q?: string;
  page?: number;
  limit?: number;
}

export type TransactionType =
  | 'escrow_in'
  | 'payout'
  | 'commission'
  | 'refund'
  | 'subscription'
  | 'boost'
  // V2 (§5.5)
  | 'cancellation_fee'
  | 'partial_refund'
  | 'withdrawal'
  | 'revenue_withdrawal';
export type TransactionMethod = 'mtn_momo' | 'orange_money' | 'card';
export type PaymentProvider = 'mock' | 'notchpay' | 'campay' | 'monetbil';
/** Fournisseur des versements : 'same' = celui des encaissements. */
export type PayoutProviderSetting = 'same' | PaymentProvider;
/** GET /admin/payment-providers */
export interface PaymentProviderInfo {
  id: PaymentProvider;
  name: string;
  /** Clés présentes dans l'environnement du serveur. */
  configured: boolean;
  supports: { collect: boolean; payout_momo: boolean; payout_bank: boolean; balance: boolean };
  /** Frais publiés ; null = non publiés (tarif négocié). */
  fees: { collect_rate: number | null; payout_rate: number | null; bank_flat: number | null };
  docs_url: string | null;
}
export type TransactionStatus = 'pending' | 'success' | 'failed';
export interface Transaction {
  id: ID;
  job_id: ID | null;
  user_id: ID;
  type: TransactionType;
  amount: number;
  method: TransactionMethod | null;
  phone: string | null;
  provider: PaymentProvider;
  external_ref: string | null;
  status: TransactionStatus;
  created_at: ISODate;
}
export interface AdminTransaction extends Transaction {
  user_name: string | null;
}

export interface Review {
  id: ID;
  job_id: ID;
  author: { id: ID; full_name: string; avatar_url: string | null };
  rating: number;
  comment: string | null;
  created_at: ISODate;
}
export interface AdminReview extends Review {
  target_name: string | null;
}

export type AutoSettlement = 'off' | 'daily' | 'weekly';
export interface Settings {
  client_fee_rate: number;
  provider_commission_rate: number;
  min_service_fee: number;
  search_radius_km: number;
  avg_speed_kmh: number;
  pro_plan_price: number;
  boost_day_price: number;
  boost_month_price: number;
  currency: string;
  otp_dev_mode: boolean;
  payment_provider: PaymentProvider;
  payout_provider?: PayoutProviderSetting;
  support_phone: string;
  // ---- V2 (§5.6) — sécurité des paiements, appels d'offres, trésorerie ----
  auto_release_hours?: number;
  require_start_code?: boolean;
  require_completion_proof?: boolean;
  cancellation_fee_en_route?: number;
  dispute_response_hours?: number;
  mask_contacts_until_funded?: boolean;
  tender_default_days?: number;
  max_bids_per_tender?: number;
  auto_payout?: boolean;
  auto_settlement?: AutoSettlement;
  auto_settlement_min?: number;
  // ---- V2 §5.9 — prestataire absent & médiation ----
  no_show_hours?: number;
  no_show_grace_hours?: number;
  no_show_response_hours?: number;
  dispute_decision_hours?: number;
  four_eyes_threshold?: number;
  suspension_threshold?: number;
}

export interface AdminStats {
  users_total: number;
  users_growth_pct: number;
  providers_total: number;
  providers_growth_pct: number;
  jobs_today: number;
  jobs_growth_pct: number;
  gmv_today: number;
  revenue_today: number;
  revenue_growth_pct: number;
  gmv_month: number;
  revenue_month: number;
  active_providers: number;
  cancellation_rate: number;
  avg_basket: number;
  disputes_open: number;
}
export interface TimeseriesPoint {
  date: string;
  jobs: number;
  gmv: number;
  revenue: number;
  new_users: number;
}
export interface CategoryStat {
  category_id: ID;
  name: string;
  icon: string;
  jobs: number;
  gmv: number;
  revenue: number;
}
export interface CityStat {
  city: string;
  jobs: number;
  gmv: number;
  revenue: number;
}
export type ActivityType = 'provider_signup' | 'category_created' | 'job_completed' | 'payment' | 'dispute';
export interface ActivityItem {
  type: ActivityType;
  title: string;
  subtitle: string | null;
  avatar_url: string | null;
  created_at: ISODate;
}

export interface CategorySuggestion {
  label: string;
  count: number;
  last_at: ISODate;
}

export type DisputeStatus = 'open' | 'pending_confirmation' | 'resolved';
export type DisputeKind = 'quality' | 'no_show' | 'not_validated' | 'other';
export type PartyRole = 'client' | 'provider' | 'admin';
export type ResolvedBy = 'admin' | 'agreement' | 'system';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';
/** Proposition d'accord amiable (RG-G13). */
export interface Proposal {
  id: ID;
  author: { id: ID; full_name: string; role: PartyRole };
  provider_amount: number;
  client_refund: number;
  message: string | null;
  client_accepted: boolean | null;
  provider_accepted: boolean | null;
  status: ProposalStatus;
  created_at: ISODate;
}
export type MediationMessageType = 'text' | 'image' | 'location' | 'system' | 'proposal';
/** Message du salon de médiation (RG-G12) — horodaté, non modifiable. */
export interface MediationMessage {
  id: ID;
  conversation_id: ID;
  sender_id: ID | null;
  sender_role?: PartyRole | 'system' | null;
  sender_name?: string | null;
  type: MediationMessageType;
  /** text : contenu ; image : URL ; proposal : id de la proposition. */
  body: string;
  created_at: ISODate;
}
export type DisputeResolution = 'release' | 'refund' | 'split';
export interface DisputeEvidence {
  author: { id: ID; full_name: string };
  message: string;
  photos: string[];
  created_at: ISODate;
}
export interface Dispute {
  id: ID;
  job: Job;
  /** V2 §5.9 */
  kind?: DisputeKind;
  milestone_id?: ID | null;
  conversation_id?: ID | null;
  decision_due_at?: ISODate | null;
  proposals?: Proposal[];
  resolved_by?: ResolvedBy | null;
  resolution_note?: string | null;
  decided_by?: { id: ID; full_name: string } | null;
  confirmed_by?: { id: ID; full_name: string } | null;
  opened_by: { id: ID; full_name: string; role?: PartyRole };
  reason: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  /** V2 — preuves des deux parties et échéance de réponse. */
  evidence?: DisputeEvidence[];
  respond_before?: ISODate | null;
  /** V2 — montant attribué au prestataire (résolution `split`). */
  provider_amount?: number | null;
  /** Photos jointes à l'ouverture du litige (si renvoyées). */
  photos?: string[];
  /** Note de résolution (renvoyée par le backend, hors contrat). */
  note?: string | null;
  resolved_at?: ISODate | null;
  created_at: ISODate;
}
export interface ResolveDisputeInput {
  resolution: DisputeResolution;
  /** Obligatoire pour `split` : montant versé au prestataire, le reste est remboursé au client. */
  provider_amount?: number;
  note: string;
}

export interface Promotion {
  id: ID;
  code: string;
  description: string | null;
  discount_percent: number;
  max_uses: number | null;
  expires_at: ISODate | null;
  is_active: boolean;
  /** Compteur d'utilisations (colonne `used_count` côté backend, hors contrat). */
  used_count?: number;
}
export interface PromotionInput {
  code: string;
  description: string | null;
  discount_percent: number;
  max_uses: number | null;
  expires_at: ISODate | null;
  is_active: boolean;
}

export interface City {
  id: ID;
  name: string;
  lat: number;
  lng: number;
  is_active: boolean;
}
export type CityInput = Omit<City, 'id'>;

export interface AuthResponse {
  token: string;
  user: User;
}

export type UserRole = 'client' | 'provider' | 'admin';
export interface UserQuery {
  q?: string;
  role?: UserRole | '';
  status?: UserStatus | '';
  page?: number;
  limit?: number;
}
export interface UserPatch {
  status?: UserStatus;
  verification_level?: VerificationLevel;
  is_admin?: boolean;
}

// ---------- Trésorerie (§5.5) ----------
export interface Treasury {
  /** Fonds séquestrés des missions en cours — appartiennent aux clients/prestataires. */
  escrow_held: number;
  /** Fonds libérés dus aux prestataires (versement échoué / en attente). */
  providers_available: number;
  revenue_total: number;
  revenue_withdrawn: number;
  revenue_pending_withdrawal: number;
  /** Seul montant retirable par l'admin. */
  revenue_available: number;
  revenue_month: number;
  breakdown: {
    service_fees: number;
    commissions: number;
    subscriptions: number;
    boosts: number;
    cancellation_fees_kept: number;
  };
  aggregator_balance: number | null;
  aggregator_balances?: { provider: PaymentProvider; balance: number | null }[];
  collect_provider?: PaymentProvider;
  payout_provider?: PaymentProvider;
}
export interface LedgerPoint {
  date: string;
  escrow_in: number;
  payouts: number;
  refunds: number;
  revenue: number;
  withdrawals: number;
}
export type PayoutAccountType = 'bank' | 'mtn_momo' | 'orange_money';
export interface PayoutAccount {
  id: ID;
  type: PayoutAccountType;
  label: string;
  bank_name: string | null;
  account_holder: string | null;
  account_number_masked: string | null;
  phone_masked: string | null;
  is_default: boolean;
  created_at: ISODate;
}
export interface PayoutAccountInput {
  type: PayoutAccountType;
  label: string;
  bank_name?: string;
  account_holder?: string;
  account_number?: string;
  phone?: string;
  is_default?: boolean;
}
export type WithdrawalStatus = 'pending' | 'success' | 'failed';
export interface Withdrawal {
  id: ID;
  amount: number;
  fee: number;
  payout_account: PayoutAccount | null;
  status: WithdrawalStatus;
  external_ref: string | null;
  requested_by: { id: ID; full_name: string } | null;
  created_at: ISODate;
  completed_at: ISODate | null;
  failure_reason: string | null;
}
export interface WithdrawalInput {
  amount: number;
  payout_account_id: ID;
  password: string;
}

// ---------- Journal d'audit ----------
export interface AuditLog {
  id: ID;
  actor: { id: ID; full_name: string } | null;
  action: string;
  target: string | null;
  details: Record<string, unknown> | string | null;
  ip: string | null;
  created_at: ISODate;
}
