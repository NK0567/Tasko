import { many, one } from '../db.js';
import { emitToRooms } from './hub.js';
import { etaMin, haversineKm, round1 } from '../utils/geo.js';
import { getSettings } from '../modules/settings/service.js';

const TRACKED_STATUSES = ['accepted', 'funded', 'en_route', 'arrived', 'in_progress'];

/**
 * Met à jour la position du prestataire et diffuse `provider:location` (eta/distance)
 * vers job:<id> et user:<client> pour chacun de ses jobs actifs.
 */
export async function updateProviderLocation(userId, lat, lng) {
  const updated = await one(
    `UPDATE provider_profiles SET lat = $2, lng = $3, location_updated_at = now() WHERE user_id = $1 RETURNING user_id`,
    [userId, lat, lng],
  );
  if (!updated) return { ok: true, jobs: 0 };
  const jobs = await many(
    `SELECT id, client_id, lat, lng FROM jobs WHERE provider_id = $1 AND status = ANY($2)`,
    [userId, TRACKED_STATUSES],
  );
  if (!jobs.length) return { ok: true, jobs: 0 };
  const { avg_speed_kmh } = await getSettings();
  for (const j of jobs) {
    const distance = haversineKm(lat, lng, j.lat, j.lng);
    emitToRooms([`job:${j.id}`, `user:${j.client_id}`], 'provider:location', {
      job_id: j.id,
      provider_id: userId,
      lat,
      lng,
      eta_min: etaMin(distance, avg_speed_kmh),
      distance_km: round1(distance),
    });
  }
  return { ok: true, jobs: jobs.length };
}
