import type {
  ApiErrorBody,
  CreateObstacleRequest,
  ErrorCode,
  LatLon,
  ObstacleDTO,
  ObstacleListResponse,
  ReportResponse,
  RouteResponse,
} from '../../shared/types';
import type { ReportReason } from '../../shared/catalog';
import { ROUTE_TIMEOUT_MS } from '../../shared/config';

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  fields?: Record<string, string>;

  constructor(code: ErrorCode, message: string, status = 0, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

// --- Анонимная сессия --------------------------------------------------------

const SESSION_KEY = 'svobodny-put.session';
interface Session {
  user_id: string;
  access_token: string;
}
let session: Session | null = null;
let sessionPromise: Promise<Session> | null = null;

function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

async function createAnonymousSession(): Promise<Session> {
  const res = await rawFetch('/api/auth/anonymous', { method: 'POST' });
  if (!res.ok) throw await toError(res);
  const s = (await res.json()) as Session;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // приватный режим — сессия живет до закрытия вкладки
  }
  return s;
}

/** Создает или восстанавливает анонимную сессию (без формы регистрации). */
export function ensureSession(): Promise<Session> {
  if (session) return Promise.resolve(session);
  sessionPromise ??= (async () => {
    const stored = readStoredSession();
    if (stored) {
      const res = await rawFetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${stored.access_token}` },
      });
      if (res.ok) return (session = stored);
      if (res.status !== 401) throw await toError(res);
    }
    return (session = await createAnonymousSession());
  })().finally(() => {
    sessionPromise = null;
  });
  return sessionPromise;
}

function resetSession() {
  session = null;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// --- Транспорт ---------------------------------------------------------------

async function rawFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs, ...rest } = init;
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ApiError('ROUTE_UNAVAILABLE', 'Время ожидания истекло.');
    }
    throw new ApiError('NETWORK_ERROR', 'Нет соединения.');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function toError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  if (body?.error) return new ApiError(body.error.code, body.error.message, res.status, body.error.fields);
  if (res.status === 413) return new ApiError('PHOTO_TOO_LARGE', 'Файл слишком большой.', 413);
  // Сервер API не запущен: dev-прокси Vite отвечает 5xx без тела
  if (res.status >= 500) return new ApiError('NETWORK_ERROR', 'Сервер недоступен.', res.status);
  return new ApiError('DATABASE_ERROR', `Ошибка ${res.status}`, res.status);
}

async function authed(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  retried = false,
): Promise<Response> {
  const s = await ensureSession();
  const res = await rawFetch(url, {
    ...init,
    headers: { ...((init.headers as Record<string, string>) ?? {}), Authorization: `Bearer ${s.access_token}` },
  });
  if (res.status === 401 && !retried) {
    resetSession();
    return authed(url, init, true);
  }
  if (!res.ok) throw await toError(res);
  return res;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// --- Операции из раздела 3.1 ТЗ ------------------------------------------------

export async function fetchObstacles(): Promise<ObstacleListResponse> {
  const res = await rawFetch('/api/obstacles');
  if (!res.ok) throw await toError(res);
  return res.json();
}

export async function fetchObstacle(id: string): Promise<ObstacleDTO> {
  const res = await rawFetch(`/api/obstacles/${id}`);
  if (!res.ok) throw await toError(res);
  return res.json();
}

export function photoUrl(id: string): string {
  return `/api/photos/${id}`;
}

export async function uploadPhoto(path: string, blob: Blob): Promise<string> {
  const res = await authed(`/api/storage/photos/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });
  return ((await res.json()) as { path: string }).path;
}

export async function deletePhoto(path: string): Promise<void> {
  await authed(`/api/storage/photos/${path}`, { method: 'DELETE' });
}

export async function createObstacle(req: CreateObstacleRequest): Promise<ObstacleDTO> {
  const res = await authed('/api/obstacles', json(req));
  return res.json();
}

export async function reportObstacle(obstacleId: string, reason: ReportReason): Promise<ReportResponse> {
  const res = await authed('/api/rpc/report_obstacle', json({ obstacle_id: obstacleId, reason }));
  return res.json();
}

export async function buildRoute(start: LatLon, end: LatLon): Promise<RouteResponse> {
  const res = await authed('/api/functions/route-wheelchair', {
    ...json({ start, end }),
    timeoutMs: ROUTE_TIMEOUT_MS + 1500,
  });
  return res.json();
}

export async function currentUserId(): Promise<string> {
  return (await ensureSession()).user_id;
}
