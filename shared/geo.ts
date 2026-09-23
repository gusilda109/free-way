// Расстояние от точки до линии маршрута. Локальная равнопромежуточная проекция —
// на масштабе района погрешность пренебрежимо мала.

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

type LonLat = [number, number];

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function distanceToLineMeters(point: { lat: number; lon: number }, line: LonLat[]): number {
  if (line.length === 0) return Infinity;
  const k = Math.cos(point.lat * RAD) * EARTH_RADIUS_M * RAD;
  const m = EARTH_RADIUS_M * RAD;
  const project = ([lon, lat]: LonLat): [number, number] => [(lon - point.lon) * k, (lat - point.lat) * m];
  if (line.length === 1) {
    const [x, y] = project(line[0]!);
    return Math.hypot(x, y);
  }
  let best = Infinity;
  let prev = project(line[0]!);
  for (let i = 1; i < line.length; i++) {
    const cur = project(line[i]!);
    best = Math.min(best, segmentDistance(0, 0, prev[0], prev[1], cur[0], cur[1]));
    prev = cur;
  }
  return best;
}

export function pointsNearLine<T extends { lat: number; lon: number }>(
  points: readonly T[],
  line: LonLat[],
  maxMeters: number,
): Array<{ item: T; distance: number }> {
  const out: Array<{ item: T; distance: number }> = [];
  for (const item of points) {
    const distance = distanceToLineMeters(item, line);
    if (distance <= maxMeters) out.push({ item, distance });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
