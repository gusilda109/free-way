import type { ObstacleDTO } from '../../shared/types';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CLASS_LABEL,
  CONDITION_CLASS,
  type Category,
  type ConditionClass,
  conditionLabel,
} from '../../shared/catalog';
import { pluralPoints } from '../lib/format';
import { CategoryBadge, Icon } from './Icon';

export interface Filters {
  categories: Set<Category>;
  classes: Set<ConditionClass>;
}

interface Props {
  filters: Filters;
  wheelchairPreset: boolean;
  visible: ObstacleDTO[];
  loading: boolean;
  loadError: string | null;
  truncated: boolean;
  hasRoute: boolean;
  onTogglePreset(): void;
  onToggleCategory(c: Category): void;
  onToggleClass(c: ConditionClass): void;
  onStartRoute(): void;
  onStartAdd(): void;
  onOpenPoint(id: string): void;
  onReload(): void;
}

const CLASSES: ConditionClass[] = ['good', 'bad', 'unknown'];

export function BrowsePanel(props: Props) {
  const { filters, visible } = props;
  const filtersActive =
    !props.wheelchairPreset && (filters.categories.size < CATEGORIES.length || filters.classes.size < CLASSES.length);

  return (
    <section className="panel" aria-label="Карта и фильтры">
      <button
        type="button"
        role="switch"
        aria-checked={props.wheelchairPreset}
        className={`preset ${props.wheelchairPreset ? 'is-on' : ''}`}
        onClick={props.onTogglePreset}
      >
        <span className="preset__icon">
          <Icon name="wheelchair" size={24} />
        </span>
        <span className="preset__text">
          <strong>Для коляски</strong>
          <span>{props.wheelchairPreset ? 'Только съезды, пандусы и рабочие лифты' : 'Показать только доступное'}</span>
        </span>
        <span className="switch" aria-hidden="true">
          <span className="switch__knob" />
        </span>
      </button>

      <div className="actions">
        <button type="button" className="btn btn--secondary" onClick={props.onStartRoute}>
          <Icon name="route" />
          {props.hasRoute ? 'Открыть маршрут' : 'Маршрут'}
        </button>
        <button type="button" className="btn btn--primary" onClick={props.onStartAdd}>
          <Icon name="plus" />
          Добавить точку
        </button>
      </div>

      {props.loadError && (
        <div className="notice notice--error" role="alert">
          <Icon name="alert" className="notice__icon" />
          <div className="notice__body">
            <p>{props.loadError}</p>
            <button type="button" className="btn btn--secondary btn--small" onClick={props.onReload}>
              <Icon name="refresh" size={18} />
              Повторить
            </button>
          </div>
        </div>
      )}
      {props.truncated && <p className="notice notice--warn">Показаны первые 500 отметок.</p>}

      <details className="filters">
        <summary>
          <Icon name="filter" />
          <span>Фильтры</span>
          {filtersActive && <span className="filters__dot" aria-label="включены" />}
          <Icon name="chevron" className="filters__chevron" size={18} />
        </summary>
        <div className="filters__body">
          <fieldset>
            <legend>Что показывать</legend>
            <div className="chips">
              {CATEGORIES.map((c) => (
                <label key={c} className="chip">
                  <input type="checkbox" checked={filters.categories.has(c)} onChange={() => props.onToggleCategory(c)} />
                  <span>
                    <Icon name={c} size={18} />
                    {CATEGORY_LABEL[c]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Состояние</legend>
            <div className="chips">
              {CLASSES.map((c) => (
                <label key={c} className="chip">
                  <input type="checkbox" checked={filters.classes.has(c)} onChange={() => props.onToggleClass(c)} />
                  <span>
                    <span className={`dot dot--${c}`} aria-hidden="true" />
                    {CLASS_LABEL[c]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      <div aria-live="polite" className="list-block">
        {props.loading ? (
          <ul className="skeleton-list" aria-label="Загружаем отметки">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <span className="skeleton skeleton--circle" />
                <span className="skeleton-lines">
                  <span className="skeleton skeleton--line" />
                  <span className="skeleton skeleton--line skeleton--short" />
                </span>
              </li>
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <div className="empty">
            <div className="empty__art" aria-hidden="true">
              <Icon name="flag" size={28} />
            </div>
            <p>
              <strong>В этой области пока нет отметок.</strong>
              <br />
              <span className="muted">Видели бордюр, ступени или лифт? Отметьте первым.</span>
            </p>
            <button type="button" className="btn btn--secondary btn--small" onClick={props.onStartAdd}>
              <Icon name="plus" size={18} />
              Добавить
            </button>
          </div>
        ) : (
          <>
            <h3 className="list-title">
              В видимой области <span className="count">{pluralPoints(visible.length)}</span>
            </h3>
            <ul className="point-list">
              {visible.slice(0, 30).map((p) => {
                const cls = CONDITION_CLASS[p.condition];
                return (
                  <li key={p.id}>
                    <button type="button" className="point-row" onClick={() => props.onOpenPoint(p.id)}>
                      <CategoryBadge category={p.category} cls={cls} />
                      <span className="point-row__text">
                        <strong>{conditionLabel(p.category, p.condition)}</strong>
                        <span>{CATEGORY_LABEL[p.category]}</span>
                      </span>
                      {p.status === 'disputed' && <span className="tag">спорная</span>}
                      <Icon name="chevron" size={18} className="point-row__chevron" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
