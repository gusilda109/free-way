import { describe, expect, it } from 'vitest';
import { decodePolyline, requestRoute } from '../server/routing';

describe('decodePolyline', () => {
  it('декодирует пример Google (точность 5)', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });
});

describe('OpenRouteService как запасной маршрутизатор', () => {
  it('без ключа сразу недоступен, запрос не уходит', async () => {
    let called = false;
    const out = await requestRoute(
      { engine: 'ors', baseUrl: 'https://ors.test' },
      { lat: 54.84, lon: 83.09 },
      { lat: 54.85, lon: 83.1 },
      new AbortController().signal,
      (async () => {
        called = true;
        return new Response('{}');
      }) as typeof fetch,
    );
    expect(out).toMatchObject({ ok: false, code: 'ROUTE_UNAVAILABLE' });
    expect(called).toBe(false);
  });

  it('разбирает GeoJSON ответ ORS', async () => {
    const out = await requestRoute(
      { engine: 'ors', baseUrl: 'https://ors.test', apiKey: 'k' },
      { lat: 54.84, lon: 83.09 },
      { lat: 54.85, lon: 83.1 },
      new AbortController().signal,
      (async () =>
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: { type: 'LineString', coordinates: [[83.09, 54.84], [83.1, 54.85]] },
                properties: { summary: { distance: 1300, duration: 1000 } },
              },
            ],
          }),
        )) as typeof fetch,
    );
    expect(out).toMatchObject({ ok: true, route: { distance: 1300 } });
  });
});
