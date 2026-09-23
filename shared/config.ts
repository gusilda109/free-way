// Параметры MVP из раздела 3.2 ТЗ. Меняются здесь или через .env.

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Пилот по умолчанию: Академгородок, Новосибирск (приблизительно). */
export const DEFAULT_PILOT_BOUNDS: Bounds = {
  west: 83.05,
  south: 54.82,
  east: 83.14,
  north: 54.875,
};

export const MAP_POINT_LIMIT = 500;
export const REPORT_HIDE_THRESHOLD = 3;
export const PHOTO_INPUT_LIMIT = 5 * 1024 * 1024;
export const PHOTO_MAX_SIDE = 1600;
export const DESCRIPTION_LIMIT = 300;
export const ROUTE_PROFILE = 'wheelchair';
export const ROUTE_WARNING_DISTANCE_M = 30;
export const ROUTE_RATE_LIMIT_PER_HOUR = 20;
export const ROUTE_TIMEOUT_MS = 6000;
export const ROUTE_RETRY_DELAY_MS = 30_000;
export const REPORT_RATE_LIMIT_PER_HOUR = 30;
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Формат строки: "west,south,east,north" (долгота, широта). */
export function parseBounds(raw: string | undefined | null): Bounds {
  if (!raw) return DEFAULT_PILOT_BOUNDS;
  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return DEFAULT_PILOT_BOUNDS;
  }
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west >= east || south >= north) return DEFAULT_PILOT_BOUNDS;
  return { west, south, east, north };
}

export function inBounds(b: Bounds, lat: number, lon: number): boolean {
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}
