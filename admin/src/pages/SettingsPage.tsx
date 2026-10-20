import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, MapPin, Plus, Save, ShieldCheck } from 'lucide-react';
import { citiesApi, settingsApi } from '../api/admin';
import type { City, PaymentProvider, PayoutProviderSetting, Settings } from '../api/types';
import { useConfirm, useToast } from '../components/feedback-context';
import { Empty, ErrorState, Help, Loading, QueryState, Spinner, Switch } from '../components/ui';
import { formatMoney, formatRate, quote } from '../lib/format';
import { PROVIDER_LABEL, providerLabel } from '../lib/providers';
import { PayoutProviderSelect, ProviderCards } from './settings/ProviderCards';

/** Valeurs du formulaire : taux en pourcentage, nombres en chaînes pour l'édition. */
interface FormState {
  client_fee_pct: string;
  provider_commission_pct: string;
  min_service_fee: string;
  search_radius_km: string;
  avg_speed_kmh: string;
  pro_plan_price: string;
  boost_day_price: string;
  boost_month_price: string;
  payment_provider: PaymentProvider;
  payout_provider: PayoutProviderSetting;
  otp_dev_mode: boolean;
  support_phone: string;
  // V2 — sécurité des paiements
  auto_release_hours: string;
  dispute_response_hours: string;
  cancellation_fee_en_route: string;
  tender_default_days: string;
  max_bids_per_tender: string;
  require_start_code: boolean;
  require_completion_proof: boolean;
  mask_contacts_until_funded: boolean;
  auto_payout: boolean;
  // V2 §5.9 — médiation & prestataire absent
  no_show_hours: string;
  no_show_grace_hours: string;
  no_show_response_hours: string;
  dispute_decision_hours: string;
  four_eyes_threshold: string;
  suspension_threshold: string;
}

/** Valeurs par défaut du contrat (§5.6), utilisées si le backend ne renvoie pas encore le champ. */
const V2_DEFAULTS = {
  auto_release_hours: 48,
  dispute_response_hours: 48,
  cancellation_fee_en_route: 1000,
  tender_default_days: 7,
  max_bids_per_tender: 30,
  require_start_code: true,
  require_completion_proof: false,
  mask_contacts_until_funded: true,
  auto_payout: true,
  no_show_hours: 3,
  no_show_grace_hours: 2,
  no_show_response_hours: 12,
  dispute_decision_hours: 72,
  four_eyes_threshold: 100000,
  suspension_threshold: 3,
} as const;

/** Libellés lisibles pour le récapitulatif de confirmation. */
const FIELD_LABELS: Partial<Record<keyof Settings, string>> = {
  client_fee_rate: 'Frais de service client',
  provider_commission_rate: 'Commission prestataire',
  min_service_fee: 'Frais minimum',
  search_radius_km: 'Rayon de recherche',
  avg_speed_kmh: 'Vitesse moyenne',
  pro_plan_price: 'Prix Tasko Pro',
  boost_day_price: 'Boost 1 jour',
  boost_month_price: 'Boost 1 mois',
  payment_provider: 'Fournisseur de paiement (encaissements)',
  payout_provider: 'Fournisseur pour les versements',
  otp_dev_mode: 'Mode OTP développement',
  support_phone: 'Téléphone support',
  auto_release_hours: 'Délai de libération automatique',
  dispute_response_hours: 'Délai de réponse aux litiges',
  cancellation_fee_en_route: "Frais d'annulation en route",
  tender_default_days: "Durée par défaut des appels d'offres",
  max_bids_per_tender: "Offres max. par appel d'offres",
  require_start_code: 'Code de démarrage obligatoire',
  require_completion_proof: 'Preuve photo obligatoire',
  mask_contacts_until_funded: 'Masquage des contacts avant paiement',
  auto_payout: 'Versement automatique des prestataires',
  no_show_hours: "Délai d'arrivée (mission immédiate)",
  no_show_grace_hours: "Tolérance d'arrivée (mission planifiée)",
  no_show_response_hours: 'Délai de réponse du prestataire absent',
  dispute_decision_hours: 'Délai de décision Tasko',
  four_eyes_threshold: 'Seuil de double validation',
  suspension_threshold: "Seuil d'alerte de suspension",
};

function displayValue(k: keyof Settings, v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? 'activé' : 'désactivé';
  if (k === 'payout_provider' && v === 'same') return 'identique aux encaissements';
  if (k === 'payment_provider' || k === 'payout_provider') return providerLabel(String(v));
  if (k === 'client_fee_rate' || k === 'provider_commission_rate') return formatRate(Number(v));
  if (typeof v === 'number' && /price|fee|threshold|_min$/.test(k)) return formatMoney(v);
  if (/_hours$/.test(k)) return `${String(v)} h`;
  if (k === 'tender_default_days') return `${String(v)} j`;
  if (k === 'search_radius_km') return `${String(v)} km`;
  return String(v);
}

function ToggleRow({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
      <Switch checked={checked} onChange={onChange} label={label} />
      <div>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="strong">{label}</span>
          <Help label={label}>{children}</Help>
          <span className={`badge ${checked ? 'tone-green' : 'tone-gray'}`}>{checked ? 'Activé' : 'Désactivé'}</span>
        </div>
      </div>
    </div>
  );
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

function toForm(s: Settings): FormState {
  return {
    client_fee_pct: String(round4(s.client_fee_rate * 100)),
    provider_commission_pct: String(round4(s.provider_commission_rate * 100)),
    min_service_fee: String(s.min_service_fee),
    search_radius_km: String(s.search_radius_km),
    avg_speed_kmh: String(s.avg_speed_kmh),
    pro_plan_price: String(s.pro_plan_price),
    boost_day_price: String(s.boost_day_price),
    boost_month_price: String(s.boost_month_price),
    payment_provider: s.payment_provider,
    payout_provider: s.payout_provider ?? 'same',
    otp_dev_mode: s.otp_dev_mode,
    support_phone: s.support_phone,
    auto_release_hours: String(s.auto_release_hours ?? V2_DEFAULTS.auto_release_hours),
    dispute_response_hours: String(s.dispute_response_hours ?? V2_DEFAULTS.dispute_response_hours),
    cancellation_fee_en_route: String(s.cancellation_fee_en_route ?? V2_DEFAULTS.cancellation_fee_en_route),
    tender_default_days: String(s.tender_default_days ?? V2_DEFAULTS.tender_default_days),
    max_bids_per_tender: String(s.max_bids_per_tender ?? V2_DEFAULTS.max_bids_per_tender),
    require_start_code: s.require_start_code ?? V2_DEFAULTS.require_start_code,
    require_completion_proof: s.require_completion_proof ?? V2_DEFAULTS.require_completion_proof,
    mask_contacts_until_funded: s.mask_contacts_until_funded ?? V2_DEFAULTS.mask_contacts_until_funded,
    auto_payout: s.auto_payout ?? V2_DEFAULTS.auto_payout,
    no_show_hours: String(s.no_show_hours ?? V2_DEFAULTS.no_show_hours),
    no_show_grace_hours: String(s.no_show_grace_hours ?? V2_DEFAULTS.no_show_grace_hours),
    no_show_response_hours: String(s.no_show_response_hours ?? V2_DEFAULTS.no_show_response_hours),
    dispute_decision_hours: String(s.dispute_decision_hours ?? V2_DEFAULTS.dispute_decision_hours),
    four_eyes_threshold: String(s.four_eyes_threshold ?? V2_DEFAULTS.four_eyes_threshold),
    suspension_threshold: String(s.suspension_threshold ?? V2_DEFAULTS.suspension_threshold),
  };
}

function parse(f: FormState): { value: Partial<Settings>; errors: Partial<Record<keyof FormState, string>> } {
  const errors: Partial<Record<keyof FormState, string>> = {};
  const num = (k: keyof FormState, min: number, max: number, int: boolean) => {
    const raw = String(f[k]).replace(',', '.').trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
      errors[k] = int ? `Entier entre ${min} et ${max}.` : `Valeur entre ${min} et ${max}.`;
      return 0;
    }
    return n;
  };
  const value: Partial<Settings> = {
    client_fee_rate: round4(num('client_fee_pct', 0, 50, false) / 100),
    provider_commission_rate: round4(num('provider_commission_pct', 0, 50, false) / 100),
    min_service_fee: num('min_service_fee', 0, 100000, true),
    search_radius_km: num('search_radius_km', 1, 200, false),
    avg_speed_kmh: num('avg_speed_kmh', 1, 150, false),
    pro_plan_price: num('pro_plan_price', 0, 10_000_000, true),
    boost_day_price: num('boost_day_price', 0, 10_000_000, true),
    boost_month_price: num('boost_month_price', 0, 10_000_000, true),
    payment_provider: f.payment_provider,
    payout_provider: f.payout_provider,
    otp_dev_mode: f.otp_dev_mode,
    support_phone: f.support_phone.trim(),
    auto_release_hours: num('auto_release_hours', 1, 720, true),
    dispute_response_hours: num('dispute_response_hours', 1, 720, true),
    cancellation_fee_en_route: num('cancellation_fee_en_route', 0, 1_000_000, true),
    tender_default_days: num('tender_default_days', 1, 90, true),
    max_bids_per_tender: num('max_bids_per_tender', 1, 500, true),
    require_start_code: f.require_start_code,
    require_completion_proof: f.require_completion_proof,
    mask_contacts_until_funded: f.mask_contacts_until_funded,
    auto_payout: f.auto_payout,
    no_show_hours: num('no_show_hours', 1, 48, true),
    no_show_grace_hours: num('no_show_grace_hours', 0, 48, true),
    no_show_response_hours: num('no_show_response_hours', 1, 168, true),
    dispute_decision_hours: num('dispute_decision_hours', 1, 720, true),
    four_eyes_threshold: num('four_eyes_threshold', 0, 100_000_000, true),
    suspension_threshold: num('suspension_threshold', 1, 50, true),
  };
  if (!/^\+237[62]\d{8}$/.test(f.support_phone.trim())) errors.support_phone = 'Format attendu : +2376XXXXXXXX.';
  return { value, errors };
}

function NumField({
  id,
  label,
  suffix,
  value,
  onChange,
  error,
  hint,
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <div className="row" style={{ gap: 2 }}>
        <label htmlFor={id} className="label">
          {label}
        </label>
        {hint && <Help label={label}>{hint}</Help>}
      </div>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          className={`input${error ? ' invalid' : ''}`}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ paddingRight: 64 }}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-help` : undefined}
        />
        <span className="muted small" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} aria-hidden>
          {suffix}
        </span>
      </div>
      {error ? (
        <span id={`${id}-help`} className="field-error">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-help`} className="sr-only">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function SettingsForm({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const providers = useQuery({ queryKey: ['payment-providers'], queryFn: settingsApi.providers });
  const [f, setF] = useState<FormState>(() => toForm(settings));
  useEffect(() => setF(toForm(settings)), [settings]);
  const set = <K extends keyof FormState>(k: K) => (v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const { value, errors } = parse(f);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(settings));

  const mut = useMutation({
    mutationFn: (patch: Partial<Settings>) => settingsApi.update(patch),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      toast.success('Paramètres enregistrés.');
    },
    onError: (e) => toast.error(e),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (hasErrors) {
      toast.error('Corrigez les champs en erreur.');
      return;
    }
    // Passage en argent réel (encaissement ou versement) : confirmation explicite en rouge.
    const effPayout = (s: { payment_provider: PaymentProvider; payout_provider: PayoutProviderSetting }) =>
      s.payout_provider === 'same' ? s.payment_provider : s.payout_provider;
    const before = { payment_provider: settings.payment_provider, payout_provider: settings.payout_provider ?? 'same' };
    const realChanges: string[] = [];
    if (f.payment_provider !== 'mock' && f.payment_provider !== before.payment_provider) {
      realChanges.push(`les clients seront réellement débités via ${PROVIDER_LABEL[f.payment_provider]}`);
    }
    if (effPayout(f) !== 'mock' && effPayout(f) !== effPayout(before)) {
      realChanges.push(`les versements partiront réellement via ${PROVIDER_LABEL[effPayout(f)]}`);
    }
    if (realChanges.length) {
      const ok = await confirm({
        title: 'Passer en paiements réels ?',
        message: (
          <>
            <p style={{ marginTop: 0, color: 'var(--red)', fontWeight: 600 }}>Attention : de l’argent réel va circuler — {realChanges.join(' ; ')}.</p>
            <p style={{ marginBottom: 0 }}>
              Vérifiez les clés du serveur, l’URL de webhook déclarée chez le fournisseur et faites d’abord un petit paiement de test.
            </p>
          </>
        ),
        confirmLabel: 'Passer en réel',
        danger: true,
      });
      if (!ok) return;
    }
    const patch: Partial<Settings> = {};
    (Object.keys(value) as (keyof Settings)[]).forEach((k) => {
      if (value[k] !== settings[k]) (patch as Record<string, unknown>)[k] = value[k];
    });
    const keys = Object.keys(patch) as (keyof Settings)[];
    if (keys.length === 0) return;
    const ok = await confirm({
      title: `Enregistrer ${keys.length} modification${keys.length > 1 ? 's' : ''} ?`,
      message: (
        <>
          <p style={{ marginTop: 0 }}>Ces réglages s'appliquent immédiatement aux nouvelles missions et aux paiements.</p>
          <dl className="dl">
            {keys.map((k) => (
              <Fragment key={k}>
                <dt>{FIELD_LABELS[k] ?? k}</dt>
                <dd className="num">
                  <span className="muted">{displayValue(k, settings[k])}</span> → {displayValue(k, patch[k])}
                </dd>
              </Fragment>
            ))}
          </dl>
        </>
      ),
      confirmLabel: 'Enregistrer',
      // Rouge si le changement touche l'argent (frais, commissions, fournisseur de paiement, seuils, prix).
      danger: keys.some((k) => /rate|fee|price|payment_provider|threshold|payout/.test(k)),
    });
    if (ok) mut.mutate(patch);
  }

  const price = 5000;
  const q = hasErrors
    ? null
    : quote(price, {
        client_fee_rate: value.client_fee_rate!,
        provider_commission_rate: value.provider_commission_rate!,
        min_service_fee: value.min_service_fee!,
      });

  return (
    <form onSubmit={submit} noValidate className="grid grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="card-head">
          <h2>Paramètres de la plateforme</h2>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section>
            <h3 style={{ marginBottom: 12 }}>Tarification</h3>
            <div className="form-grid">
              <NumField id="fee" label="Frais de service client" suffix="%" value={f.client_fee_pct} onChange={set('client_fee_pct')} error={errors.client_fee_pct} hint="Pourcentage ajouté au prix et payé par le client. C’est l’essentiel des revenus Tasko." />
              <NumField id="com" label="Commission prestataire" suffix="%" value={f.provider_commission_pct} onChange={set('provider_commission_pct')} error={errors.provider_commission_pct} hint="Pourcentage retenu sur ce que reçoit le prestataire (0 % par défaut)." />
              <NumField id="min" label="Frais minimum" suffix="FCFA" value={f.min_service_fee} onChange={set('min_service_fee')} error={errors.min_service_fee} hint="Frais de service minimum facturés au client, même sur une petite mission." />
            </div>
          </section>
          <section>
            <h3 style={{ marginBottom: 12 }}>Recherche & matching</h3>
            <div className="form-grid">
              <NumField id="radius" label="Rayon de recherche" suffix="km" value={f.search_radius_km} onChange={set('search_radius_km')} error={errors.search_radius_km} hint="Distance maximale entre le client et les prestataires proposés ou notifiés." />
              <NumField id="speed" label="Vitesse moyenne (ETA)" suffix="km/h" value={f.avg_speed_kmh} onChange={set('avg_speed_kmh')} error={errors.avg_speed_kmh} hint="Sert à estimer le temps d'arrivée affiché au client." />
            </div>
          </section>
          <section>
            <h3 style={{ marginBottom: 12 }}>Offres prestataires</h3>
            <div className="form-grid">
              <NumField id="pro" label="Tasko Pro (par mois)" suffix="FCFA" value={f.pro_plan_price} onChange={set('pro_plan_price')} error={errors.pro_plan_price} hint="Prix mensuel de l'abonnement Tasko Pro des prestataires (revenu Tasko)." />
              <NumField id="bday" label="Boost 1 jour" suffix="FCFA" value={f.boost_day_price} onChange={set('boost_day_price')} error={errors.boost_day_price} hint="Prix d'une mise en avant du prestataire pendant 24 h." />
              <NumField id="bmonth" label="Boost 1 mois" suffix="FCFA" value={f.boost_month_price} onChange={set('boost_month_price')} error={errors.boost_month_price} hint="Prix d'une mise en avant pendant 1 mois." />
            </div>
          </section>
          <section>
            <div className="row" style={{ marginBottom: 4 }}>
              <ShieldCheck size={18} color="var(--green-700)" aria-hidden />
              <h3>Sécurité des paiements (garantie Tasko)</h3>
            </div>
            <p className="hint" style={{ margin: '0 0 12px' }}>
              Protège le prestataire contre le client malhonnête, et le client contre le travail non fait.
            </p>
            <div className="form-grid">
              <NumField
                id="arh"
                label="Délai de libération automatique"
                suffix="heures"
                value={f.auto_release_hours}
                onChange={set('auto_release_hours')}
                error={errors.auto_release_hours}
                hint="Après « terminé », les fonds vont au prestataire si le client ne conteste pas (défaut 48 h)."
              />
              <NumField
                id="drh"
                label="Délai de réponse aux litiges"
                suffix="heures"
                value={f.dispute_response_hours}
                onChange={set('dispute_response_hours')}
                error={errors.dispute_response_hours}
                hint="Temps laissé aux deux parties pour déposer leurs preuves avant votre arbitrage."
              />
              <NumField
                id="cfe"
                label="Frais d'annulation « en route »"
                suffix="FCFA"
                value={f.cancellation_fee_en_route}
                onChange={set('cancellation_fee_en_route')}
                error={errors.cancellation_fee_en_route}
                hint="Versés au prestataire si le client annule alors qu'il est déjà en route (plafonnés au prix)."
              />
              <NumField
                id="tdd"
                label="Durée par défaut des appels d'offres"
                suffix="jours"
                value={f.tender_default_days}
                onChange={set('tender_default_days')}
                error={errors.tender_default_days}
                hint="Date limite de dépôt des offres proposée au client."
              />
              <NumField
                id="mbt"
                label="Offres max. par appel d'offres"
                suffix="offres"
                value={f.max_bids_per_tender}
                onChange={set('max_bids_per_tender')}
                error={errors.max_bids_per_tender}
                hint="Au-delà, l'appel d'offres n'accepte plus de nouvelle offre."
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <ToggleRow label="Code de démarrage obligatoire" checked={f.require_start_code} onChange={set('require_start_code')}>
                Le prestataire saisit le code à 4 chiffres du client pour démarrer : preuve de présence et d'accord.
              </ToggleRow>
              <ToggleRow label="Preuve photo obligatoire" checked={f.require_completion_proof} onChange={set('require_completion_proof')}>
                Le prestataire doit joindre des photos pour déclarer la mission terminée.
              </ToggleRow>
              <ToggleRow label="Masquer les contacts avant paiement" checked={f.mask_contacts_until_funded} onChange={set('mask_contacts_until_funded')}>
                Numéros cachés (y compris dans le chat) tant que l'argent n'est pas sécurisé : limite le contournement de la plateforme.
              </ToggleRow>
              <ToggleRow label="Versement automatique des prestataires" checked={f.auto_payout} onChange={set('auto_payout')}>
                Envoi immédiat sur le MoMo du prestataire à chaque libération ; sinon les fonds restent dans son portefeuille.
              </ToggleRow>
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>
              Le reversement automatique de <em>vos</em> revenus se règle dans la page Trésorerie.
            </p>
          </section>
          <section>
            <h3 style={{ marginBottom: 4 }}>Médiation & prestataire absent</h3>
            <p className="hint" style={{ margin: '0 0 12px' }}>
              L'argent bloqué ne retourne jamais au client sur sa seule demande : ces délais encadrent la médiation à trois.
            </p>
            <div className="form-grid">
              <NumField id="nsh" label="Délai d'arrivée (mission immédiate)" suffix="heures" value={f.no_show_hours} onChange={set('no_show_hours')} error={errors.no_show_hours} hint="Après le paiement d'une mission « maintenant », le prestataire a ce délai pour saisir le code de démarrage ; sinon le client peut signaler son absence (défaut 3 h)." />
              <NumField id="nsg" label="Tolérance d'arrivée (mission planifiée)" suffix="heures" value={f.no_show_grace_hours} onChange={set('no_show_grace_hours')} error={errors.no_show_grace_hours} hint="Retard toléré après l'heure prévue avant de pouvoir signaler une absence (défaut 2 h)." />
              <NumField id="nsr" label="Réponse du prestataire signalé absent" suffix="heures" value={f.no_show_response_hours} onChange={set('no_show_response_hours')} error={errors.no_show_response_hours} hint="Sans réponse du prestataire dans ce délai, le client est remboursé automatiquement et l'absence est comptée (défaut 12 h)." />
              <NumField id="ddh" label="Délai de décision Tasko" suffix="heures" value={f.dispute_decision_hours} onChange={set('dispute_decision_hours')} error={errors.dispute_decision_hours} hint="Temps maximum pour trancher un litige après son ouverture. Vous êtes alerté à l'ouverture et 12 h avant l'échéance (défaut 72 h)." />
              <NumField id="fet" label="Seuil de double validation" suffix="FCFA" value={f.four_eyes_threshold} onChange={set('four_eyes_threshold')} error={errors.four_eyes_threshold} hint="Au-delà de ce montant, une décision de litige doit être confirmée par un second administrateur (défaut 100 000 FCFA)." />
              <NumField id="sth" label="Seuil d'alerte de suspension" suffix="litiges" value={f.suspension_threshold} onChange={set('suspension_threshold')} error={errors.suspension_threshold} hint="Nombre de litiges perdus (ou d'absences) à partir duquel vous êtes alerté pour suspendre le compte (défaut 3)." />
            </div>
          </section>
          <section>
            <h3 style={{ marginBottom: 12 }}>Paiements & sécurité</h3>
            <div className="row" style={{ gap: 2, marginBottom: 8 }}>
              <span className="label" id="pp-label">Fournisseur de paiement (encaissements)</span>
              <Help label="Fournisseur de paiement">« Simulateur » : aucun argent ne bouge (tests). NotchPay, Campay, Monetbil : vrais paiements Mobile Money, sélectionnables seulement si leurs clés sont configurées sur le serveur. Chaque transaction garde le fournisseur qui l’a traitée.</Help>
            </div>
            {providers.isLoading ? (
              <Spinner />
            ) : providers.isError || !providers.data ? (
              <ErrorState error={providers.error} onRetry={() => void providers.refetch()} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                <ProviderCards providers={providers.data.items} value={f.payment_provider} current={settings.payment_provider} onChange={set('payment_provider')} />
                <PayoutProviderSelect
                  providers={providers.data.items}
                  value={f.payout_provider}
                  current={settings.payout_provider ?? 'same'}
                  collectProvider={f.payment_provider}
                  onChange={set('payout_provider')}
                />
              </div>
            )}
            <div className="form-grid">
              <div className="field">
                <div className="row" style={{ gap: 2 }}>
                  <span className="label" id="otp-label">Mode OTP développement</span>
                  <Help label="Mode OTP développement">En test, le code SMS de connexion est renvoyé par l’API au lieu d’être envoyé par SMS. À désactiver en production.</Help>
                </div>
                <div className="row" style={{ height: 40 }}>
                  <Switch checked={f.otp_dev_mode} onChange={set('otp_dev_mode')} label="Mode OTP développement" />
                  <span className="small">{f.otp_dev_mode ? 'Code OTP renvoyé par l’API (dev)' : 'OTP envoyé par SMS'}</span>
                </div>
              </div>
              <div className="field">
                <div className="row" style={{ gap: 2 }}>
                  <label htmlFor="support" className="label">Téléphone support</label>
                  <Help label="Téléphone support">Numéro affiché aux clients et prestataires pour contacter Tasko.</Help>
                </div>
                <input id="support" className={`input${errors.support_phone ? ' invalid' : ''}`} value={f.support_phone} onChange={(e) => set('support_phone')(e.target.value)} />
                {errors.support_phone && <span className="field-error">{errors.support_phone}</span>}
              </div>
            </div>
            {f.otp_dev_mode && (
              <div className="notice" style={{ marginTop: 12 }}>
                <Info size={16} style={{ flexShrink: 0 }} />À désactiver en production : le code OTP est visible dans les réponses de l’API.
              </div>
            )}
          </section>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn btn-secondary" disabled={!dirty || mut.isPending} onClick={() => setF(toForm(settings))}>
              Annuler les modifications
            </button>
            <button type="submit" className="btn" disabled={!dirty || mut.isPending}>
              {mut.isPending ? <Spinner small /> : <Save size={16} />} Enregistrer
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ position: 'sticky', top: 16 }}>
        <div className="card-head">
          <h2>Aperçu</h2>
          {dirty && <span className="badge tone-yellow">Non enregistré</span>}
        </div>
        <div className="card-body">
          {q ? (
            <>
              <p style={{ marginTop: 0 }}>
                Sur un job de <strong>{formatMoney(price)}</strong> :
              </p>
              <dl className="dl">
                <dt>Le client paie</dt>
                <dd className="num strong">{formatMoney(q.total)}</dd>
                <dt>Le prestataire reçoit</dt>
                <dd className="num strong">{formatMoney(q.provider_payout)}</dd>
                <dt style={{ color: 'var(--green-700)', fontWeight: 600 }}>Tasko gagne</dt>
                <dd className="num" style={{ color: 'var(--green-700)', fontWeight: 700 }}>
                  {formatMoney(q.tasko_revenue)}
                </dd>
              </dl>
              <div className="divider" />
              <div className="small muted">
                Frais client {formatMoney(q.service_fee)} (max(minimum, prix × taux)) + commission {formatMoney(q.provider_commission)}.
              </div>
            </>
          ) : (
            <span className="muted">Corrigez les champs pour voir l’aperçu.</span>
          )}
        </div>
      </div>
    </form>
  );
}

function Cities() {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ['cities'], queryFn: citiesApi.list });
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const latN = Number(lat.replace(',', '.'));
  const lngN = Number(lng.replace(',', '.'));
  const errs = {
    name: !name.trim() ? 'Nom requis.' : '',
    lat: lat === '' || !Number.isFinite(latN) || latN < -90 || latN > 90 ? 'Latitude entre -90 et 90.' : '',
    lng: lng === '' || !Number.isFinite(lngN) || lngN < -180 || lngN > 180 ? 'Longitude entre -180 et 180.' : '',
  };
  const invalid = Object.values(errs).some(Boolean);

  const add = useMutation({
    mutationFn: () => citiesApi.create({ name: name.trim(), lat: latN, lng: lngN, is_active: true }),
    onSuccess: (c) => {
      toast.success(`${c.name} ajoutée.`);
      setName('');
      setLat('');
      setLng('');
      setTouched(false);
      void qc.invalidateQueries({ queryKey: ['cities'] });
    },
    onError: (e) => toast.error(e),
  });

  async function toggle(c: City, v: boolean) {
    setBusy(c.id);
    try {
      await citiesApi.update(c.id, { is_active: v });
      toast.success(`${c.name} ${v ? 'activée' : 'désactivée'}.`);
      void qc.invalidateQueries({ queryKey: ['cities'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="row">
          <MapPin size={18} color="var(--green-700)" />
          <h2>Villes & zones couvertes</h2>
        </div>
      </div>
      <div className="card-body">
        <form
          className="toolbar"
          style={{ alignItems: 'flex-start', marginBottom: 16 }}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!invalid) add.mutate();
          }}
        >
          <div className="field grow" style={{ minWidth: 180 }}>
            <input className={`input${touched && errs.name ? ' invalid' : ''}`} placeholder="Nom (ex. Bafoussam)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom de la ville" />
            {touched && errs.name && <span className="field-error">{errs.name}</span>}
          </div>
          <div className="field" style={{ width: 130 }}>
            <input className={`input${touched && errs.lat ? ' invalid' : ''}`} placeholder="Latitude" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} aria-label="Latitude" />
            {touched && errs.lat && <span className="field-error">{errs.lat}</span>}
          </div>
          <div className="field" style={{ width: 130 }}>
            <input className={`input${touched && errs.lng ? ' invalid' : ''}`} placeholder="Longitude" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} aria-label="Longitude" />
            {touched && errs.lng && <span className="field-error">{errs.lng}</span>}
          </div>
          <button className="btn" type="submit" disabled={add.isPending}>
            {add.isPending ? <Spinner small /> : <Plus size={16} />} Ajouter
          </button>
        </form>
        <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<Empty title="Aucune ville configurée" />}>
          {(d) => (
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 420 }}>
                <thead>
                  <tr>
                    <th>Ville</th>
                    <th className="right">Latitude</th>
                    <th className="right">Longitude</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.items]
                    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
                    .map((c) => (
                      <tr key={c.id}>
                        <td className="strong">{c.name}</td>
                        <td className="right num">{Number(c.lat).toFixed(4)}</td>
                        <td className="right num">{Number(c.lng).toFixed(4)}</td>
                        <td>
                          <div className="row">
                            <Switch checked={c.is_active} disabled={busy === c.id} onChange={(v) => void toggle(c, v)} label={`Activer ${c.name}`} />
                            <span className="small muted">{c.is_active ? 'Active' : 'Inactive'}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const query = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Paramètres</h1>
          <p>Frais, commissions, offres, paiement et zones couvertes.</p>
        </div>
      </div>
      {query.isLoading ? (
        <div className="card">
          <Loading />
        </div>
      ) : query.isError || !query.data ? (
        <div className="card">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : (
        <SettingsForm settings={query.data} />
      )}
      <Cities />
    </div>
  );
}
