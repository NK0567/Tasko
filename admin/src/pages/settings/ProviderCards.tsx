import { Check, ExternalLink, X } from 'lucide-react';
import type { PaymentProvider, PaymentProviderInfo, PayoutProviderSetting } from '../../api/types';
import { PROVIDER_DESCRIPTION, PROVIDER_LABEL, feeFlatLabel, feeRateLabel } from '../../lib/providers';

const CAPABILITIES: { key: keyof PaymentProviderInfo['supports']; label: string }[] = [
  { key: 'collect', label: 'Encaissement' },
  { key: 'payout_momo', label: 'Versement MoMo' },
  { key: 'payout_bank', label: 'Virement bancaire' },
  { key: 'balance', label: 'Solde' },
];

function Capability({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="row" style={{ gap: 6, color: ok ? 'var(--green-700)' : 'var(--gray-500)' }}>
      {ok ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
      <span>
        {label}
        <span className="sr-only">{ok ? ' : oui' : ' : non'}</span>
      </span>
    </li>
  );
}

/** Choix du fournisseur d'encaissement : une carte par fournisseur (configuré, capacités, frais publiés). */
export function ProviderCards({
  providers,
  value,
  current,
  onChange,
}: {
  providers: PaymentProviderInfo[];
  value: PaymentProvider;
  /** Valeur enregistrée : sélectionnable même si le fournisseur n'est plus configuré. */
  current: PaymentProvider;
  onChange: (v: PaymentProvider) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Fournisseur de paiement (encaissements)" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
      {providers.map((p) => {
        const selected = value === p.id;
        const selectable = (p.configured || p.id === current) && p.supports.collect;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!selectable}
            onClick={() => onChange(p.id)}
            aria-label={`${PROVIDER_LABEL[p.id] ?? p.name}${p.configured ? '' : ' (non configuré : clés absentes de l’environnement du serveur)'}`}
            style={{
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 14,
              borderRadius: 'var(--radius)',
              border: `2px solid ${selected ? (p.id === 'mock' ? 'var(--gray-500)' : 'var(--red)') : 'var(--gray-200)'}`,
              background: selected ? (p.id === 'mock' ? 'var(--gray-100)' : 'var(--red-100)') : 'var(--card)',
              cursor: selectable ? 'pointer' : 'not-allowed',
              opacity: selectable ? 1 : 0.65,
              font: 'inherit',
              color: 'inherit',
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <strong>{PROVIDER_LABEL[p.id] ?? p.name}</strong>
              <span className={`badge ${p.configured ? 'tone-green' : 'tone-gray'}`}>{p.configured ? 'Configuré' : 'Non configuré'}</span>
            </div>
            <span className="small muted">{PROVIDER_DESCRIPTION[p.id]}</span>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }} className="small">
              {CAPABILITIES.map((c) => (
                <Capability key={c.key} ok={p.supports[c.key]} label={c.label} />
              ))}
            </ul>
            {p.id !== 'mock' && (
              <div className="small" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: 6 }}>
                Frais publiés : encaissement {feeRateLabel(p.fees.collect_rate)} · versement {feeRateLabel(p.fees.payout_rate)} · virement bancaire{' '}
                {feeFlatLabel(p.fees.bank_flat)}
              </div>
            )}
            {p.docs_url && (
              <a className="small" href={p.docs_url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                Documentation <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Choix du fournisseur des versements (prestataires, retraits) : « identique » ou un fournisseur qui sait verser. */
export function PayoutProviderSelect({
  providers,
  value,
  current,
  collectProvider,
  onChange,
}: {
  providers: PaymentProviderInfo[];
  value: PayoutProviderSetting;
  current: PayoutProviderSetting;
  collectProvider: PaymentProvider;
  onChange: (v: PayoutProviderSetting) => void;
}) {
  const collect = providers.find((p) => p.id === collectProvider);
  const effective = value === 'same' ? collect : providers.find((p) => p.id === value);
  return (
    <div className="field">
      <label htmlFor="payout-provider" className="label">
        Fournisseur pour les versements
      </label>
      <select id="payout-provider" className="input" value={value} onChange={(e) => onChange(e.target.value as PayoutProviderSetting)}>
        <option value="same">Identique aux encaissements ({PROVIDER_LABEL[collectProvider]})</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id} disabled={!(p.configured || p.id === current) || !p.supports.payout_momo}>
            {PROVIDER_LABEL[p.id] ?? p.name}
            {!p.configured ? ' — non configuré' : !p.supports.payout_momo ? ' — pas de versement' : ''}
          </option>
        ))}
      </select>
      <span className="hint">
        Versements aux prestataires, retraits de portefeuille et retraits de vos revenus. Exemple : encaisser avec Monetbil et verser avec
        Campay (pensez à approvisionner le compte de versement).
      </span>
      {effective && !effective.supports.payout_momo && (
        <span className="field-error" role="alert">
          {effective.name} ne verse pas automatiquement : les gains des prestataires resteront dans leur portefeuille Tasko et vous serez alerté à
          chaque versement. Choisissez un fournisseur de versement.
        </span>
      )}
    </div>
  );
}
