import { type Bounds, DESCRIPTION_LIMIT, PHOTO_INPUT_LIMIT, PHOTO_MIME_TYPES, REPORT_HIDE_THRESHOLD, inBounds } from './config';
import { type Category, type Condition, type Status, isCategory, isValidPair } from './catalog';

export type FormField = 'coordinate' | 'category' | 'condition' | 'description' | 'observed_at' | 'photo';
export type FieldErrors = Partial<Record<FormField, string>>;

export interface ObstacleInput {
  lat: unknown;
  lon: unknown;
  category: unknown;
  condition: unknown;
  description?: unknown;
  observed_at: unknown;
}

export interface ValidObstacle {
  lat: number;
  lon: number;
  category: Category;
  condition: Condition;
  description: string;
  observed_at: string;
}

// Управляющие символы, кроме перевода строки.
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/** Обрезает пробелы и удаляет управляющие символы. Длину не режет — ее проверяет валидатор. */
export function sanitizeDescription(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();
}

/** Длина в символах (кодовых точках), как считает SQL. */
export function textLength(s: string): number {
  return Array.from(s).length;
}

export function validateObstacleInput(
  input: ObstacleInput,
  bounds: Bounds,
  now: Date = new Date(),
): { ok: true; value: ValidObstacle } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const lat = typeof input.lat === 'number' ? input.lat : Number.NaN;
  const lon = typeof input.lon === 'number' ? input.lon : Number.NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    errors.coordinate = 'Выберите место на карте.';
  } else if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    errors.coordinate = 'Координата вне допустимого диапазона.';
  } else if (!inBounds(bounds, lat, lon)) {
    errors.coordinate = 'Точка должна быть внутри пилотного района.';
  }

  if (!isCategory(input.category)) {
    errors.category = 'Выберите категорию.';
  }
  if (input.condition === undefined || input.condition === null || input.condition === '') {
    errors.condition = 'Выберите состояние.';
  } else if (!isValidPair(input.category, input.condition)) {
    errors.condition = 'Состояние не подходит к категории.';
  }

  const description = sanitizeDescription(input.description);
  if (textLength(description) > DESCRIPTION_LIMIT) {
    errors.description = `Не больше ${DESCRIPTION_LIMIT} символов.`;
  }

  let observedIso = '';
  if (typeof input.observed_at !== 'string' || input.observed_at === '') {
    errors.observed_at = 'Укажите время наблюдения.';
  } else {
    const d = new Date(input.observed_at);
    if (Number.isNaN(d.getTime())) {
      errors.observed_at = 'Неверная дата.';
    } else if (d.getTime() > now.getTime() + 5 * 60_000) {
      errors.observed_at = 'Время наблюдения не может быть в будущем.';
    } else if (d.getUTCFullYear() < 2000) {
      errors.observed_at = 'Слишком ранняя дата.';
    } else {
      observedIso = d.toISOString();
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      lat,
      lon,
      category: input.category as Category,
      condition: input.condition as Condition,
      description,
      observed_at: observedIso,
    },
  };
}

/** Проверка файла до сжатия. Возвращает текст ошибки или null. */
export function validatePhotoMeta(meta: { type: string; size: number } | null | undefined): string | null {
  if (!meta) return 'Добавьте фотографию.';
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(meta.type)) {
    return 'Выберите фотографию JPEG, PNG или WebP до 5 МБ.';
  }
  if (meta.size > PHOTO_INPUT_LIMIT) {
    return 'Выберите фотографию JPEG, PNG или WebP до 5 МБ.';
  }
  if (meta.size === 0) return 'Файл пустой.';
  return null;
}

/** Статус по количеству уникальных сигналов (таблица «Смена статуса»). */
export function statusForReportCount(count: number): Status {
  if (count >= REPORT_HIDE_THRESHOLD) return 'hidden';
  if (count >= 1) return 'disputed';
  return 'active';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Путь фото в хранилище: <session_id>/<point_id>.webp|jpg */
export const PHOTO_PATH_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(webp|jpg)$/i;
