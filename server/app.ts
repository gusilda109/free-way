import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  type Bounds,
  MAP_POINT_LIMIT,
  PHOTO_INPUT_LIMIT,
  REPORT_RATE_LIMIT_PER_HOUR,
  ROUTE_RATE_LIMIT_PER_HOUR,
  ROUTE_TIMEOUT_MS,
  inBounds,
} from '../shared/config';
import { isReportReason } from '../shared/catalog';
import { PHOTO_PATH_RE, isUuid, statusForReportCount, validateObstacleInput } from '../shared/validation';
import type { ApiErrorBody, ErrorCode, ObstacleDTO, } from '../shared/types';
import { type DB, createSession, findSession, transaction } from './db';
import { type RouterConfig, requestRoute } from './routing';

export interface AppOptions {
  db: DB;
  photosDir: string;
  bounds: Bounds;
  router: RouterConfig;
  /** Лимит хранилища фото в байтах. При превышении добавление блокируется. */
  storageLimitBytes: number;
  staticDir?: string;
  fetchImpl?: typeof fetch;
}

type AuthedRequest = Request & { userId?: string };

function fail(res: Response, status: number, code: ErrorCode, message: string, fields?: Record<string, string>) {
  const body: ApiErrorBody = { error: { code, message, ...(fields ? { fields } : {}) } };
  res.status(status).json(body);
}

const PUBLIC_COLUMNS = 'id, lat, lon, category, condition, description, observed_at, status, created_at';

function hourAgo(): string {
  return new Date(Date.now() - 3600_000).toISOString();
}

function detectImage(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
}

export function createApp(opts: AppOptions) {
  const { db, bounds } = opts;
  const photosDir = resolve(opts.photosDir);
  mkdirSync(photosDir, { recursive: true });
  const doFetch = opts.fetchImpl ?? fetch;

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '32kb' }));

  // --- Авторизация (аналог Supabase anonymous sign-in) ---------------------

  const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const userId = token ? findSession(db, token) : null;
    if (!userId) return fail(res, 401, 'UNAUTHORIZED', 'Сессия не найдена.');
    req.userId = userId;
    next();
  };

  api.post('/auth/anonymous', (_req, res) => {
    const { id, token } = createSession(db);
    res.status(201).json({ user_id: id, access_token: token });
  });

  api.get('/auth/session', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user_id: req.userId });
  });

  // --- Чтение точек ---------------------------------------------------------

  api.get('/obstacles', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT ${PUBLIC_COLUMNS} FROM obstacles
         WHERE status IN ('active', 'disputed')
           AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(bounds.south, bounds.north, bounds.west, bounds.east, MAP_POINT_LIMIT + 1) as unknown as ObstacleDTO[];
    const truncated = rows.length > MAP_POINT_LIMIT;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ items: rows.slice(0, MAP_POINT_LIMIT), truncated });
  });

  api.get('/obstacles/:id', (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 404, 'NOT_FOUND', 'Точка не найдена.');
    const row = db
      .prepare(`SELECT ${PUBLIC_COLUMNS} FROM obstacles WHERE id = ? AND status IN ('active', 'disputed')`)
      .get(req.params.id);
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Точка не найдена.');
    res.setHeader('Cache-Control', 'no-store');
    res.json(row);
  });

  // Фото отдается по ID точки, чтобы не раскрывать ID сессии автора.
  api.get('/photos/:id', (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 404, 'NOT_FOUND', 'Фото не найдено.');
    const row = db
      .prepare(`SELECT photo_path FROM obstacles WHERE id = ? AND status IN ('active', 'disputed')`)
      .get(req.params.id) as { photo_path: string } | undefined;
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Фото не найдено.');
    const file = join(photosDir, row.photo_path);
    if (!existsSync(file)) return fail(res, 404, 'NOT_FOUND', 'Фото не найдено.');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type(row.photo_path.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    res.sendFile(file);
  });

  // --- Хранилище фото (аналог Supabase Storage + policy) --------------------

  const photoPathFromParams = (req: AuthedRequest, res: Response): string | null => {
    const path = `${req.params.uid}/${req.params.file}`;
    if (!PHOTO_PATH_RE.test(path)) {
      fail(res, 400, 'PHOTO_INVALID', 'Неверный путь файла.');
      return null;
    }
    if (req.params.uid !== req.userId) {
      fail(res, 403, 'FORBIDDEN', 'Можно загружать только в свою папку.');
      return null;
    }
    return path;
  };

  const isReferenced = (path: string) =>
    Boolean(db.prepare('SELECT 1 FROM obstacles WHERE photo_path = ?').get(path));

  api.put(
    '/storage/photos/:uid/:file',
    requireAuth,
    express.raw({ type: () => true, limit: PHOTO_INPUT_LIMIT }),
    (req: AuthedRequest, res) => {
      const path = photoPathFromParams(req, res);
      if (!path) return;
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return fail(res, 400, 'PHOTO_INVALID', 'Файл пустой.');
      const detected = detectImage(body);
      const expected = path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      if (detected !== expected) return fail(res, 400, 'PHOTO_INVALID', 'Файл не является изображением нужного формата.');
      if (isReferenced(path)) return fail(res, 409, 'STORAGE_ERROR', 'Файл уже используется.');
      if (dirSize(photosDir) + body.length > opts.storageLimitBytes) {
        return fail(res, 507, 'STORAGE_FULL', 'Хранилище фотографий заполнено.');
      }
      try {
        mkdirSync(join(photosDir, req.userId!), { recursive: true });
        writeFileSync(join(photosDir, path), body);
      } catch {
        return fail(res, 500, 'STORAGE_ERROR', 'Не удалось сохранить файл.');
      }
      res.status(201).json({ path });
    },
  );

  api.delete('/storage/photos/:uid/:file', requireAuth, (req: AuthedRequest, res) => {
    const path = photoPathFromParams(req, res);
    if (!path) return;
    if (isReferenced(path)) return fail(res, 409, 'FORBIDDEN', 'Файл привязан к точке.');
    const file = join(photosDir, path);
    if (existsSync(file)) unlinkSync(file);
    res.status(204).end();
  });

  // --- Создание точки -------------------------------------------------------

  api.post('/obstacles', requireAuth, (req: AuthedRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = validateObstacleInput(body as never, bounds);
    if (!result.ok) return fail(res, 400, 'VALIDATION_ERROR', 'Проверьте отмеченные поля.', result.errors);

    const photoPath = body.photo_path;
    const match = typeof photoPath === 'string' ? PHOTO_PATH_RE.exec(photoPath) : null;
    if (!match || typeof photoPath !== 'string') {
      return fail(res, 400, 'VALIDATION_ERROR', 'Проверьте отмеченные поля.', { photo: 'Добавьте фотографию.' });
    }
    // Политика: только свой created_by и только свой файл.
    if (match[1] !== req.userId) return fail(res, 403, 'FORBIDDEN', 'Чужой файл.');
    if (!existsSync(join(photosDir, photoPath))) {
      return fail(res, 400, 'VALIDATION_ERROR', 'Проверьте отмеченные поля.', { photo: 'Фото не загружено.' });
    }
    const id = match[2]!.toLowerCase();
    if (body.id !== undefined && body.id !== id) {
      return fail(res, 400, 'VALIDATION_ERROR', 'ID точки не совпадает с именем файла.');
    }

    const v = result.value;
    try {
      db.prepare(
        `INSERT INTO obstacles (id, created_by, lat, lon, category, condition, description, photo_path, observed_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      ).run(id, req.userId!, v.lat, v.lon, v.category, v.condition, v.description, photoPath, v.observed_at, new Date().toISOString());
    } catch (err) {
      const msg = String((err as Error).message);
      if (msg.includes('UNIQUE')) return fail(res, 409, 'VALIDATION_ERROR', 'Такая точка уже сохранена.');
      if (msg.includes('CHECK')) return fail(res, 400, 'VALIDATION_ERROR', 'Проверьте отмеченные поля.');
      return fail(res, 500, 'DATABASE_ERROR', 'Не удалось сохранить.');
    }
    const row = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM obstacles WHERE id = ?`).get(id);
    res.status(201).json(row);
  });

  // --- RPC report_obstacle --------------------------------------------------

  api.post('/rpc/report_obstacle', requireAuth, (req: AuthedRequest, res) => {
    const { obstacle_id, reason } = (req.body ?? {}) as Record<string, unknown>;
    if (!isUuid(obstacle_id)) return fail(res, 404, 'NOT_FOUND', 'Точка не найдена.');
    if (!isReportReason(reason)) return fail(res, 400, 'VALIDATION_ERROR', 'Выберите причину.');

    const recent = db
      .prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?')
      .get(req.userId!, hourAgo()) as { n: number };
    if (recent.n >= REPORT_RATE_LIMIT_PER_HOUR) return fail(res, 429, 'RATE_LIMITED', 'Слишком много сигналов.');

    try {
      const out = transaction(db, () => {
        const ob = db
          .prepare(`SELECT id FROM obstacles WHERE id = ? AND status IN ('active', 'disputed')`)
          .get(obstacle_id);
        if (!ob) return { error: 'NOT_FOUND' as const };
        const dup = db
          .prepare('SELECT 1 FROM reports WHERE obstacle_id = ? AND reporter_id = ?')
          .get(obstacle_id, req.userId!);
        if (dup) return { error: 'ALREADY_REPORTED' as const };
        db.prepare('INSERT INTO reports (id, obstacle_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(
          randomUUID(),
          obstacle_id,
          req.userId!,
          reason,
          new Date().toISOString(),
        );
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE obstacle_id = ?').get(obstacle_id) as {
          n: number;
        };
        const status = statusForReportCount(n);
        db.prepare('UPDATE obstacles SET status = ? WHERE id = ?').run(status, obstacle_id);
        return { report_count: n, status };
      });
      if ('error' in out) {
        return out.error === 'NOT_FOUND'
          ? fail(res, 404, 'NOT_FOUND', 'Точка не найдена.')
          : fail(res, 409, 'ALREADY_REPORTED', 'Сигнал уже отправлен.');
      }
      res.json(out);
    } catch {
      fail(res, 500, 'DATABASE_ERROR', 'Не удалось сохранить сигнал.');
    }
  });

  // --- Функция route-wheelchair (аналог Supabase Edge Function) ------------
  // Маршрутизатор выбирается в .env: Valhalla (OSM, без ключа) или OpenRouteService.

  api.post('/functions/route-wheelchair', requireAuth, async (req: AuthedRequest, res) => {
    const { start, end } = (req.body ?? {}) as { start?: { lat?: unknown; lon?: unknown }; end?: { lat?: unknown; lon?: unknown } };
    const pts = [start, end].map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon) }));
    const valid = pts.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && inBounds(bounds, p.lat, p.lon));
    if (!valid) return fail(res, 400, 'ROUTE_INVALID', 'Начало и конец должны быть внутри пилотного района.');
    const [a, b] = pts as [{ lat: number; lon: number }, { lat: number; lon: number }];
    if (Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6) {
      return fail(res, 400, 'ROUTE_INVALID', 'Начало и конец совпадают.');
    }

    const recent = db
      .prepare('SELECT COUNT(*) AS n FROM route_requests WHERE session_id = ? AND created_at > ?')
      .get(req.userId!, hourAgo()) as { n: number };
    if (recent.n >= ROUTE_RATE_LIMIT_PER_HOUR) {
      return fail(res, 429, 'ROUTE_RATE_LIMITED', 'Слишком много маршрутов за час.');
    }

    if (opts.router.engine === 'ors' && !opts.router.apiKey) {
      return fail(res, 503, 'ROUTE_UNAVAILABLE', 'Маршрутизатор не настроен: нет ORS_API_KEY.');
    }
    db.prepare('INSERT INTO route_requests (session_id, created_at) VALUES (?, ?)').run(
      req.userId!,
      new Date().toISOString(),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
    try {
      const out = await requestRoute(opts.router, a, b, controller.signal, doFetch);
      if (out.ok) return res.json(out.route);
      console.warn(`[route] ${out.code}: ${out.detail}`);
      return out.code === 'ROUTE_NOT_FOUND'
        ? fail(res, 404, 'ROUTE_NOT_FOUND', 'Маршрут не найден.')
        : fail(res, 503, 'ROUTE_UNAVAILABLE', 'Маршрутизатор недоступен или исчерпана квота.');
    } catch (err) {
      console.warn('[route] request failed:', (err as Error).name, (err as Error).message);
      fail(res, 503, 'ROUTE_UNAVAILABLE', 'Маршрутизатор не ответил вовремя.');
    } finally {
      clearTimeout(timer);
    }
  });

  api.use((_req, res) => fail(res, 404, 'NOT_FOUND', 'Нет такого метода API.'));

  // Ошибки парсинга тела запроса
  api.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.too.large') {
      return req.path.startsWith('/storage')
        ? fail(res, 413, 'PHOTO_TOO_LARGE', 'Файл больше 5 МБ.')
        : fail(res, 413, 'VALIDATION_ERROR', 'Слишком большой запрос.');
    }
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'VALIDATION_ERROR', 'Неверный JSON.');
    console.error(err);
    fail(res, 500, 'DATABASE_ERROR', 'Внутренняя ошибка.');
  });

  app.use('/api', api);

  // Собранный клиент (npm run build && npm start)
  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = resolve(opts.staticDir);
    app.use(express.static(dir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dir, 'index.html')));
  }

  return app;
}
