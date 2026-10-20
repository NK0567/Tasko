import { many, one } from '../../db.js';
import { invalidState, notFound } from '../../utils/errors.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `${Number(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;

/** GET /jobs/:id/receipt — justificatif comptable (parties ou admin), numéroté à la première émission. */
export async function getReceipt(id, user) {
  const job = await one(
    `SELECT j.*, cu.full_name AS c_name, cu.business AS c_business, pu.full_name AS p_name, pp.public_code AS p_code
       FROM jobs j JOIN users cu ON cu.id = j.client_id LEFT JOIN users pu ON pu.id = j.provider_id
       LEFT JOIN provider_profiles pp ON pp.user_id = j.provider_id WHERE j.id = $1`,
    [id],
  );
  if (!job || (!user.is_admin && job.client_id !== user.id && job.provider_id !== user.id)) throw notFound('Mission introuvable');
  const [escrows, refunds, milestones] = await Promise.all([
    many(`SELECT * FROM transactions WHERE job_id = $1 AND type = 'escrow_in' AND status = 'success' ORDER BY created_at`, [id]),
    many(`SELECT * FROM transactions WHERE job_id = $1 AND type IN ('refund', 'partial_refund') AND status <> 'failed'`, [id]),
    many('SELECT * FROM job_milestones WHERE job_id = $1 ORDER BY position', [id]),
  ]);
  if (!escrows.length) throw invalidState('Aucun paiement enregistré pour cette mission : reçu indisponible');
  let no = job.receipt_no;
  if (!no) {
    const r = await one(
      `UPDATE jobs SET receipt_no = nextval('receipt_seq') WHERE id = $1 AND receipt_no IS NULL RETURNING receipt_no`,
      [id],
    );
    no = r?.receipt_no ?? (await one('SELECT receipt_no FROM jobs WHERE id = $1', [id])).receipt_no;
  }
  const issued = escrows[0].created_at;
  const paidMs = new Set(escrows.map((e) => e.milestone_id).filter(Boolean));
  const units = milestones.length ? milestones.filter((m) => paidMs.has(m.id)) : [job];
  const lines = milestones.length
    ? units.map((m) => ({ label: `Jalon ${m.position} — ${m.title}`, amount: m.amount }))
    : [{ label: job.title, amount: job.price }];
  const service_fee = units.reduce((s, u) => s + u.service_fee, 0);
  const total = escrows.reduce((s, e) => s + e.amount, 0);
  const refunded = refunds.reduce((s, r) => s + r.amount, 0);
  const last = escrows[escrows.length - 1];
  return {
    number: `TSK-${new Date(issued).getUTCFullYear()}-${String(no).padStart(6, '0')}`,
    issued_at: issued,
    job_id: job.id,
    client: { name: job.c_name, business: job.c_business || null },
    provider: { name: job.p_name, public_code: job.p_code },
    lines,
    service_fee,
    total,
    refunded,
    payment_method: last.method,
    payment_ref: last.external_ref,
    status: job.payment_status,
  };
}

export function receiptHtml(r) {
  const biz = r.client.business;
  const rows = r.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${money(l.amount)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reçu ${esc(r.number)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1b1b;max-width:720px;margin:24px auto;padding:0 16px}
h1{font-size:22px;margin:0}.muted{color:#666;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:16px}
td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.n{text-align:right;white-space:nowrap}
.tot td{font-weight:700;border-top:2px solid #1b1b1b}.grid{display:flex;gap:24px;flex-wrap:wrap;margin-top:16px}
@media print{body{margin:0}}
</style></head><body>
<h1>Tasko — Reçu ${esc(r.number)}</h1>
<p class="muted">Émis le ${esc(new Date(r.issued_at).toLocaleString('fr-FR', { timeZone: 'Africa/Douala' }))} · Statut du paiement : ${esc(r.status)}</p>
<div class="grid">
<div><strong>Client</strong><br>${esc(r.client.name)}${biz ? `<br>${esc(biz.name)}${biz.niu ? `<br>NIU : ${esc(biz.niu)}` : ''}${biz.rccm ? `<br>RCCM : ${esc(biz.rccm)}` : ''}${biz.address ? `<br>${esc(biz.address)}` : ''}` : ''}</div>
<div><strong>Prestataire</strong><br>${esc(r.provider.name || '—')}${r.provider.public_code ? `<br>Code Tasko : ${esc(r.provider.public_code)}` : ''}</div>
</div>
<table><thead><tr><th>Désignation</th><th class="n">Montant</th></tr></thead><tbody>
${rows}
<tr><td>Frais de service Tasko</td><td class="n">${money(r.service_fee)}</td></tr>
<tr class="tot"><td>Total payé</td><td class="n">${money(r.total)}</td></tr>
${r.refunded ? `<tr><td>Remboursé</td><td class="n">− ${money(r.refunded)}</td></tr>` : ''}
</tbody></table>
<p class="muted">Moyen de paiement : ${esc(r.payment_method || '—')} · Référence : ${esc(r.payment_ref || '—')}</p>
<p class="muted">Paiement sécurisé par Tasko : les fonds sont bloqués jusqu'à la validation de la prestation.</p>
</body></html>`;
}
