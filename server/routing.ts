// Маршрутизаторы на данных OpenStreetMap. По умолчанию — Valhalla на публичном сервере FOSSGIS
// (тот же движок, что в разделе «Маршруты» на openstreetmap.org), без ключа.
// OpenRouteService оставлен как запасной вариант (ROUTER=ors + ORS_API_KEY).
import type { LatLon, RouteResponse } from '../shared/types';
import { ROUTE_PROFILE } from '../shared/config';

export type RouterConfig =
  | { engine: 'valhalla'; baseUrl: string }
  | { engine: 'ors'; baseUrl: string; apiKey?: string };

export type RouteOutcome =
  | { ok: true; route: RouteResponse }
  | { ok: false; code: 'ROUTE_NOT_FOUND' | 'ROUTE_UNAVAILABLE'; detail: string };

const USER_AGENT = 'svobodny-put-mvp/0.1';

/** Декодер encoded polyline (Valhalla использует точность 6). Возвращает пары [lon, lat]. */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < str.length) {
    lat += next();
    lon += next();
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

async function valhalla(
  cfg: { baseUrl: string },
  a: LatLon,
  b: LatLon,
  signal: AbortSignal,
  doFetch: typeof fetch,
): Promise<RouteOutcome> {
  const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/route`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      locations: [
        { lat: a.lat, lon: a.lon },
        { lat: b.lat, lon: b.lon },
      ],
      costing: 'pedestrian',
      costing_options: {
        // Тип wheelchair: ниже скорость, ограничение уклона, ступени избегаются
        pedestrian: { type: 'wheelchair', step_penalty: 3600 },
      },
      units: 'kilometers',
      language: 'ru-RU',
    }),
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    // 4xx с error_code: точка не у дороги (171), путь не найден (442) и т. п.
    if (res.status === 400 && data?.error_code) {
      return { ok: false, code: 'ROUTE_NOT_FOUND', detail: `${data.error_code} ${data.error ?? ''}` };
    }
    return { ok: false, code: 'ROUTE_UNAVAILABLE', detail: `HTTP ${res.status} ${JSON.stringify(data)?.slice(0, 200)}` };
  }
  const trip = data?.trip;
  const coords: [number, number][] = [];
  for (const leg of trip?.legs ?? []) {
    const pts = decodePolyline(String(leg.shape ?? ''));
    coords.push(...(coords.length ? pts.slice(1) : pts));
  }
  if (coords.length < 2) return { ok: false, code: 'ROUTE_NOT_FOUND', detail: 'пустая геометрия' };
  return {
    ok: true,
    route: {
      geometry: { type: 'LineString', coordinates: coords },
      distance: Number(trip.summary?.length ?? 0) * 1000,
      duration: Number(trip.summary?.time ?? 0),
    },
  };
}

async function ors(
  cfg: { baseUrl: string; apiKey?: string },
  a: LatLon,
  b: LatLon,
  signal: AbortSignal,
  doFetch: typeof fetch,
): Promise<RouteOutcome> {
  if (!cfg.apiKey) return { ok: false, code: 'ROUTE_UNAVAILABLE', detail: 'нет ORS_API_KEY' };
  const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/v2/directions/${ROUTE_PROFILE}/geojson`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: cfg.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/geo+json, application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      coordinates: [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ],
      options: { avoid_features: ['steps'] },
      instructions: false,
    }),
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const code = Number(data?.error?.code);
    if (res.status === 404 || code === 2009 || code === 2010) {
      return { ok: false, code: 'ROUTE_NOT_FOUND', detail: String(code) };
    }
    return { ok: false, code: 'ROUTE_UNAVAILABLE', detail: `HTTP ${res.status} ${JSON.stringify(data?.error ?? data)?.slice(0, 200)}` };
  }
  const feature = data?.features?.[0];
  if (feature?.geometry?.type !== 'LineString') return { ok: false, code: 'ROUTE_NOT_FOUND', detail: 'нет линии' };
  const summary = feature.properties?.summary ?? {};
  return {
    ok: true,
    route: {
      geometry: { type: 'LineString', coordinates: feature.geometry.coordinates },
      distance: Number(summary.distance ?? 0),
      duration: Number(summary.duration ?? 0),
    },
  };
}

export function requestRoute(
  cfg: RouterConfig,
  a: LatLon,
  b: LatLon,
  signal: AbortSignal,
  doFetch: typeof fetch,
): Promise<RouteOutcome> {
  return cfg.engine === 'ors' ? ors(cfg, a, b, signal, doFetch) : valhalla(cfg, a, b, signal, doFetch);
}

export function routerLabel(cfg: RouterConfig): string {
  return cfg.engine === 'ors' ? `OpenRouteService (${cfg.baseUrl})` : `Valhalla / OpenStreetMap (${cfg.baseUrl})`;
}
