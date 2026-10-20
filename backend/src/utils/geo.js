export const YAOUNDE = { lat: 3.848, lng: 11.5021 };
export const DOUALA = { lat: 4.0511, lng: 9.7679 };

export function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const round1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);
export const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

/** eta_min = ceil(distance_km / avg_speed_kmh × 60) + 2 */
export function etaMin(distanceKm, avgSpeedKmh) {
  if (distanceKm === null || distanceKm === undefined) return null;
  return Math.ceil((distanceKm / (avgSpeedKmh || 20)) * 60) + 2;
}
