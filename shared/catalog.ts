// Справочник категорий и состояний (раздел 2.3 ТЗ).

export const CATEGORIES = ['curb', 'stairs', 'elevator'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONDITIONS_BY_CATEGORY = {
  curb: ['passable', 'blocked', 'unknown'],
  stairs: ['ramp', 'blocked', 'unknown'],
  elevator: ['working', 'broken', 'unknown'],
} as const satisfies Record<Category, readonly string[]>;

export type Condition = (typeof CONDITIONS_BY_CATEGORY)[Category][number];

/** Обобщенный класс состояния: доступно / препятствие / неизвестно. */
export type ConditionClass = 'good' | 'bad' | 'unknown';

export const CONDITION_CLASS: Record<Condition, ConditionClass> = {
  passable: 'good',
  ramp: 'good',
  working: 'good',
  blocked: 'bad',
  broken: 'bad',
  unknown: 'unknown',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  curb: 'Бордюр',
  stairs: 'Ступени',
  elevator: 'Лифт',
};

export const CONDITION_LABEL: Record<Category, Record<string, string>> = {
  curb: { passable: 'Есть съезд', blocked: 'Высокий бордюр', unknown: 'Неизвестно' },
  stairs: { ramp: 'Есть пандус', blocked: 'Только ступени', unknown: 'Неизвестно' },
  elevator: { working: 'Работает', broken: 'Не работает', unknown: 'Неизвестно' },
};

export const CLASS_LABEL: Record<ConditionClass, string> = {
  good: 'Доступно',
  bad: 'Препятствие',
  unknown: 'Неизвестно',
};

export const REPORT_REASONS = ['outdated', 'incorrect'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  outdated: 'Состояние изменилось',
  incorrect: 'Отметка неверная',
};

export const STATUSES = ['active', 'disputed', 'hidden'] as const;
export type Status = (typeof STATUSES)[number];

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

export function isValidPair(category: unknown, condition: unknown): condition is Condition {
  if (!isCategory(category) || typeof condition !== 'string') return false;
  return (CONDITIONS_BY_CATEGORY[category] as readonly string[]).includes(condition);
}

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === 'string' && (REPORT_REASONS as readonly string[]).includes(v);
}

export function conditionLabel(category: Category, condition: Condition): string {
  return CONDITION_LABEL[category][condition] ?? condition;
}
