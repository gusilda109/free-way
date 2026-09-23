import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { openDb } from '../server/db';
import { createApp } from '../server/app';
import { DEFAULT_PILOT_BOUNDS, ROUTE_RATE_LIMIT_PER_HOUR } from '../shared/config';

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(32)]);

let server: Server;
let base = '';
let dir = '';
let orsCalls = 0;
let orsMode: 'ok' | 'fail' | 'notfound' = 'ok';

let lastRequest: { url: string; body: any } | null = null;

// Имитация Valhalla: shape — encoded polyline6 двух точек
const fakeFetch: typeof fetch = async (url, init) => {
  orsCalls++;
  lastRequest = { url: String(url), body: JSON.parse(String(init?.body ?? '{}')) };
  if (orsMode === 'fail') return new Response('{"error":"Too Many Requests"}', { status: 429 });
  if (orsMode === 'notfound') return new Response('{"error_code":442,"error":"No path could be found for input"}', { status: 400 });
  return new Response(
    JSON.stringify({
      trip: {
        legs: [{ shape: encode6([[83.0936, 54.8436], [83.1069, 54.8381]]) }],
        summary: { length: 0.42, time: 360 },
      },
    }),
    { status: 200 },
  );
};

function encode6(coords: [number, number][]): string {
  let out = '';
  let pLat = 0;
  let pLon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of coords) {
    const la = Math.round(lat * 1e6);
    const lo = Math.round(lon * 1e6);
    enc(la - pLat);
    enc(lo - pLon);
    pLat = la;
    pLon = lo;
  }
  return out;
}

async function session() {
  const r = await fetch(`${base}/api/auth/anonymous`, { method: 'POST' });
  const s = (await r.json()) as { user_id: string; access_token: string };
  return { ...s, h: { Authorization: `Bearer ${s.access_token}` } };
}

async function createPoint(s: Awaited<ReturnType<typeof session>>, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  const path = `${s.user_id}/${id}.webp`;
  const up = await fetch(`${base}/api/storage/photos/${path}`, {
    method: 'PUT',
    headers: { ...s.h, 'Content-Type': 'image/webp' },
    body: WEBP,
  });
  expect(up.status).toBe(201);
  const res = await fetch(`${base}/api/obstacles`, {
    method: 'POST',
    headers: { ...s.h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      lat: 54.8436,
      lon: 83.0936,
      category: 'elevator',
      condition: 'broken',
      description: 'Лифт не реагирует на кнопку',
      photo_path: path,
      observed_at: '2026-09-19T08:30:00Z',
      ...extra,
    }),
  });
  return { res, id, path };
}

const report = (s: Awaited<ReturnType<typeof session>>, id: string, reason = 'outdated') =>
  fetch(`${base}/api/rpc/report_obstacle`, {
    method: 'POST',
    headers: { ...s.h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ obstacle_id: id, reason }),
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sp-'));
  const app = createApp({
    db: openDb(':memory:'),
    photosDir: join(dir, 'photos'),
    bounds: DEFAULT_PILOT_BOUNDS,
    router: { engine: 'valhalla', baseUrl: 'https://valhalla.test' },
    storageLimitBytes: 50 * 1024 * 1024,
    fetchImpl: fakeFetch,
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('анонимная сессия', () => {
  it('создается без регистрации и восстанавливается по токену', async () => {
    const s = await session();
    const r = await fetch(`${base}/api/auth/session`, { headers: s.h });
    expect(await r.json()).toEqual({ user_id: s.user_id });
  });
  it('без токена запись запрещена', async () => {
    const r = await fetch(`${base}/api/obstacles`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(401);
  });
});

describe('добавление точки', () => {
  it('создает точку и не отдает created_by', async () => {
    const s = await session();
    const { res, id } = await createPoint(s);
    expect(res.status).toBe(201);
    const list = (await (await fetch(`${base}/api/obstacles`)).json()) as { items: Record<string, unknown>[] };
    const item = list.items.find((i) => i.id === id)!;
    expect(item.status).toBe('active');
    expect(item).not.toHaveProperty('created_by');
    expect(item).not.toHaveProperty('photo_path');
    const photo = await fetch(`${base}/api/photos/${id}`);
    expect(photo.headers.get('content-type')).toContain('image/webp');
  });

  it('клиент не может задать статус напрямую', async () => {
    const s = await session();
    const { res } = await createPoint(s, { status: 'hidden' });
    expect(((await res.json()) as { status: string }).status).toBe('active');
  });

  it('нельзя загрузить фото в чужую папку', async () => {
    const a = await session();
    const b = await session();
    const r = await fetch(`${base}/api/storage/photos/${a.user_id}/${randomUUID()}.webp`, {
      method: 'PUT',
      headers: { ...b.h, 'Content-Type': 'image/webp' },
      body: WEBP,
    });
    expect(r.status).toBe(403);
  });

  it('нельзя создать точку с чужим фото', async () => {
    const a = await session();
    const b = await session();
    const id = randomUUID();
    await fetch(`${base}/api/storage/photos/${a.user_id}/${id}.webp`, {
      method: 'PUT',
      headers: { ...a.h, 'Content-Type': 'image/webp' },
      body: WEBP,
    });
    const r = await fetch(`${base}/api/obstacles`, {
      method: 'POST',
      headers: { ...b.h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 54.843, lon: 83.094, category: 'curb', condition: 'blocked', photo_path: `${a.user_id}/${id}.webp`, observed_at: '2026-09-19T08:30:00Z' }),
    });
    expect(r.status).toBe(403);
  });

  it('отклоняет файл, который не является изображением', async () => {
    const s = await session();
    const r = await fetch(`${base}/api/storage/photos/${s.user_id}/${randomUUID()}.webp`, {
      method: 'PUT',
      headers: { ...s.h, 'Content-Type': 'image/webp' },
      body: Buffer.from('%PDF-1.4 not an image'),
    });
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('PHOTO_INVALID');
  });

  it('отклоняет файл больше 5 МБ', async () => {
    const s = await session();
    const big = Buffer.concat([WEBP, Buffer.alloc(5 * 1024 * 1024)]);
    const r = await fetch(`${base}/api/storage/photos/${s.user_id}/${randomUUID()}.webp`, {
      method: 'PUT',
      headers: { ...s.h, 'Content-Type': 'image/webp' },
      body: big,
    });
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('PHOTO_TOO_LARGE');
  });

  it('без загруженного фото точка не сохраняется', async () => {
    const s = await session();
    const r = await fetch(`${base}/api/obstacles`, {
      method: 'POST',
      headers: { ...s.h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 54.843, lon: 83.094, category: 'curb', condition: 'blocked', photo_path: `${s.user_id}/${randomUUID()}.webp`, observed_at: '2026-09-19T08:30:00Z' }),
    });
    expect(r.status).toBe(400);
  });

  it('возвращает ошибки полей при неверной форме', async () => {
    const s = await session();
    const r = await fetch(`${base}/api/obstacles`, {
      method: 'POST',
      headers: { ...s.h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 10, lon: 10, category: 'curb', condition: 'broken' }),
    });
    const body = (await r.json()) as { error: { code: string; fields: Record<string, string> } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(body.error.fields)).toEqual(expect.arrayContaining(['coordinate', 'condition', 'observed_at']));
  });
});

describe('сигнал об изменении', () => {
  it('первый сигнал → disputed, повтор отклонен, третий → hidden', async () => {
    const owner = await session();
    const { id } = await createPoint(owner);
    const [a, b, c] = [await session(), await session(), await session()];

    let r = await report(a, id);
    expect(await r.json()).toEqual({ report_count: 1, status: 'disputed' });

    r = await report(a, id, 'incorrect');
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('ALREADY_REPORTED');

    r = await report(b, id);
    expect(await r.json()).toEqual({ report_count: 2, status: 'disputed' });

    r = await report(c, id);
    expect(await r.json()).toEqual({ report_count: 3, status: 'hidden' });

    const list = (await (await fetch(`${base}/api/obstacles`)).json()) as { items: { id: string }[] };
    expect(list.items.some((i) => i.id === id)).toBe(false);
    expect((await fetch(`${base}/api/obstacles/${id}`)).status).toBe(404);
    expect((await fetch(`${base}/api/photos/${id}`)).status).toBe(404);

    const late = await report(await session(), id);
    expect(((await late.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('неверная причина отклоняется', async () => {
    const s = await session();
    const { id } = await createPoint(s);
    expect((await report(s, id, 'spam')).status).toBe(400);
  });
});

describe('маршрут', () => {
  const body = (start: object, end: object) => JSON.stringify({ start, end });
  const A = { lat: 54.8436, lon: 83.0936 };
  const B = { lat: 54.8381, lon: 83.1069 };

  it('возвращает GeoJSON, расстояние и длительность', async () => {
    const s = await session();
    orsMode = 'ok';
    const r = await fetch(`${base}/api/functions/route-wheelchair`, {
      method: 'POST',
      headers: { ...s.h, 'Content-Type': 'application/json' },
      body: body(A, B),
    });
    const data = (await r.json()) as { geometry: { type: string }; distance: number; duration: number };
    expect(data.geometry.type).toBe('LineString');
    expect((data.geometry as unknown as { coordinates: number[][] }).coordinates[0]).toEqual([83.0936, 54.8436]);
    expect(data.distance).toBeCloseTo(420);
    expect(lastRequest?.url).toBe('https://valhalla.test/route');
    expect(lastRequest?.body.costing).toBe('pedestrian');
    expect(lastRequest?.body.costing_options.pedestrian.type).toBe('wheelchair');
  });

  it('точки вне района → ROUTE_INVALID без обращения к ORS', async () => {
    const s = await session();
    const before = orsCalls;
    const r = await fetch(`${base}/api/functions/route-wheelchair`, {
      method: 'POST',
      headers: { ...s.h, 'Content-Type': 'application/json' },
      body: body({ lat: 55.03, lon: 82.92 }, B),
    });
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('ROUTE_INVALID');
    expect(orsCalls).toBe(before);
  });

  it('квота маршрутизатора → ROUTE_UNAVAILABLE, маршрут не найден → ROUTE_NOT_FOUND', async () => {
    const s = await session();
    const post = () =>
      fetch(`${base}/api/functions/route-wheelchair`, {
        method: 'POST',
        headers: { ...s.h, 'Content-Type': 'application/json' },
        body: body(A, B),
      }).then((r) => r.json() as Promise<{ error: { code: string } }>);
    orsMode = 'fail';
    expect((await post()).error.code).toBe('ROUTE_UNAVAILABLE');
    orsMode = 'notfound';
    expect((await post()).error.code).toBe('ROUTE_NOT_FOUND');
    orsMode = 'ok';
  });

  it(`не больше ${ROUTE_RATE_LIMIT_PER_HOUR} маршрутов в час на сессию`, async () => {
    const s = await session();
    let last = 0;
    for (let i = 0; i <= ROUTE_RATE_LIMIT_PER_HOUR; i++) {
      const r = await fetch(`${base}/api/functions/route-wheelchair`, {
        method: 'POST',
        headers: { ...s.h, 'Content-Type': 'application/json' },
        body: body(A, B),
      });
      last = r.status;
    }
    expect(last).toBe(429);
  });
});
