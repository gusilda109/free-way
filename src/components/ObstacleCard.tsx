import { useEffect, useRef, useState } from 'react';
import type { ObstacleDTO, ReportResponse } from '../../shared/types';
import {
  CATEGORY_LABEL,
  CONDITION_CLASS,
  REPORT_REASONS,
  REPORT_REASON_LABEL,
  type ReportReason,
  conditionLabel,
} from '../../shared/catalog';
import { photoUrl, reportObstacle } from '../api/client';
import { formatObserved } from '../lib/format';
import { errorCode, userMessage } from '../lib/messages';
import { CategoryBadge, Icon } from './Icon';

interface Props {
  obstacle: ObstacleDTO | null;
  unavailable: boolean;
  onBack(): void;
  onReported(id: string, res: ReportResponse): void;
}

export function ObstacleCard({ obstacle, unavailable, onBack, onReported }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [photoState, setPhotoState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    headingRef.current?.focus();
    setReportOpen(false);
    setReason(null);
    setResult(null);
    setDone(false);
    setPhotoState('loading');
  }, [obstacle?.id]);

  if (!obstacle || unavailable) {
    return (
      <section className="panel" aria-labelledby="card-title">
        <button type="button" className="link-back" onClick={onBack}>
          <Icon name="back" size={18} />
          Назад
        </button>
        <div className="empty">
          <div className="empty__art" aria-hidden="true">
            <Icon name="close" size={26} />
          </div>
          <h2 id="card-title" ref={headingRef} tabIndex={-1}>
            Отметка недоступна
          </h2>
          <p className="muted">Эта отметка больше недоступна. Карта обновлена.</p>
        </div>
      </section>
    );
  }

  const cls = CONDITION_CLASS[obstacle.condition];

  const submit = async () => {
    if (!reason) return;
    setSending(true);
    setResult(null);
    try {
      const res = await reportObstacle(obstacle.id, reason);
      setDone(true);
      setReportOpen(false);
      setResult({
        tone: 'ok',
        text:
          res.status === 'hidden'
            ? 'Сигнал учтен. Отметка скрыта: о ней сообщили три человека.'
            : 'Сигнал учтен. Отметка помечена как спорная.',
      });
      onReported(obstacle.id, res);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'ALREADY_REPORTED') setDone(true);
      setResult({ tone: 'error', text: userMessage(err) });
      if (code === 'NOT_FOUND') onReported(obstacle.id, { report_count: 3, status: 'hidden' });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="panel card" aria-labelledby="card-title">
      <button type="button" className="link-back" onClick={onBack}>
        <Icon name="back" size={18} />
        Назад
      </button>

      <div className={`card-photo card-photo--${photoState}`}>
        {photoState === 'failed' ? (
          <div className="card-photo__fallback">
            <Icon name="camera" size={28} />
            Фото не загрузилось
          </div>
        ) : (
          <img
            src={photoUrl(obstacle.id)}
            alt={`Фото: ${CATEGORY_LABEL[obstacle.category].toLowerCase()}, ${conditionLabel(obstacle.category, obstacle.condition).toLowerCase()}`}
            onLoad={() => setPhotoState('ready')}
            onError={() => setPhotoState('failed')}
          />
        )}
        <span className={`card-photo__status card-photo__status--${cls}`}>
          {cls === 'good' ? 'Доступно' : cls === 'bad' ? 'Препятствие' : 'Неизвестно'}
        </span>
      </div>

      <div className="card-head">
        <CategoryBadge category={obstacle.category} cls={cls} size={48} />
        <div>
          <p className="card-category">{CATEGORY_LABEL[obstacle.category]}</p>
          <h2 id="card-title" ref={headingRef} tabIndex={-1} className={`card-title card-title--${cls}`}>
            {conditionLabel(obstacle.category, obstacle.condition)}
          </h2>
        </div>
      </div>
      <p className="muted">Отмечено {formatObserved(obstacle.observed_at)}</p>

      {obstacle.status === 'disputed' && (
        <div className="notice notice--warn" role="note">
          <Icon name="alert" className="notice__icon" />
          <p>Кто-то сообщил, что отметка устарела или неверна. Проверьте на месте.</p>
        </div>
      )}

      {obstacle.description && <p className="card-description">{obstacle.description}</p>}

      {result && (
        <div className={`notice ${result.tone === 'ok' ? 'notice--ok' : 'notice--error'}`} role="status">
          {result.tone === 'ok' ? (
            <svg className="check-anim notice__icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M7 12.5l3.5 3.5L17 9" />
            </svg>
          ) : (
            <Icon name="alert" className="notice__icon" />
          )}
          <p>{result.text}</p>
        </div>
      )}

      {!done && (
        <div className={`report ${reportOpen ? 'is-open' : ''}`}>
          {!reportOpen ? (
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setReportOpen(true)}>
              <Icon name="flag" />
              Сообщить об изменении
            </button>
          ) : (
            <fieldset>
              <legend>Что не так с отметкой?</legend>
              <div className="reason-list">
                {REPORT_REASONS.map((r) => (
                  <label key={r} className="reason">
                    <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                    <span>{REPORT_REASON_LABEL[r]}</span>
                  </label>
                ))}
              </div>
              <div className="row">
                <button type="button" className="btn btn--ghost" onClick={() => setReportOpen(false)} disabled={sending}>
                  Отмена
                </button>
                <button
                  type="button"
                  className={`btn btn--primary ${sending ? 'is-busy' : ''}`}
                  onClick={submit}
                  disabled={!reason || sending}
                >
                  {sending ? 'Отправляем…' : 'Отправить сигнал'}
                </button>
              </div>
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
