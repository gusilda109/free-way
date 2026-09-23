import type { ErrorCode } from '../../shared/types';
import { ApiError } from '../api/client';

// Тексты из таблицы «Единое поведение при ошибке».
const MESSAGES: Record<ErrorCode, string> = {
  NETWORK_ERROR: 'Нет соединения. Проверьте интернет и повторите.',
  LIMIT_EXCEEDED: 'Точек слишком много — показаны первые 500.',
  UNAUTHORIZED: 'Сессия устарела. Обновите страницу.',
  VALIDATION_ERROR: 'Проверьте отмеченные поля.',
  FORBIDDEN: 'Не удалось сохранить. Данные формы остались на экране.',
  DATABASE_ERROR: 'Не удалось сохранить. Данные формы остались на экране.',
  PHOTO_INVALID: 'Выберите фотографию JPEG, PNG или WebP до 5 МБ.',
  PHOTO_TOO_LARGE: 'Выберите фотографию JPEG, PNG или WebP до 5 МБ.',
  STORAGE_ERROR: 'Не удалось сохранить. Данные формы остались на экране.',
  STORAGE_FULL: 'Хранилище фотографий заполнено, добавление временно недоступно. Карта работает.',
  NOT_FOUND: 'Эта отметка больше недоступна.',
  ALREADY_REPORTED: 'Вы уже сообщали об изменении этой точки.',
  RATE_LIMITED: 'Слишком много сигналов за час. Попробуйте позже.',
  ROUTE_INVALID: 'Начало и конец должны быть внутри пилотного района.',
  ROUTE_NOT_FOUND: 'Между этими точками маршрут не найден. Поставьте начало и конец ближе к тротуару.',
  ROUTE_RATE_LIMITED: 'Лимит — 20 маршрутов в час. Попробуйте позже.',
  ROUTE_UNAVAILABLE: 'Маршрут сейчас недоступен. Карта и отметки продолжают работать.',
};

export function errorCode(err: unknown): ErrorCode {
  return err instanceof ApiError ? err.code : 'NETWORK_ERROR';
}

export function userMessage(err: unknown): string {
  return MESSAGES[errorCode(err)];
}
