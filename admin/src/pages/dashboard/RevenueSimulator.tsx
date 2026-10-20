import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator, Info, RotateCcw } from 'lucide-react';
import { settingsApi } from '../../api/admin';
import { formatMoney, formatNumber, formatPct } from '../../lib/format';

interface SimState {
  jobsPerDay: number;
  avgPrice: number;
  clientFeePct: number;
  commissionPct: number;
  proSubscribers: number;
  boostsDayPerDay: number;
  boostsMonthPerMonth: number;
  momoFeePct: number;
  fixedCostsMonth: number;
}

const FALLBACK = { min_service_fee: 100, pro_plan_price: 3000, boost_day_price: 500, boost_month_price: 5000 };

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">{label}</span>
        <span className="num strong" style={{ color: 'var(--green-700)' }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default function RevenueSimulator() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const st = settings.data;
  const prices = {
    min_service_fee: st?.min_service_fee ?? FALLBACK.min_service_fee,
    pro_plan_price: st?.pro_plan_price ?? FALLBACK.pro_plan_price,
    boost_day_price: st?.boost_day_price ?? FALLBACK.boost_day_price,
    boost_month_price: st?.boost_month_price ?? FALLBACK.boost_month_price,
  };

  const initial = (): SimState => ({
    jobsPerDay: 200,
    avgPrice: 5000,
    clientFeePct: (st?.client_fee_rate ?? 0.05) * 100,
    commissionPct: (st?.provider_commission_rate ?? 0) * 100,
    proSubscribers: 100,
    boostsDayPerDay: 10,
    boostsMonthPerMonth: 20,
    momoFeePct: 2,
    fixedCostsMonth: 0,
  });
  const [sim, setSim] = useState<SimState>(initial);
  const [seeded, setSeeded] = useState(false);
  // Aligne les taux sur les paramètres réels dès qu'ils arrivent.
  useEffect(() => {
    if (st && !seeded) {
      setSim((s) => ({ ...s, clientFeePct: st.client_fee_rate * 100, commissionPct: st.provider_commission_rate * 100 }));
      setSeeded(true);
    }
  }, [st, seeded]);

  const set = <K extends keyof SimState>(k: K) => (v: SimState[K]) => setSim((s) => ({ ...s, [k]: v }));

  const r = useMemo(() => {
    const fee = sim.avgPrice > 0 ? Math.max(prices.min_service_fee, Math.round((sim.avgPrice * sim.clientFeePct) / 100)) : 0;
    const commission = Math.round((sim.avgPrice * sim.commissionPct) / 100);
    const revenuePerJob = fee + commission;
    const jobsMonth = sim.jobsPerDay * 30;
    const jobsRevenueMonth = revenuePerJob * jobsMonth;
    const subsMonth = sim.proSubscribers * prices.pro_plan_price;
    const boostsMonth = sim.boostsDayPerDay * 30 * prices.boost_day_price + sim.boostsMonthPerMonth * prices.boost_month_price;
    const grossMonth = jobsRevenueMonth + subsMonth + boostsMonth;
    // Encaissements Mobile Money : total payé par les clients + abonnements + boosts.
    const collectedMonth = (sim.avgPrice + fee) * jobsMonth + subsMonth + boostsMonth;
    const momoCostMonth = Math.round((collectedMonth * sim.momoFeePct) / 100);
    const netMonth = grossMonth - momoCostMonth - sim.fixedCostsMonth;
    return {
      fee,
      commission,
      revenuePerJob,
      jobsRevenueMonth,
      subsMonth,
      boostsMonth,
      grossDay: grossMonth / 30,
      grossMonth,
      grossYear: grossMonth * 12,
      gmvMonth: (sim.avgPrice + fee) * jobsMonth,
      momoCostMonth,
      netMonth,
      netYear: netMonth * 12,
      netMarginPct: grossMonth > 0 ? (netMonth / grossMonth) * 100 : 0,
    };
  }, [sim, prices.min_service_fee, prices.pro_plan_price, prices.boost_day_price, prices.boost_month_price]);

  return (
    <div className="card">
      <div className="card-head">
        <div className="row">
          <Calculator size={18} color="var(--green-700)" />
          <h2>Simulateur de revenus</h2>
          <span className="badge tone-yellow">Simulation, pas une prévision</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setSim(initial())}>
          <RotateCcw size={14} /> Réinitialiser
        </button>
      </div>
      <div className="card-body">
        <div className="grid grid-2-even" style={{ gap: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Slider label="Jobs par jour" value={sim.jobsPerDay} min={0} max={5000} step={10} onChange={set('jobsPerDay')} display={formatNumber(sim.jobsPerDay)} />
            <Slider label="Prix moyen d'un job" value={sim.avgPrice} min={500} max={50000} step={500} onChange={set('avgPrice')} display={formatMoney(sim.avgPrice)} />
            <Slider label="Frais de service client" value={sim.clientFeePct} min={0} max={20} step={0.5} onChange={set('clientFeePct')} display={formatPct(sim.clientFeePct)} />
            <Slider label="Commission prestataire" value={sim.commissionPct} min={0} max={25} step={0.5} onChange={set('commissionPct')} display={formatPct(sim.commissionPct)} />
            <Slider
              label={`Abonnés Tasko Pro (${formatMoney(prices.pro_plan_price)}/mois)`}
              value={sim.proSubscribers}
              min={0}
              max={5000}
              step={10}
              onChange={set('proSubscribers')}
              display={formatNumber(sim.proSubscribers)}
            />
            <Slider
              label={`Boosts journaliers vendus / jour (${formatMoney(prices.boost_day_price)})`}
              value={sim.boostsDayPerDay}
              min={0}
              max={500}
              step={1}
              onChange={set('boostsDayPerDay')}
              display={formatNumber(sim.boostsDayPerDay)}
            />
            <Slider
              label={`Boosts mensuels vendus / mois (${formatMoney(prices.boost_month_price)})`}
              value={sim.boostsMonthPerMonth}
              min={0}
              max={1000}
              step={5}
              onChange={set('boostsMonthPerMonth')}
              display={formatNumber(sim.boostsMonthPerMonth)}
            />
            <div className="divider" />
            <Slider label="Frais Mobile Money (sur encaissements)" value={sim.momoFeePct} min={0} max={5} step={0.1} onChange={set('momoFeePct')} display={formatPct(sim.momoFeePct)} />
            <Slider
              label="Coûts fixes mensuels (serveurs, SMS, équipe…)"
              value={sim.fixedCostsMonth}
              min={0}
              max={10_000_000}
              step={50_000}
              onChange={set('fixedCostsMonth')}
              display={formatMoney(sim.fixedCostsMonth)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {[
                { label: 'CA brut / jour', value: r.grossDay },
                { label: 'CA brut / mois', value: r.grossMonth },
                { label: 'CA brut / an', value: r.grossYear },
              ].map((t) => (
                <div key={t.label} style={{ background: 'var(--green-900)', color: '#fff', borderRadius: 12, padding: '14px 16px' }}>
                  <div className="small" style={{ color: '#9fc4b2' }}>
                    {t.label}
                  </div>
                  <div className="num" style={{ fontSize: 19, fontWeight: 700, fontFamily: 'var(--font-title)' }}>
                    {formatMoney(Math.round(t.value))}
                  </div>
                </div>
              ))}
            </div>

            <dl className="dl">
              <dt>Revenu Tasko par job</dt>
              <dd className="num">
                {formatMoney(r.revenuePerJob)}{' '}
                <span className="muted small">
                  (frais {formatMoney(r.fee)} + commission {formatMoney(r.commission)})
                </span>
              </dd>
              <dt>Volume transactionnel / mois</dt>
              <dd className="num">{formatMoney(r.gmvMonth)}</dd>
              <dt>Revenus jobs / mois</dt>
              <dd className="num">{formatMoney(r.jobsRevenueMonth)}</dd>
              <dt>Abonnements Pro / mois</dt>
              <dd className="num">{formatMoney(r.subsMonth)}</dd>
              <dt>Boosts / mois</dt>
              <dd className="num">{formatMoney(r.boostsMonth)}</dd>
            </dl>
            <div className="divider" style={{ margin: 0 }} />
            <dl className="dl">
              <dt>Coûts Mobile Money estimés / mois</dt>
              <dd className="num" style={{ color: 'var(--red)' }}>
                − {formatMoney(r.momoCostMonth)}
              </dd>
              <dt>Coûts fixes / mois</dt>
              <dd className="num" style={{ color: 'var(--red)' }}>
                − {formatMoney(sim.fixedCostsMonth)}
              </dd>
              <dt className="strong" style={{ color: 'var(--gray-900)' }}>
                Marge nette indicative / mois
              </dt>
              <dd className="num" style={{ fontWeight: 700, color: r.netMonth >= 0 ? 'var(--green-700)' : 'var(--red)' }}>
                {formatMoney(r.netMonth)} <span className="small muted">({formatPct(r.netMarginPct)})</span>
              </dd>
              <dt>Marge nette indicative / an</dt>
              <dd className="num">{formatMoney(r.netYear)}</dd>
            </dl>
            <div className="notice">
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Simulation, pas une prévision : hypothèses de 30 jours/mois, frais minimum de{' '}
                {formatMoney(prices.min_service_fee)} appliqué, frais Mobile Money calculés sur tous les encaissements
                (paiements clients, abonnements, boosts). Hors taxes, remboursements et coûts d'acquisition.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
