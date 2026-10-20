import { many, one, withTransaction } from '../../db.js';
import { conflict, notFound, badRequest } from '../../utils/errors.js';
import { slugify } from '../../utils/slug.js';
import { z } from '../../utils/validate.js';

export const ICON_KEYS = [
  'construction', 'home_repair_service', 'spa', 'computer', 'school', 'local_shipping', 'shopping_basket',
  'directions_car', 'checkroom', 'celebration', 'yard', 'build', 'handyman', 'plumbing', 'electrical_services',
  'cleaning_services', 'local_laundry_service', 'content_cut', 'face', 'brush', 'photo_camera', 'restaurant',
  'phone_android', 'ac_unit', 'chair', 'child_care', 'translate', 'description', 'print', 'design_services',
  'videocam', 'music_note', 'pets', 'agriculture', 'fitness_center', 'security', 'key', 'format_paint', 'moving',
  'volunteer_activism', 'more_horiz',
];

export const categoryInput = z.object({
  name: z.string({ error: 'Nom requis' }).trim().min(2, 'Nom trop court').max(80),
  description: z.string().trim().max(500).nullable().optional(),
  icon: z.enum(ICON_KEYS, { error: 'Icône non autorisée' }),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)').optional(),
  parent_id: z.uuid({ error: 'Identifiant invalide' }).nullable().optional(),
  position: z.coerce.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

const BASE_SELECT = `
  SELECT c.*,
    (SELECT count(DISTINCT ps.provider_id)::int
       FROM provider_skills ps
       JOIN users u ON u.id = ps.provider_id AND u.status = 'active' AND u.is_provider
      WHERE ps.category_id = c.id OR ps.category_id IN (SELECT id FROM categories WHERE parent_id = c.id)
    ) AS providers_count
  FROM categories c`;

export function serializeCategory(c, children) {
  const out = {
    id: c.id,
    parent_id: c.parent_id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    icon: c.icon,
    color: c.color,
    position: c.position,
    is_active: c.is_active,
    providers_count: c.providers_count ?? 0,
  };
  if (children !== undefined) out.children = children;
  return out;
}

function buildTree(rows) {
  const parents = rows.filter((r) => !r.parent_id);
  return parents.map((p) =>
    serializeCategory(
      p,
      rows.filter((r) => r.parent_id === p.id).map((c) => serializeCategory(c, [])),
    ),
  );
}

/** Arbre catégorie → sous-services, trié par position. includeInactive pour l'admin. */
export async function listCategoryTree({ includeInactive = false } = {}) {
  const rows = await many(
    `${BASE_SELECT}
     WHERE ($1::boolean OR (c.is_active AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM categories p WHERE p.id = c.parent_id AND p.is_active))))
     ORDER BY c.position, c.name`,
    [includeInactive],
  );
  return buildTree(rows);
}

export async function getCategory(id, { includeInactive = true } = {}) {
  const c = await one(`${BASE_SELECT} WHERE c.id = $1`, [id]);
  if (!c || (!includeInactive && !c.is_active)) throw notFound('Catégorie introuvable');
  const children = await many(
    `${BASE_SELECT} WHERE c.parent_id = $1 AND ($2::boolean OR c.is_active) ORDER BY c.position, c.name`,
    [id, includeInactive],
  );
  return serializeCategory(c, children.map((ch) => serializeCategory(ch, [])));
}

/** Identifiants couverts par une catégorie : elle-même + ses sous-services. */
export async function expandCategoryIds(categoryId) {
  const rows = await many('SELECT id FROM categories WHERE id = $1 OR parent_id = $1', [categoryId]);
  return rows.map((r) => r.id);
}

async function uniqueSlug(name, client, excludeId = null) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const exists = await one('SELECT 1 FROM categories WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)', [slug, excludeId], client);
    if (!exists) return slug;
    slug = `${base}-${i}`;
  }
}

async function checkParent(parentId, selfId, client) {
  if (!parentId) return;
  if (parentId === selfId) throw badRequest('Une catégorie ne peut pas être son propre parent');
  const p = await one('SELECT id, parent_id FROM categories WHERE id = $1', [parentId], client);
  if (!p) throw badRequest('Catégorie parente introuvable', { parent_id: 'Introuvable' });
  if (p.parent_id) throw badRequest('Un seul niveau de profondeur : le parent doit être une catégorie racine', { parent_id: 'Invalide' });
  if (selfId) {
    const kids = await one('SELECT count(*)::int AS n FROM categories WHERE parent_id = $1', [selfId], client);
    if (kids.n > 0) throw badRequest('Cette catégorie a des sous-services : elle ne peut pas devenir un sous-service');
  }
}

export async function createCategory(input) {
  return withTransaction(async (client) => {
    await checkParent(input.parent_id, null, client);
    const slug = await uniqueSlug(input.name, client);
    let position = input.position;
    if (position === undefined) {
      const r = await one(
        `SELECT coalesce(max(position), -1) + 1 AS p FROM categories WHERE parent_id IS NOT DISTINCT FROM $1 AND slug <> 'autre'`,
        [input.parent_id || null],
        client,
      );
      position = r.p;
      // « Autre service » reste toujours en dernier
      if (!input.parent_id) await client.query(`UPDATE categories SET position = $1 + 1 WHERE slug = 'autre' AND position <= $1`, [position]);
    }
    const c = await one(
      `INSERT INTO categories (parent_id, name, slug, description, icon, color, position, is_active)
       VALUES ($1, $2, $3, $4, $5, coalesce($6, '#607D8B'), $7, coalesce($8, true)) RETURNING id`,
      [input.parent_id || null, input.name, slug, input.description ?? null, input.icon, input.color ?? null, position, input.is_active ?? null],
      client,
    );
    return c.id;
  }).then((id) => getCategory(id));
}

export async function updateCategory(id, patch) {
  await withTransaction(async (client) => {
    const cur = await one('SELECT * FROM categories WHERE id = $1 FOR UPDATE', [id], client);
    if (!cur) throw notFound('Catégorie introuvable');
    if (patch.parent_id !== undefined) await checkParent(patch.parent_id, id, client);
    const slug = patch.name && patch.name !== cur.name && cur.slug !== 'autre' ? await uniqueSlug(patch.name, client, id) : cur.slug;
    await client.query(
      `UPDATE categories SET
         name = $2, slug = $3, description = $4, icon = $5, color = $6, parent_id = $7, position = $8, is_active = $9, updated_at = now()
       WHERE id = $1`,
      [
        id,
        patch.name ?? cur.name,
        slug,
        patch.description !== undefined ? patch.description : cur.description,
        patch.icon ?? cur.icon,
        patch.color ?? cur.color,
        patch.parent_id !== undefined ? patch.parent_id : cur.parent_id,
        patch.position ?? cur.position,
        patch.is_active ?? cur.is_active,
      ],
    );
  });
  return getCategory(id);
}

export async function deleteCategory(id) {
  await withTransaction(async (client) => {
    const c = await one('SELECT id, slug FROM categories WHERE id = $1 FOR UPDATE', [id], client);
    if (!c) throw notFound('Catégorie introuvable');
    if (c.slug === 'autre') throw conflict('La catégorie « Autre service » ne peut pas être supprimée');
    const used = await one(
      `SELECT count(*)::int AS n FROM jobs WHERE category_id IN (SELECT id FROM categories WHERE id = $1 OR parent_id = $1)`,
      [id],
      client,
    );
    if (used.n > 0) {
      throw conflict(`Impossible de supprimer : ${used.n} mission(s) liée(s). Désactivez la catégorie à la place.`, { jobs: used.n });
    }
    await client.query('DELETE FROM categories WHERE id = $1', [id]);
  });
}

/** Réordonne : position = index dans la liste fournie. « Autre service » est forcée en dernier. */
export async function reorderCategories(ids) {
  await withTransaction(async (client) => {
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE categories SET position = $2, updated_at = now() WHERE id = $1', [ids[i], i]);
    }
    await client.query(
      `UPDATE categories SET position = (SELECT coalesce(max(position), 0) + 1 FROM categories WHERE parent_id IS NULL AND slug <> 'autre')
       WHERE slug = 'autre'`,
    );
  });
}

export async function listSuggestions() {
  return many(
    `SELECT min(label) AS label, count(*)::int AS count, max(created_at) AS last_at
       FROM category_suggestions
      GROUP BY lower(trim(label))
      ORDER BY count(*) DESC, max(created_at) DESC
      LIMIT 200`,
  );
}

export async function listCities({ includeInactive = true } = {}) {
  return many('SELECT id, name, lat, lng, is_active FROM cities WHERE ($1::boolean OR is_active) ORDER BY is_active DESC, name', [
    includeInactive,
  ]);
}

