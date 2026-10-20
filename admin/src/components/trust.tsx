import { AlertTriangle, Star } from 'lucide-react';
import type { ClientTrust } from '../api/types';
import { formatNumber } from '../lib/format';
import { DISPUTES_LOST_ALERT } from '../lib/labels';
import { Badge } from './ui';

/** Badge d'alerte RG-G7 : client ayant perdu au moins 3 litiges. */
export function TrustAlert({ trust }: { trust: ClientTrust | null | undefined }) {
  if (!trust || trust.disputes_lost < DISPUTES_LOST_ALERT) return null;
  return (
    <Badge tone="red">
      <AlertTriangle size={12} aria-hidden /> {trust.disputes_lost} litiges perdus
    </Badge>
  );
}

/** Réputation client compacte : note · jobs payés · litiges perdus. */
export function TrustLine({ trust }: { trust: ClientTrust | null | undefined }) {
  if (!trust) return <span className="muted small">Réputation non disponible</span>;
  const alert = trust.disputes_lost >= DISPUTES_LOST_ALERT;
  return (
    <span className="row wrap small" style={{ gap: 8 }}>
      <span className="row" style={{ gap: 3 }}>
        <Star size={13} fill="#F5B700" color="#F5B700" aria-hidden />
        {trust.rating_count > 0 && trust.rating_avg !== null ? (
          <>
            {Number(trust.rating_avg).toFixed(1)} <span className="muted">({trust.rating_count})</span>
          </>
        ) : (
          <span className="muted">non noté</span>
        )}
      </span>
      <span>{formatNumber(trust.jobs_paid)} jobs payés</span>
      <span style={{ color: alert ? 'var(--red)' : undefined, fontWeight: alert ? 600 : undefined }}>
        {formatNumber(trust.disputes_lost)} litige{trust.disputes_lost > 1 ? 's' : ''} perdu{trust.disputes_lost > 1 ? 's' : ''}
      </span>
      {alert && (
        <Badge tone="red">
          <AlertTriangle size={12} aria-hidden /> Client signalé
        </Badge>
      )}
    </span>
  );
}
