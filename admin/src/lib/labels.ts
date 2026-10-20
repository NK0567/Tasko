import type {
  AccountType,
  AutoSettlement,
  BidStatus,
  BusinessKind,
  CancelledBy,
  CompletedBy,
  DisputeKind,
  DisputeResolution,
  DisputeStatus,
  ProposalStatus,
  ResolvedBy,
  JobMode,
  JobStatus,
  MilestoneStatus,
  PayoutAccountType,
  WithdrawalStatus,
  PaymentStatus,
  ProviderType,
  TransactionMethod,
  TransactionStatus,
  TransactionType,
  Urgency,
  VerificationLevel,
} from '../api/types';

/**
 * Code couleur des statuts (cohérent partout) :
 * vert = tout va bien · orange = action requise / en attente · rouge = problème · gris = terminé / inactif.
 * bleu / violet restent réservés à l'identification (modes, rôles), jamais à un statut.
 */
export type Tone = 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'purple' | 'orange';

/** Clés d'icône autorisées par le contrat (Material Icons). */
export const ALLOWED_ICONS = [
  'construction',
  'home_repair_service',
  'spa',
  'computer',
  'school',
  'local_shipping',
  'shopping_basket',
  'directions_car',
  'checkroom',
  'celebration',
  'yard',
  'build',
  'handyman',
  'plumbing',
  'electrical_services',
  'cleaning_services',
  'local_laundry_service',
  'content_cut',
  'face',
  'brush',
  'photo_camera',
  'restaurant',
  'phone_android',
  'ac_unit',
  'chair',
  'child_care',
  'translate',
  'description',
  'print',
  'design_services',
  'videocam',
  'music_note',
  'pets',
  'agriculture',
  'fitness_center',
  'security',
  'key',
  'format_paint',
  'moving',
  'volunteer_activism',
  'more_horiz',
] as const;

export const COLOR_PRESETS = [
  '#0F7A3D',
  '#F5B700',
  '#E65100',
  '#E91E63',
  '#8E24AA',
  '#3949AB',
  '#1E88E5',
  '#00897B',
  '#43A047',
  '#6D4C41',
  '#546E7A',
  '#D32F2F',
];

export const VERIFICATION_LABELS: Record<VerificationLevel, string> = {
  1: 'Compte créé',
  2: 'Téléphone vérifié',
  3: 'Identité vérifiée',
  4: 'Compétence vérifiée',
  5: 'Prestataire recommandé',
};

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  artisan: 'Artisan',
  student: 'Étudiant',
  professional: 'Professionnel',
  freelancer: 'Débrouillard / Indépendant',
  company: 'Entreprise',
};

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  requested: { label: 'En attente de prestataire', tone: 'orange' },
  accepted: { label: 'En attente de paiement', tone: 'orange' },
  funded: { label: 'Payée (argent bloqué)', tone: 'green' },
  en_route: { label: 'Prestataire en route', tone: 'green' },
  arrived: { label: 'Prestataire sur place', tone: 'green' },
  in_progress: { label: 'Travail en cours', tone: 'green' },
  done: { label: 'À valider par le client', tone: 'orange' },
  completed: { label: 'Terminée', tone: 'gray' },
  cancelled: { label: 'Annulée', tone: 'gray' },
  disputed: { label: 'En litige', tone: 'red' },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  unpaid: { label: 'Non payé', tone: 'orange' },
  pending: { label: 'Paiement en cours', tone: 'orange' },
  held: { label: 'Argent bloqué (garanti)', tone: 'green' },
  released: { label: 'Versé au prestataire', tone: 'gray' },
  refunded: { label: 'Remboursé au client', tone: 'gray' },
};

export const TX_TYPE: Record<TransactionType, { label: string; tone: Tone }> = {
  escrow_in: { label: 'Paiement client (bloqué)', tone: 'blue' },
  payout: { label: 'Versement au prestataire', tone: 'purple' },
  commission: { label: 'Commission Tasko', tone: 'green' },
  refund: { label: 'Remboursement client', tone: 'orange' },
  subscription: { label: 'Abonnement Pro', tone: 'green' },
  boost: { label: 'Mise en avant (boost)', tone: 'green' },
  cancellation_fee: { label: "Frais d'annulation", tone: 'purple' },
  partial_refund: { label: 'Remboursement partiel', tone: 'orange' },
  withdrawal: { label: 'Retrait prestataire', tone: 'purple' },
  revenue_withdrawal: { label: 'Retrait de vos revenus', tone: 'gray' },
};

/** Types de transaction qui sortent de l'argent du coffre (affichés en négatif). */
export const TX_OUTFLOW: ReadonlySet<TransactionType> = new Set<TransactionType>([
  'payout',
  'refund',
  'partial_refund',
  'cancellation_fee',
  'withdrawal',
  'revenue_withdrawal',
]);
/** Types de transaction qui constituent un revenu Tasko. */
export const TX_REVENUE: ReadonlySet<TransactionType> = new Set<TransactionType>(['commission', 'subscription', 'boost']);

export const TX_STATUS: Record<TransactionStatus, { label: string; tone: Tone }> = {
  pending: { label: 'En cours', tone: 'orange' },
  success: { label: 'Réussie', tone: 'green' },
  failed: { label: 'Échouée', tone: 'red' },
};

export const TX_METHOD: Record<TransactionMethod, string> = {
  mtn_momo: 'MTN MoMo',
  orange_money: 'Orange Money',
  card: 'Carte',
};

export const URGENCY: Record<Urgency, string> = {
  now: 'Maintenant',
  today: "Aujourd'hui",
  scheduled: 'Planifiée',
};

export const JOB_MODE: Record<JobMode, { label: string; tone: Tone; hint: string }> = {
  instant: { label: 'Instantané', tone: 'blue', hint: 'Diffusée aux prestataires proches, le premier qui accepte l’obtient.' },
  direct: { label: 'Gré à gré', tone: 'purple', hint: 'Prestataire choisi par le client (ou offre du prestataire), jamais diffusée.' },
  tender: { label: "Appel d'offres", tone: 'orange', hint: 'Les prestataires soumettent des offres, le client attribue.' },
};

export const MILESTONE_STATUS: Record<MilestoneStatus, { label: string; tone: Tone }> = {
  pending: { label: 'À payer', tone: 'orange' },
  funded: { label: 'Argent bloqué', tone: 'green' },
  submitted: { label: 'Livré (à valider)', tone: 'orange' },
  released: { label: 'Versé', tone: 'gray' },
  refunded: { label: 'Remboursé', tone: 'gray' },
  disputed: { label: 'En litige', tone: 'red' },
};

export const BID_STATUS: Record<BidStatus, { label: string; tone: Tone }> = {
  pending: { label: 'En attente', tone: 'orange' },
  accepted: { label: 'Retenue', tone: 'green' },
  rejected: { label: 'Non retenue', tone: 'gray' },
  withdrawn: { label: 'Retirée', tone: 'gray' },
};

export const COMPLETED_BY: Record<CompletedBy, string> = {
  client: 'Validée par le client',
  auto: 'Libération automatique',
  admin: "Décision de l'admin",
};

export const CANCELLED_BY: Record<CancelledBy, string> = {
  client: 'le client',
  provider: 'le prestataire',
  admin: "l'admin",
  system: 'le système',
};

export const RESOLUTION: Record<DisputeResolution, { label: string; tone: Tone }> = {
  release: { label: 'Payé au prestataire', tone: 'gray' },
  refund: { label: 'Client remboursé', tone: 'gray' },
  split: { label: 'Montant partagé', tone: 'gray' },
};

export const WITHDRAWAL_STATUS: Record<WithdrawalStatus, { label: string; tone: Tone }> = {
  pending: { label: 'En cours', tone: 'orange' },
  success: { label: 'Réussi', tone: 'green' },
  failed: { label: 'Échoué', tone: 'red' },
};

export const PAYOUT_TYPE: Record<PayoutAccountType, string> = {
  bank: 'Compte bancaire',
  mtn_momo: 'MTN Mobile Money',
  orange_money: 'Orange Money',
};

export const ACCOUNT_TYPE: Record<AccountType, string> = {
  individual: 'Particulier',
  business: 'Entreprise',
};

export const BUSINESS_KIND: Record<BusinessKind, string> = {
  company: 'Société',
  real_estate: 'Immobilier',
  ngo: 'ONG / Association',
  administration: 'Administration',
  other: 'Autre',
};

export const AUTO_SETTLEMENT: Record<AutoSettlement, string> = {
  off: 'Désactivé',
  daily: 'Quotidien',
  weekly: 'Hebdomadaire',
};

/** Seuil d'alerte sur la réputation client (RG-G7). */
export const DISPUTES_LOST_ALERT = 3;

export const DISPUTE_STATUS: Record<DisputeStatus, { label: string; tone: Tone }> = {
  open: { label: 'À traiter', tone: 'red' },
  pending_confirmation: { label: 'À confirmer', tone: 'orange' },
  resolved: { label: 'Clos', tone: 'gray' },
};

export const DISPUTE_KIND: Record<DisputeKind, { label: string; hint: string }> = {
  quality: { label: 'Travail contesté', hint: 'Le client conteste la qualité ou la réalisation du travail.' },
  no_show: { label: 'Prestataire absent', hint: "Le prestataire n'est pas venu (code de démarrage non saisi à temps)." },
  not_validated: { label: 'Client ne valide pas', hint: 'Le prestataire a terminé mais le client ne valide pas.' },
  other: { label: 'Autre', hint: '' },
};

export const RESOLVED_BY: Record<ResolvedBy, string> = {
  admin: "Décision de l'équipe Tasko",
  agreement: 'Accord amiable des deux parties',
  system: 'Automatique (prestataire sans réponse)',
};

export const PROPOSAL_STATUS: Record<ProposalStatus, { label: string; tone: Tone }> = {
  pending: { label: 'En attente des réponses', tone: 'orange' },
  accepted: { label: 'Acceptée et exécutée', tone: 'green' },
  rejected: { label: 'Refusée', tone: 'red' },
  superseded: { label: 'Remplacée', tone: 'gray' },
};

/** Un litige est « urgent » si sa décision est due dans moins de 12 h (ou dépassée). */
export const URGENT_HOURS = 12;
export function isUrgent(decisionDueAt: string | null | undefined, now = Date.now()): boolean {
  if (!decisionDueAt) return false;
  const t = new Date(decisionDueAt).getTime();
  return !Number.isNaN(t) && t - now < URGENT_HOURS * 3600_000;
}
