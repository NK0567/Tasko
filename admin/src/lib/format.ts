const NBSP = ' ';

/** 1248500 → "1 248 500" (séparateur de milliers = espace insécable). */
export function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (n < 0 ? '-' : '') + grouped + (dec ? `,${dec}` : '');
}

/** 1248500 → "1 248 500 FCFA" */
export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${formatNumber(Math.round(n))}${NBSP}FCFA`;
}

/** Version compacte pour les axes de graphique : 1 250 000 → "1,25 M". */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${formatNumber(n / 1_000_000, abs >= 10_000_000 ? 0 : 1)}${NBSP}M`;
  if (abs >= 1_000) return `${formatNumber(n / 1_000, 0)}${NBSP}k`;
  return formatNumber(n);
}

/** 0.05 → "5 %" ; accepte aussi une valeur déjà en pourcentage via isPct. */
export function formatRate(rate: number | null | undefined, decimals = 1): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return '—';
  const pct = rate * 100;
  const d = Number.isInteger(pct) ? 0 : decimals;
  return `${formatNumber(pct, d)}${NBSP}%`;
}

export function formatPct(pct: number | null | undefined, decimals = 1): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '—';
  const d = Number.isInteger(pct) ? 0 : decimals;
  return `${formatNumber(pct, d)}${NBSP}%`;
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? dateFmt.format(d) : '—';
}
export function formatDateTime(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? dateTimeFmt.format(d) : '—';
}
export function formatDay(iso: string): string {
  const d = toDate(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d ? dayFmt.format(d) : iso;
}

export function timeAgo(iso: string | null | undefined): string {
  const d = toDate(iso);
  if (!d) return '—';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  if (j < 30) return `il y a ${j} j`;
  return formatDate(iso);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Tarification du contrat : service_fee, commission, total, payout, revenu Tasko. */
export function quote(
  price: number,
  s: { client_fee_rate: number; provider_commission_rate: number; min_service_fee: number },
) {
  const service_fee = price > 0 ? Math.max(s.min_service_fee, Math.round(price * s.client_fee_rate)) : 0;
  const provider_commission = Math.round(price * s.provider_commission_rate);
  return {
    price,
    service_fee,
    total: price + service_fee,
    provider_commission,
    provider_payout: price - provider_commission,
    tasko_revenue: service_fee + provider_commission,
  };
}

/**
 * Saisie d'un montant FCFA : accepte espaces / espaces insécables / points de milliers
 * ("1 248 500", "1.248.500"). Renvoie un entier ≥ 0 ou null si invalide.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00a0\u202f.]/g, "").replace(/fcfa$/i, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

/** Normalise un numéro camerounais vers +237XXXXXXXXX (9 chiffres commençant par 6 ou 2). */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('237') && digits.length === 12 ? digits.slice(3) : digits;
  return /^[62]\d{8}$/.test(local) ? `+237${local}` : null;
}

/** Durée restante lisible jusqu'à une échéance ("dans 5 h", "dépassée depuis 2 h"). */
export function timeUntil(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMin = Math.round((d.getTime() - Date.now()) / 60000);
  const abs = Math.abs(diffMin);
  const txt = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} j`;
  return diffMin >= 0 ? `dans ${txt}` : `dépassée depuis ${txt}`;
}
