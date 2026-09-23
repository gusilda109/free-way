import { describe, expect, it } from 'vitest';
import { DEFAULT_PILOT_BOUNDS, parseBounds } from '../shared/config';
import {
  sanitizeDescription,
  statusForReportCount,
  validateObstacleInput,
  validatePhotoMeta,
} from '../shared/validation';

const valid = {
  lat: 54.8436,
  lon: 83.0936,
  category: 'elevator',
  condition: 'broken',
  description: '  Лифт не реагирует на кнопку  ',
  observed_at: '2026-09-19T08:30:00Z',
};
const now = new Date('2026-09-20T00:00:00Z');

describe('validateObstacleInput', () => {
  it('принимает пример из ТЗ', () => {
    const r = validateObstacleInput(valid, DEFAULT_PILOT_BOUNDS, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBe('Лифт не реагирует на кнопку');
  });

  it('требует координату, категорию, состояние и время', () => {
    const r = validateObstacleInput({ lat: undefined, lon: undefined, category: '', condition: '', observed_at: '' }, DEFAULT_PILOT_BOUNDS, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['category', 'condition', 'coordinate', 'observed_at']);
  });

  it('отклоняет точку вне пилотного района', () => {
    const r = validateObstacleInput({ ...valid, lat: 55.03, lon: 82.92 }, DEFAULT_PILOT_BOUNDS, now);
    expect(r.ok).toBe(false);
  });

  it('отклоняет неверное сочетание категории и состояния', () => {
    const r = validateObstacleInput({ ...valid, category: 'curb', condition: 'broken' }, DEFAULT_PILOT_BOUNDS, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.condition).toBeTruthy();
  });

  it('ограничивает описание 300 символами', () => {
    expect(validateObstacleInput({ ...valid, description: 'а'.repeat(300) }, DEFAULT_PILOT_BOUNDS, now).ok).toBe(true);
    expect(validateObstacleInput({ ...valid, description: 'а'.repeat(301) }, DEFAULT_PILOT_BOUNDS, now).ok).toBe(false);
  });

  it('не принимает время в будущем', () => {
    expect(validateObstacleInput({ ...valid, observed_at: '2026-09-21T00:00:00Z' }, DEFAULT_PILOT_BOUNDS, now).ok).toBe(false);
  });
});

describe('sanitizeDescription', () => {
  it('удаляет управляющие символы и оставляет переводы строк', () => {
    expect(sanitizeDescription(' a\u0000b\u0007\nc\t ')).toBe('ab\nc');
  });
  it('не трогает HTML — он выводится как текст', () => {
    expect(sanitizeDescription('<b>x</b>')).toBe('<b>x</b>');
  });
});

describe('validatePhotoMeta', () => {
  it('принимает JPEG/PNG/WebP до 5 МБ', () => {
    expect(validatePhotoMeta({ type: 'image/jpeg', size: 5 * 1024 * 1024 })).toBeNull();
    expect(validatePhotoMeta({ type: 'image/webp', size: 1000 })).toBeNull();
  });
  it('отклоняет большой файл и не изображение', () => {
    expect(validatePhotoMeta({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).not.toBeNull();
    expect(validatePhotoMeta({ type: 'application/pdf', size: 100 })).not.toBeNull();
    expect(validatePhotoMeta({ type: 'image/gif', size: 100 })).not.toBeNull();
  });
});

describe('statusForReportCount', () => {
  it('0 → active, 1–2 → disputed, 3+ → hidden', () => {
    expect([0, 1, 2, 3, 7].map(statusForReportCount)).toEqual(['active', 'disputed', 'disputed', 'hidden', 'hidden']);
  });
});

describe('parseBounds', () => {
  it('разбирает строку и откатывается к умолчанию при ошибке', () => {
    expect(parseBounds('1,2,3,4')).toEqual({ west: 1, south: 2, east: 3, north: 4 });
    expect(parseBounds('3,2,1,4')).toEqual(DEFAULT_PILOT_BOUNDS);
    expect(parseBounds('мусор')).toEqual(DEFAULT_PILOT_BOUNDS);
  });
});
