import { useEffect, useRef, useState } from 'react';
import type { LatLon, ObstacleDTO, RouteResponse } from '../../shared/types';
import { CATEGORY_LABEL, CONDITION_CLASS, conditionLabel } from '../../shared/catalog';
import { formatDistance, formatDuration } from '../lib/format';
import { CategoryBadge, Icon } from './Icon';

export interface NearPoint {
  item: ObstacleDTO;
  distance: number;
}

interface Props {
  start: LatLon | null;
  end: LatLon | null;
  loading: boolean;
  result: RouteResponse | null;
  error: { message: string; retryAt: number | null } | null;
  warnings: NearPoint[];
  disputed: NearPoint[];
  accessibleNear: number;
  onUseCenter(): void;
  onRetry(): void;
  onReset(): void;
  onClose(): void;
  onOpenPoint(id: string): void;
}

function PointRow({ p, onOpen }: { p: NearPoint; onOpen(id: string): void }) {
  const cls = CONDITION_CLASS[p.item.condition];
  return (
    <li>
      <button type="button" className="point-row" onClick={() => onOpen(p.item.id)}>
        <CategoryBadge category={p.item.category} cls={cls} />
        <span className="point-row__text">
          <strong>{conditionLabel(p.item.category, p.item.condition)}</strong>
          <span>{CATEGORY_LABEL[p.item.category]}</span>
        </span>
        <span className="point-row__meta">{Math.round(p.distance)} м</span>
        <Icon name="chevron" size={18} className="point-row__chevron" />
      </button>
    </li>
  );
}

export function RoutePanel(props: Props) {
  const { start, end, loading, result, error, warnings, disputed } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => headingRef.current?.focus(), []);
  useEffect(() => {
    if (!error?.retryAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [error?.retryAt]);

  const waitSec = error?.retryAt ? Math.max(0, Math.ceil((error.retryAt - now) / 1000)) : 0;
  const step = !start ? 'start' : !end ? 'end' : 'ready';
  const total = warnings.length + disputed.length;

  return (
    <section className="panel" aria-labelledby="route-title">
      <div className="panel-head">
        <h2 id="route-title" ref={headingRef} tabIndex={-1}>
          Маршрут для коляски
        </h2>
        <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Закрыть маршрут">
          <Icon name="close" />
        </button>
      </div>

      <ol className="route-steps">
        <li className={start ? 'is-done' : step === 'start' ? 'is-current' : ''}>
          <span className="pin-inline pin--start">А</span>
          <span>{start ? 'Начало выбрано' : 'Нажмите на карту, откуда едете'}</span>
        </li>
        <li className={end ? 'is-done' : step === 'end' ? 'is-current' : ''}>
          <span className="pin-inline pin--end">Б</span>
          <span>{end ? 'Конец выбран' : 'Нажмите, куда едете'}</span>
        </li>
      </ol>

      <div className="row">
        {step !== 'ready' && (
          <button type="button" className="btn btn--secondary btn--small" onClick={props.onUseCenter}>
            <Icon name="crosshair" size={18} />
            {step === 'start' ? 'Начало — центр карты' : 'Конец — центр карты'}
          </button>
        )}
        {(start || end) && (
          <button type="button" className="btn btn--ghost btn--small" onClick={props.onReset} disabled={loading}>
            Сбросить
          </button>
        )}
      </div>

      <div aria-live="polite" className="route-live">
        {loading && (
          <div className="route-loading">
            <span className="route-loading__track">
              <span className="route-loading__dot" />
            </span>
            Строим маршрут…
          </div>
        )}

        {error && !loading && (
          <div className="notice notice--error" role="alert">
            <Icon name="alert" className="notice__icon" />
            <div className="notice__body">
              <p>{error.message}</p>
              <button type="button" className="btn btn--secondary btn--small" onClick={props.onRetry} disabled={waitSec > 0}>
                <Icon name="refresh" size={18} />
                {waitSec > 0 ? `Повторить через ${waitSec} с` : 'Повторить'}
              </button>
            </div>
          </div>
        )}

        {result && !loading && (
          <div className="route-result">
            <div className="route-summary">
              <div>
                <span className="route-summary__value">{formatDistance(result.distance)}</span>
                <span className="route-summary__label">расстояние</span>
              </div>
              <div>
                <span className="route-summary__value">{formatDuration(result.duration)}</span>
                <span className="route-summary__label">в пути, примерно</span>
              </div>
              <div className={total ? 'is-warn' : 'is-clear'}>
                <span className="route-summary__value">{total}</span>
                <span className="route-summary__label">{total ? 'предупреждений' : 'препятствий нет'}</span>
              </div>
            </div>
            <p className="disclaimer">
              Маршрут построен по данным OpenStreetMap и может содержать неотмеченные препятствия.
            </p>

            <div className="tactile-band" aria-hidden="true" />
            <h3>Предупреждения рядом с маршрутом</h3>
            {warnings.length ? (
              <ul className="point-list">
                {warnings.map((p) => (
                  <PointRow key={p.item.id} p={p} onOpen={props.onOpenPoint} />
                ))}
              </ul>
            ) : (
              <p className="muted">В пределах 30 м от линии препятствий не отмечено.</p>
            )}

            {disputed.length > 0 && (
              <>
                <h3>Спорные отметки</h3>
                <p className="muted small">Кто-то сообщил, что они устарели. Проверьте на месте.</p>
                <ul className="point-list">
                  {disputed.map((p) => (
                    <PointRow key={p.item.id} p={p} onOpen={props.onOpenPoint} />
                  ))}
                </ul>
              </>
            )}

            {props.accessibleNear > 0 && (
              <p className="muted small">Доступных мест у маршрута (съезды, пандусы, лифты): {props.accessibleNear}.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
