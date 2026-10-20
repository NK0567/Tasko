// Seed de démonstration Tasko — idempotent : purge toutes les données puis recrée un jeu réaliste.
// Les mots de passe de démo sont écrits UNIQUEMENT dans seeds/README.md (réutilisés d'un run à l'autre).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';
import { seedV2 } from './v2.js';
import { slugify } from '../src/utils/slug.js';
import { DEFAULT_SETTINGS, computeQuote } from '../src/modules/settings/service.js';
import {
  CATEGORIES, CITIES, CLIENTS, JOB_DESCRIPTIONS, NEIGHBORHOODS, OTHER_CATEGORY, PROVIDERS, REVIEW_COMMENTS, SUGGESTIONS,
} from './data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const README = path.join(here, 'README.md');

// ------------------------------------------------------------------ utilitaires
let seedState = 20261003;
function rand() {
  // mulberry32 : données reproductibles
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const uuid = () => crypto.randomUUID();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.now();
const at = (ms) => new Date(ms);
const CENTER = { Y: { lat: 3.848, lng: 11.5021, name: 'Yaoundé' }, D: { lat: 4.0511, lng: 9.7679, name: 'Douala' } };

function scatter(center, minKm, maxKm) {
  const r = minKm + (maxKm - minKm) * Math.sqrt(rand());
  const a = rand() * 2 * Math.PI;
  const lat = center.lat + (r * Math.cos(a)) / 111.32;
  const lng = center.lng + (r * Math.sin(a)) / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

function genPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}

/** Relit les mots de passe existants (phone -> password) depuis seeds/README.md pour rester stables. */
function readExistingPasswords() {
  const map = new Map();
  if (!fs.existsSync(README)) return map;
  for (const line of fs.readFileSync(README, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\|[^|]*\|[^|]*\|\s*`?(\+237\d{9})`?\s*\|\s*`([^`]+)`\s*\|/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

async function insertMany(client, table, columns, rows, chunk = 400) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params = [];
    const values = part.map((row) => `(${row.map((v) => { params.push(v); return `$${params.length}`; }).join(', ')})`);
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`, params);
  }
}

// ------------------------------------------------------------------ seed
async function main() {
  const t0 = Date.now();
  const passwords = readExistingPasswords();
  const accounts = []; // pour README

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
    );
    if (!tables.length) throw new Error('Schéma absent : lancez d\'abord `npm run migrate`.');
    await client.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

    // ---- paramètres & villes
    await insertMany(client, 'settings', ['key', 'value'], Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, JSON.stringify(v)]));
    await insertMany(client, 'cities', ['name', 'lat', 'lng', 'is_active'], CITIES.map((c) => [c.name, c.lat, c.lng, c.is_active]));
    const settings = { ...DEFAULT_SETTINGS };

    // ---- catégories
    const catByName = new Map();
    const catRows = [];
    const usedSlugs = new Set();
    const slugFor = (name, parentSlug) => {
      let s = slugify(name);
      if (usedSlugs.has(s)) s = `${s}-${parentSlug}`;
      usedSlugs.add(s);
      return s;
    };
    const catCreated = NOW - 120 * DAY;
    CATEGORIES.forEach(([name, icon, color, description, children], i) => {
      const id = uuid();
      const slug = slugFor(name);
      catRows.push([id, null, name, slug, description, icon, color, i, true, at(catCreated)]);
      catByName.set(name, { id, parent: null, name });
      children.forEach(([cname, cicon], j) => {
        const cid = uuid();
        // Quelques sous-services ajoutés récemment (alimente le flux d'activité admin)
        const created = i === 3 && j >= 6 ? NOW - randInt(2, 20) * DAY : catCreated;
        catRows.push([cid, id, cname, slugFor(cname, slug), null, cicon, color, j, true, at(created)]);
        catByName.set(cname, { id: cid, parent: id, name: cname, parentName: name });
      });
    });
    const otherId = uuid();
    catRows.push([otherId, null, OTHER_CATEGORY[0], 'autre', OTHER_CATEGORY[3], OTHER_CATEGORY[1], OTHER_CATEGORY[2], CATEGORIES.length, true, at(catCreated)]);
    usedSlugs.add('autre');
    await insertMany(client, 'categories', ['id', 'parent_id', 'name', 'slug', 'description', 'icon', 'color', 'position', 'is_active', 'created_at'], catRows);

    // ---- utilisateurs
    const hashCache = new Map();
    const hashFor = async (pw) => {
      if (!hashCache.has(pw)) hashCache.set(pw, await bcrypt.hash(pw, 10));
      return hashCache.get(pw);
    };
    const pwFor = (phone) => {
      if (!passwords.has(phone)) passwords.set(phone, genPassword());
      return passwords.get(phone);
    };
    const userRows = [];
    const signupTime = (i, n) => {
      // ~55 % des comptes créés avant la fenêtre de 60 jours, le reste avec une croissance récente
      if (i < Math.ceil(n * 0.55)) return NOW - randInt(65, 150) * DAY - randInt(0, 20) * HOUR;
      return NOW - Math.floor(60 * DAY * (1 - Math.sqrt(rand()))) - randInt(1, 10) * HOUR;
    };

    const admin = { id: uuid(), name: 'Admin Tasko', phone: '+237600000001' };
    userRows.push([admin.id, admin.name, admin.phone, 'admin@tasko.cm', await hashFor(pwFor(admin.phone)), 'Yaoundé', false, true, 5, at(NOW - 200 * DAY)]);
    accounts.push(['Administrateur', admin.name, admin.phone]);

    const clients = [];
    for (let i = 0; i < CLIENTS.length; i++) {
      const [name, cityKey] = CLIENTS[i];
      const phone = `+2376700000${String(i + 1).padStart(2, '0')}`;
      const created = i === 0 ? NOW - 140 * DAY : signupTime(i, CLIENTS.length);
      const c = { id: uuid(), name, phone, cityKey, created };
      clients.push(c);
      userRows.push([c.id, name, phone, null, await hashFor(pwFor(phone)), CENTER[cityKey].name, false, false, chance(0.5) ? 2 : 3, at(created)]);
      accounts.push([i === 0 ? 'Client (démo principal)' : 'Client', name, phone]);
    }

    const providers = [];
    for (let i = 0; i < PROVIDERS.length; i++) {
      const [name, headline, type, cityKey, skills, level, years, opts] = PROVIDERS[i];
      const phone = `+2376900000${String(i + 1).padStart(2, '0')}`;
      const created = i < 2 ? NOW - randInt(110, 140) * DAY : signupTime(i, PROVIDERS.length);
      const pos = scatter(CENTER[cityKey], 0.2, 6);
      const p = {
        id: uuid(), name, headline, type, cityKey, phone, created, pos, level, years, opts,
        skills: skills.map(([s, price]) => {
          const cat = catByName.get(s);
          if (!cat) throw new Error(`Service inconnu dans le seed : ${s}`);
          return { ...cat, price };
        }),
        quality: 3.9 + rand() * 1.1,
        weight: (opts.pro ? 2 : 1) * (opts.featured ? 1.5 : 1) * (0.6 + rand()),
      };
      providers.push(p);
      userRows.push([p.id, name, phone, null, await hashFor(pwFor(phone)), CENTER[cityKey].name, true, false, level, at(created)]);
      accounts.push(['Prestataire', `${name} — ${headline}`, phone]);
    }
    await insertMany(client, 'users', ['id', 'full_name', 'phone', 'email', 'password_hash', 'city', 'is_provider', 'is_admin', 'verification_level', 'created_at'], userRows);

    const ppRows = providers.map((p, i) => [
      p.id, p.headline,
      `${p.headline} basé(e) à ${CENTER[p.cityKey].name}. ${p.years} an(s) d'expérience. Travail soigné, ponctualité et prix justes.`,
      p.type, p.years,
      i < 2 || chance(0.7), // ~70 % en ligne (les 2 comptes démo toujours en ligne)
      p.pos.lat, p.pos.lng, at(NOW - randInt(1, 50) * MIN),
      p.phone, chance(0.6) ? 'mtn' : 'orange',
      p.opts.pro ? 'pro' : 'free', p.opts.pro ? at(NOW + randInt(5, 25) * DAY) : null,
      p.opts.featured ? at(NOW + randInt(1, 20) * DAY) : null,
      chance(0.3) ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6],
      at(p.created),
    ]);
    await insertMany(client, 'provider_profiles', ['user_id', 'headline', 'bio', 'provider_type', 'years_experience', 'is_online', 'lat', 'lng',
      'location_updated_at', 'momo_number', 'momo_operator', 'plan', 'pro_until', 'featured_until', 'available_days', 'created_at'], ppRows);
    await insertMany(client, 'provider_skills', ['provider_id', 'category_id', 'base_price'],
      providers.flatMap((p) => p.skills.map((s) => [p.id, s.id, s.price])));

    // ---- historique de missions (60 jours, croissance visible)
    const jobs = [];
    const txs = [];
    const reviews = [];
    const disputes = [];
    const descFor = (skill) => pick(JOB_DESCRIPTIONS[skill.name] || [`Besoin d'un service de ${skill.name.toLowerCase()}`, `${skill.name} à domicile`]);
    const totalWeight = (list) => list.reduce((s, p) => s + p.weight, 0);
    const weightedPick = (list) => {
      let r = rand() * totalWeight(list);
      for (const p of list) if ((r -= p.weight) <= 0) return p;
      return list[list.length - 1];
    };
    const roundPrice = (v) => Math.max(500, Math.round(v / 500) * 500);
    const methodFor = () => (chance(0.62) ? 'mtn_momo' : 'orange_money');

    function makeJob({ provider, clientUser, created, status, skill }) {
      const sk = skill || pick(provider.skills);
      const nb = pick(NEIGHBORHOODS[provider.cityKey]);
      const loc = scatter(provider.pos, 0.3, 4.5);
      const price = roundPrice(sk.price * pick([1, 1, 1, 1.2, 1.5, 2]));
      const q = computeQuote(price, settings);
      const desc = descFor(sk);
      const j = {
        id: uuid(), client_id: clientUser.id, provider_id: provider.id, category_id: sk.id,
        title: `${sk.name} - ${desc.length > 50 ? `${desc.slice(0, 49)}…` : desc}`, description: desc,
        address: `${nb}, ${CENTER[provider.cityKey].name}`, city: CENTER[provider.cityKey].name, lat: loc.lat, lng: loc.lng,
        urgency: pick(['now', 'now', 'today', 'scheduled']), scheduled_at: null, budget: price, ...q,
        status, payment_status: 'unpaid', cancel_reason: null, cancelled_by: null,
        created_at: created, accepted_at: null, funded_at: null, started_at: null, done_at: null, completed_at: null, cancelled_at: null,
        method: methodFor(), clientPhone: clientUser.phone, provider, txs: [],
      };
      if (j.urgency === 'scheduled') j.scheduled_at = created + randInt(3, 30) * HOUR;
      return j;
    }

    function advance(j, target) {
      // Fait progresser une mission jusqu'au statut `target` avec des horodatages cohérents
      const order = ['requested', 'accepted', 'funded', 'en_route', 'arrived', 'in_progress', 'done', 'completed'];
      const idx = order.indexOf(target);
      let t = j.created_at;
      if (idx >= 1) j.accepted_at = t += randInt(2, 25) * MIN;
      if (idx >= 2) {
        j.funded_at = t += randInt(1, 10) * MIN;
        j.payment_status = 'held';
        j.txs.push([uuid(), j.id, j.client_id, 'escrow_in', j.total, j.method, j.clientPhone, 'mock', `MOCK-SEED-${txs.length + 1}`, 'success', at(t)]);
      }
      if (idx >= 3) t += randInt(1, 10) * MIN;
      if (idx >= 4) t += randInt(8, 35) * MIN;
      if (idx >= 5) j.started_at = t += randInt(2, 10) * MIN;
      if (idx >= 6) j.done_at = t += randInt(30, 180) * MIN;
      if (idx >= 7) {
        j.completed_at = t += randInt(5, 90) * MIN;
        j.payment_status = 'released';
        const op = j.provider.opsMethod || 'mtn_momo';
        j.txs.push([uuid(), j.id, j.provider_id, 'payout', j.provider_payout, op, j.provider.phone, 'mock', `MOCK-PO-SEED-${txs.length + 1}`, 'success', at(t)]);
        const rev = j.service_fee + j.provider_commission;
        if (rev > 0) j.txs.push([uuid(), j.id, j.provider_id, 'commission', rev, null, null, 'mock', null, 'success', at(t)]);
      }
      j.status = target;
      return t;
    }

    function addReview(j, provider) {
      const r = Math.max(1, Math.min(5, Math.round(provider.quality + (rand() - 0.5) * 1.6)));
      const crit = () => Math.max(1, Math.min(5, r + pick([-1, 0, 0, 0, 1])));
      reviews.push([uuid(), j.id, j.client_id, j.provider_id, r, pick(REVIEW_COMMENTS[r]),
        chance(0.6) ? crit() : null, chance(0.6) ? crit() : null, chance(0.6) ? crit() : null, chance(0.6) ? crit() : null,
        at(j.completed_at + randInt(5, 240) * MIN)]);
    }

    for (const p of providers) p.opsMethod = chance(0.6) ? 'mtn_momo' : 'orange_money';
    const clientsBy = { Y: clients.filter((c) => c.cityKey === 'Y'), D: clients.filter((c) => c.cityKey === 'D') };

    for (let daysAgo = 59; daysAgo >= 1; daysAgo--) {
      const dayStart = NOW - daysAgo * DAY;
      const count = Math.round(4 + (59 - daysAgo) * 0.24 + rand() * 3 + (new Date(dayStart).getDay() === 6 ? 2 : 0));
      for (let k = 0; k < count; k++) {
        const created = dayStart - (dayStart % DAY) + randInt(6, 19) * HOUR + randInt(0, 59) * MIN - HOUR; // heure locale ~7h–20h
        if (created > NOW - 8 * HOUR) continue;
        const eligible = providers.filter((p) => p.created < created);
        if (!eligible.length) continue;
        const provider = weightedPick(eligible);
        const pool2 = clientsBy[provider.cityKey].filter((c) => c.created < created);
        const clientUser = pool2.length ? pick(pool2) : pick(clients.filter((c) => c.created < created) || clients);
        if (!clientUser) continue;
        const j = makeJob({ provider, clientUser, created, status: 'requested' });
        const roll = rand();
        if (roll < 0.05) {
          // annulée avant acceptation
          j.status = 'cancelled'; j.cancelled_at = created + randInt(5, 60) * MIN; j.cancelled_by = j.client_id;
          j.cancel_reason = pick(['Plus besoin du service', 'Trouvé quelqu\'un entre-temps', 'Erreur dans la demande']);
          j.provider_id = chance(0.5) ? j.provider_id : null;
        } else if (roll < 0.09) {
          advance(j, 'accepted');
          j.status = 'cancelled'; j.cancelled_at = j.accepted_at + randInt(5, 120) * MIN;
          j.cancelled_by = chance(0.7) ? j.client_id : j.provider_id;
          j.cancel_reason = j.cancelled_by === j.client_id ? 'Prix trop élevé' : 'Prestataire indisponible finalement';
        } else if (roll < 0.105) {
          // annulée après paiement → remboursement
          const t = advance(j, 'funded');
          j.status = 'cancelled'; j.cancelled_at = t + randInt(10, 60) * MIN; j.cancelled_by = j.client_id;
          j.cancel_reason = 'Urgence personnelle, mission reportée'; j.payment_status = 'refunded';
          j.txs.push([uuid(), j.id, j.client_id, 'refund', j.total, j.method, j.clientPhone, 'mock', `MOCK-RF-SEED-${txs.length + 1}`, 'success', at(j.cancelled_at)]);
        } else {
          advance(j, 'completed');
          if (chance(0.78)) addReview(j, provider);
        }
        jobs.push(j);
      }
    }

    // ---- aujourd'hui : missions terminées + missions en cours pour la démo temps réel
    const todayStart = NOW - 10 * HOUR;
    const todayCount = 14;
    for (let k = 0; k < todayCount; k++) {
      const created = todayStart + randInt(0, 180) * MIN;
      const provider = weightedPick(providers);
      const clientUser = pick(clientsBy[provider.cityKey]);
      const j = makeJob({ provider, clientUser, created, status: 'requested' });
      const end = advance(j, 'completed');
      if (end > NOW - 5 * MIN) continue; // ne garde que les missions déjà terminées
      if (chance(0.7)) addReview(j, provider);
      jobs.push(j);
    }

    const byName = (n) => providers.find((p) => p.name === n);
    const marie = clients[0];
    const recent = (minAgo) => NOW - minAgo * MIN;
    const demoActive = [
      { provider: byName('Bika Services'), clientUser: marie, status: 'en_route', skill: 'Plomberie', desc: "Fuite d'eau dans la salle de bain", ago: 45 },
      { provider: byName('Aïcha Bello'), clientUser: clients[1], status: 'in_progress', skill: 'Tresses', ago: 150 },
      { provider: byName('Serge Atangana'), clientUser: clients[2], status: 'funded', skill: 'Électricité', ago: 30 },
      { provider: byName('Sandrine Abena'), clientUser: clients[3], status: 'done', skill: 'Ménage', ago: 240 },
      { provider: byName('Brice Owona'), clientUser: clients[4], status: 'arrived', skill: 'Répétiteur', ago: 70 },
      { provider: byName('Christian Onana'), clientUser: marie, status: 'accepted', skill: 'Réparation téléphone', ago: 12 },
      { provider: byName('Kalvin Ekwalla'), clientUser: clients[7], status: 'en_route', skill: 'Plomberie', ago: 35 },
      { provider: byName('Moussa Kamga'), clientUser: clients[5], status: 'requested', skill: 'Dépannage PC', ago: 8, direct: true },
    ];
    let marieLeakJob = null;
    for (const d of demoActive) {
      const skill = d.provider.skills.find((s) => s.name === d.skill);
      const j = makeJob({ provider: d.provider, clientUser: d.clientUser, created: recent(d.ago), status: 'requested', skill });
      if (d.desc) { j.description = d.desc; j.title = `${skill.name} - ${d.desc}`; j.urgency = 'now'; j.address = 'Bastos, Yaoundé'; }
      advance(j, d.status);
      jobs.push(j);
      if (d.desc) marieLeakJob = j;
    }
    // Demandes ouvertes (diffusées, sans prestataire) près du centre de Yaoundé
    for (const [skillName, ago, cl] of [['Ménage', 6, clients[6]], ['Petites courses', 15, clients[2]], ['Tresses', 25, marie]]) {
      const skill = catByName.get(skillName);
      const fake = { ...byName('Rostand Mbida'), pos: CENTER.Y };
      const j = makeJob({ provider: fake, clientUser: cl, created: recent(ago), status: 'requested', skill: { ...skill, price: 3000 } });
      j.provider_id = null;
      jobs.push(j);
    }

    // ---- litiges ouverts (fonds en séquestre)
    const disputeSpecs = [
      [byName('Jean-Pierre Essomba'), clients[1], 'Maçonnerie', 'Le mur présente déjà des fissures deux jours après les travaux.', 2],
      [byName('Ulrich Fotso'), clients[8], 'Montage vidéo', 'La vidéo livrée ne correspond pas à ce qui avait été convenu.', 3],
      [byName('Rita Dikongue'), clients[9], 'Ménage', 'La prestataire est partie au bout d\'une heure sans terminer.', 1],
    ];
    for (const [provider, clientUser, skillName, reason, daysAgo] of disputeSpecs) {
      const skill = provider.skills.find((s) => s.name === skillName);
      const j = makeJob({ provider, clientUser, created: NOW - daysAgo * DAY - 5 * HOUR, status: 'requested', skill });
      const t = advance(j, 'done');
      j.status = 'disputed';
      disputes.push([uuid(), j.id, clientUser.id, reason, 'open', null, null, null, null, at(t + randInt(30, 180) * MIN)]);
      jobs.push(j);
    }
    // un litige résolu (remboursement)
    {
      const provider = byName('Fabrice Nkodo');
      const clientUser = clients[3];
      const j = makeJob({ provider, clientUser, created: NOW - 12 * DAY, status: 'requested', skill: provider.skills[0] });
      const t = advance(j, 'arrived');
      j.status = 'cancelled'; j.cancelled_at = t + 3 * HOUR; j.cancelled_by = admin.id; j.payment_status = 'refunded';
      j.cancel_reason = 'Litige résolu : remboursement — prestation non réalisée';
      j.txs.push([uuid(), j.id, j.client_id, 'refund', j.total, j.method, j.clientPhone, 'mock', `MOCK-RF-SEED-${txs.length + 1}`, 'success', at(j.cancelled_at)]);
      disputes.push([uuid(), j.id, clientUser.id, 'Le prestataire n\'avait pas le matériel nécessaire.', 'resolved', 'refund', 'Prestation non réalisée, client remboursé.', admin.id, at(j.cancelled_at), at(t + HOUR)]);
      jobs.push(j);
    }

    // abonnements Pro / boosts (revenus annexes)
    for (const p of providers.filter((x) => x.opts.pro || x.opts.featured)) {
      if (p.opts.pro) txs.push([uuid(), null, p.id, 'subscription', settings.pro_plan_price, p.opsMethod, p.phone, 'mock', `MOCK-SUB-${txs.length + 1}`, 'success', at(NOW - randInt(3, 25) * DAY)]);
      if (p.opts.featured) txs.push([uuid(), null, p.id, 'boost', settings.boost_month_price, p.opsMethod, p.phone, 'mock', `MOCK-BST-${txs.length + 1}`, 'success', at(NOW - randInt(1, 10) * DAY)]);
    }

    await insertMany(client, 'jobs', ['id', 'client_id', 'provider_id', 'category_id', 'title', 'description', 'address', 'city', 'lat', 'lng',
      'urgency', 'scheduled_at', 'budget', 'price', 'service_fee', 'total', 'provider_commission', 'provider_payout', 'status', 'payment_status',
      'cancel_reason', 'cancelled_by', 'created_at', 'accepted_at', 'funded_at', 'started_at', 'done_at', 'completed_at', 'cancelled_at', 'updated_at'],
    jobs.map((j) => [j.id, j.client_id, j.provider_id, j.category_id, j.title, j.description, j.address, j.city, j.lat, j.lng,
      j.urgency, j.scheduled_at ? at(j.scheduled_at) : null, j.budget, j.price, j.service_fee, j.total, j.provider_commission, j.provider_payout,
      j.status, j.payment_status, j.cancel_reason, j.cancelled_by, at(j.created_at), j.accepted_at ? at(j.accepted_at) : null,
      j.funded_at ? at(j.funded_at) : null, j.started_at ? at(j.started_at) : null, j.done_at ? at(j.done_at) : null,
      j.completed_at ? at(j.completed_at) : null, j.cancelled_at ? at(j.cancelled_at) : null,
      at(Math.max(j.created_at, j.completed_at || 0, j.cancelled_at || 0, j.funded_at || 0))]));
    const allTxs = [...jobs.flatMap((j) => j.txs), ...txs].map((t, i) => (t[8] && t[8].includes('SEED') ? [...t.slice(0, 8), `${t[8]}-${i + 1}`, ...t.slice(9)] : t));
    await insertMany(client, 'transactions', ['id', 'job_id', 'user_id', 'type', 'amount', 'method', 'phone', 'provider', 'external_ref', 'status', 'created_at'], allTxs);
    await insertMany(client, 'reviews', ['id', 'job_id', 'author_id', 'target_id', 'rating', 'comment', 'punctuality', 'quality', 'behavior', 'value', 'created_at'], reviews);
    await insertMany(client, 'disputes', ['id', 'job_id', 'opened_by', 'reason', 'status', 'resolution', 'note', 'resolved_by', 'resolved_at', 'created_at'], disputes);

    // ---- statistiques prestataires (note, missions, taux de complétion)
    await client.query(`
      UPDATE provider_profiles pp SET
        rating_avg = coalesce(r.avg, 0), rating_count = coalesce(r.n, 0)
      FROM (SELECT u.id, round(avg(rv.rating)::numeric, 2) AS avg, count(rv.id) AS n
              FROM users u LEFT JOIN reviews rv ON rv.target_id = u.id WHERE u.is_provider GROUP BY u.id) r
      WHERE r.id = pp.user_id`);
    await client.query(`
      UPDATE provider_profiles pp SET
        missions_completed = s.done,
        completion_rate = CASE WHEN s.done + s.failed = 0 THEN 100 ELSE round(100.0 * s.done / (s.done + s.failed)) END
      FROM (SELECT u.id,
                   count(j.id) FILTER (WHERE j.status = 'completed') AS done,
                   count(j.id) FILTER (WHERE j.status = 'cancelled' AND j.accepted_at IS NOT NULL AND j.cancelled_by = u.id) AS failed
              FROM users u LEFT JOIN jobs j ON j.provider_id = u.id WHERE u.is_provider GROUP BY u.id) s
      WHERE s.id = pp.user_id`);

    // ---- messagerie
    const convRows = [];
    const msgRows = [];
    const conv = (u1, u2, jobId, messages) => {
      const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
      const id = uuid();
      const last = messages[messages.length - 1];
      convRows.push([id, a, b, jobId, at(messages[0][2]), at(last[2])]);
      for (const [sender, body, time, read] of messages) msgRows.push([uuid(), id, sender, 'text', body, at(time), read ? at(time + 2 * MIN) : null]);
    };
    const bika = byName('Bika Services');
    conv(marie.id, bika.id, marieLeakJob?.id || null, [
      [marie.id, "Bonjour, je souhaite une intervention pour une fuite d'eau dans ma salle de bain.", recent(52), true],
      [bika.id, 'Bonjour Madame, pas de souci. La fuite vient du robinet ou d\'un tuyau ?', recent(50), true],
      [marie.id, 'Je pense que c\'est sous le lavabo, il y a de l\'eau partout.', recent(49), true],
      [bika.id, 'D\'accord, coupez l\'arrivée d\'eau en attendant. J\'arrive dans une vingtaine de minutes.', recent(44), true],
      [marie.id, 'Merci beaucoup, je vous attends à Bastos.', recent(43), true],
      [bika.id, 'Je suis en route, j\'ai le matériel nécessaire.', recent(5), false],
    ]);
    conv(marie.id, byName('Christian Onana').id, null, [
      [marie.id, 'Bonsoir, vous réparez les écrans de Samsung A52 ?', recent(20), true],
      [byName('Christian Onana').id, 'Bonsoir, oui. Comptez 3 000 FCFA de main-d\'œuvre, l\'écran est en plus.', recent(15), false],
    ]);
    conv(clients[1].id, byName('Aïcha Bello').id, null, [
      [clients[1].id, 'Bonjour, vous êtes disponible samedi matin pour des box braids ?', NOW - 2 * DAY, true],
      [byName('Aïcha Bello').id, 'Bonjour, oui à partir de 8h. Prévoyez 4 à 5 heures.', NOW - 2 * DAY + 30 * MIN, true],
      [clients[1].id, 'Parfait, je réserve via l\'application.', NOW - 2 * DAY + 45 * MIN, true],
    ]);
    conv(clients[5].id, byName('Moussa Kamga').id, null, [
      [clients[5].id, 'Salut Moussa, mon PC portable ne démarre plus du tout.', recent(9), true],
      [byName('Moussa Kamga').id, 'Bonjour ! Je regarde votre demande, je peux passer dans l\'heure.', recent(4), false],
    ]);
    conv(clients[7].id, byName('Kalvin Ekwalla').id, null, [
      [clients[7].id, 'Bonjour, le chauffe-eau fuit depuis ce matin.', recent(40), true],
      [byName('Kalvin Ekwalla').id, 'Bonjour, j\'ai accepté la mission, je suis en route.', recent(30), true],
    ]);
    await insertMany(client, 'conversations', ['id', 'user_a', 'user_b', 'job_id', 'created_at', 'updated_at'], convRows);
    await insertMany(client, 'messages', ['id', 'conversation_id', 'sender_id', 'type', 'body', 'created_at', 'read_at'], msgRows);

    // ---- notifications de démo
    const notifRows = [];
    const notif = (userId, type, title, body, data, time, read = false) =>
      notifRows.push([uuid(), userId, type, title, body, JSON.stringify(data), read ? at(time + 5 * MIN) : null, at(time)]);
    if (marieLeakJob) {
      notif(marie.id, 'job', 'Mission acceptée', `Bika Services a accepté « ${marieLeakJob.title} ».`, { job_id: marieLeakJob.id }, marieLeakJob.accepted_at, true);
      notif(marie.id, 'payment', 'Paiement sécurisé', `${marieLeakJob.total} FCFA sont en séquestre jusqu'à la fin de la mission.`, { job_id: marieLeakJob.id }, marieLeakJob.funded_at, true);
      notif(marie.id, 'job', 'Prestataire en route', 'Bika Services est en route vers vous.', { job_id: marieLeakJob.id }, recent(6));
      notif(marie.id, 'message', 'Bika Services', 'Je suis en route, j\'ai le matériel nécessaire.', {}, recent(5));
      notif(bika.id, 'job', 'Nouvelle demande directe', `${marieLeakJob.title} — ${marieLeakJob.budget} FCFA`, { job_id: marieLeakJob.id }, marieLeakJob.created_at, true);
      notif(bika.id, 'payment', 'Paiement reçu en séquestre', 'Le client a payé. Vous pouvez vous mettre en route.', { job_id: marieLeakJob.id }, marieLeakJob.funded_at, true);
    }
    for (const j of jobs.filter((x) => x.status === 'completed' && x.provider_id === bika.id).slice(-5)) {
      notif(bika.id, 'payment', 'Paiement reçu', `${j.provider_payout} FCFA ont été versés sur votre Mobile Money.`, { job_id: j.id }, j.completed_at, true);
    }
    notif(marie.id, 'system', 'Bienvenue sur Tasko !', 'Trouvez en quelques minutes un prestataire de confiance près de chez vous.', {}, marie.created, true);
    const moussa = byName('Moussa Kamga');
    notif(moussa.id, 'job', 'Nouvelle demande directe', 'Dépannage PC — un client vous sollicite.', {}, recent(8));
    for (const d of disputes.filter((x) => x[4] === 'open')) notif(admin.id, 'system', 'Nouveau litige', d[3], { job_id: d[1] }, d[9].getTime());
    for (const p of providers.filter((x) => x.created > NOW - 14 * DAY)) {
      notif(admin.id, 'system', 'Nouveau prestataire inscrit', `${p.name} — ${p.headline}`, { user_id: p.id }, p.created, true);
    }
    await insertMany(client, 'notifications', ['id', 'user_id', 'type', 'title', 'body', 'data', 'read_at', 'created_at'], notifRows);

    // ---- favoris, suggestions « Autre service », promotions
    await insertMany(client, 'favorites', ['user_id', 'provider_id'], [
      [marie.id, bika.id], [marie.id, byName('Aïcha Bello').id], [marie.id, byName('Moussa Kamga').id], [clients[1].id, byName('Grâce Ngono').id],
    ]);
    await insertMany(client, 'category_suggestions', ['label', 'user_id', 'created_at'],
      SUGGESTIONS.map((label) => [label, pick(clients).id, at(NOW - randInt(0, 40) * DAY - randInt(0, 23) * HOUR)]));
    await insertMany(client, 'promotions', ['code', 'description', 'discount_percent', 'max_uses', 'used_count', 'expires_at', 'is_active'], [
      ['BIENVENUE10', '10 % sur la première mission', 10, 1000, 137, at(NOW + 60 * DAY), true],
      ['RENTREE15', 'Rentrée scolaire : 15 % sur les répétiteurs', 15, 300, 42, at(NOW + 20 * DAY), true],
      ['NOEL2025', 'Offre de fin d\'année', 20, 500, 500, at(NOW - 250 * DAY), false],
    ]);

    // ---- V2 : garantie de paiement, médiation, appels d'offres, jalons, immobilier, trésorerie
    await seedV2(client, {
      NOW, MIN, HOUR, DAY, at, providers, clients, admin, catByName, disputes, settings, accounts, pwFor, hashFor, byName,
    });

    await client.query('COMMIT');

    // ---- README des comptes de démo (seul endroit où figurent les mots de passe)
    writeReadme(accounts.map(([role, name, phone]) => [role, name, phone, passwords.get(phone)]));

    const counts = await pool.query(`SELECT
      (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM jobs) AS jobs,
      (SELECT count(*) FROM jobs WHERE status = 'completed') AS completed, (SELECT count(*) FROM transactions) AS transactions,
      (SELECT count(*) FROM reviews) AS reviews, (SELECT count(*) FROM categories) AS categories`);
    console.log('Seed terminé en', ((Date.now() - t0) / 1000).toFixed(1), 's :', counts.rows[0]);
    console.log('Comptes de démonstration : backend/seeds/README.md');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function writeReadme(rows) {
  const lines = [
    '# Comptes de démonstration Tasko',
    '',
    'Générés par `npm run seed` (backend). **Données de démo uniquement — ne jamais réutiliser ces mots de passe ailleurs.**',
    'Les mots de passe sont conservés d\'un seed à l\'autre (relus depuis ce fichier) ; supprimez ce fichier pour en générer de nouveaux.',
    '',
    'Connexion : `POST /api/v1/auth/login` avec `{ "phone": "...", "password": "..." }` (le numéro peut aussi être saisi sans +237).',
    'OTP en mode dev : code `123456`.',
    '',
    '| Rôle | Nom | Téléphone | Mot de passe |',
    '|---|---|---|---|',
    ...rows.map(([role, name, phone, pw]) => `| ${role} | ${name} | \`${phone}\` | \`${pw}\` |`),
    '',
    'Comptes utiles pour la démo :',
    '- **Client principal** : Marie Ngo Bassa — mission « Plomberie - Fuite d\'eau dans la salle de bain » en cours (prestataire en route) et conversation avec Bika Services.',
    '- **Prestataires** : Bika Services (plombier, Pro), Moussa Kamga (étudiant / informaticien, a une demande directe en attente).',
    '- **Paiement mock** : un numéro se terminant par `000` simule un paiement (ou un versement) échoué.',
    '',
    'Démo V2 (garantie de paiement, médiation, appels d\'offres, trésorerie) :',
    '- **Entreprise** : Résidence Les Palmiers SARL (compte business, immobilier) — 2 biens (Immeuble Les Palmiers, Villa du Golf), ménage hebdomadaire récurrent avec EcoClean Services, appel d\'offres ouvert « Réfection de la toiture de l\'immeuble » (3 offres dont une en 3 jalons), chantier « Réhabilitation des cages d\'escalier » en cours (jalon 1 libéré, jalon 2 séquestré).',
    '- **Codes Tasko** : Bika Services `TSK-7F3K9`, Moussa Kamga `TSK-MK24P`, Jean-Pierre Essomba `TSK-JPE8S`, EcoClean Services `TSK-ECL3N` (recherche `GET /providers/lookup?code=`).',
    '- **Libération automatique** : mission « Ménage » de Sandrine Abena terminée (`done`), libérée automatiquement 48 h après la fin sauf contestation.',
    '- **Médiation** : litige « Maçonnerie » (Jean-Pierre Essomba / Thierry Mbarga) avec salon à trois (client, prestataire, Médiateur Tasko) et une proposition de règlement en attente.',
    '- **Trésorerie admin** : compte Ecobank et compte MTN MoMo (numéros fictifs, chiffrés en base), 2 retraits de revenus passés. Le mot de passe admin est re-demandé pour tout retrait.',
    '',
  ];
  fs.writeFileSync(README, lines.join('\n'), 'utf8');
}

main()
  .catch((err) => {
    console.error('Échec du seed :', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
