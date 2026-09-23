import { useEffect, useMemo, useRef, useState } from 'react';
import type { LatLon, ObstacleDTO } from '../../shared/types';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CONDITIONS_BY_CATEGORY,
  type Category,
  type Condition,
  conditionLabel,
  isValidPair,
} from '../../shared/catalog';
import { DESCRIPTION_LIMIT } from '../../shared/config';
import { type FieldErrors, textLength, validateObstacleInput, validatePhotoMeta } from '../../shared/validation';
import { createObstacle, currentUserId, deletePhoto, uploadPhoto } from '../api/client';
import { preparePhoto } from '../lib/image';
import { toLocalInput } from '../lib/format';
import { errorCode, userMessage } from '../lib/messages';
import { PILOT_BOUNDS } from '../lib/env';
import { Icon } from './Icon';

interface Props {
  coord: LatLon | null;
  onUseCenter(): void;
  onCancel(): void;
  onCreated(o: ObstacleDTO): void;
}

interface Draft {
  category: Category | '';
  condition: Condition | '';
  description: string;
  observed: string;
}

const DRAFT_KEY = 'svobodny-put.add-draft';

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw) as Draft;
  } catch {
    /* ignore */
  }
  return { category: '', condition: '', description: '', observed: toLocalInput(new Date()) };
}

export function AddForm({ coord, onUseCenter, onCancel, onCreated }: Props) {
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'photo' | 'upload' | 'save'>('idle');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = stage !== 'idle';

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  useEffect(() => headingRef.current?.focus(), []);

  // Черновик хранится до закрытия вкладки (NFR 06). Фото браузер сохранить не даст.
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft]);

  useEffect(() => {
    if (coord) setErrors((e) => ({ ...e, coordinate: undefined }));
  }, [coord]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (key === 'category' && !isValidPair(value, d.condition)) next.condition = '';
      return next;
    });
    const field = key === 'observed' ? 'observed_at' : key;
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const onFile = (f: File | null) => {
    setErrors((e) => ({ ...e, photo: undefined }));
    if (!f) return setFile(null);
    const err = validatePhotoMeta(f);
    if (err) {
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setErrors((e) => ({ ...e, photo: err }));
      return;
    }
    setFile(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const observedIso = draft.observed ? new Date(draft.observed).toISOString() : '';
    const check = validateObstacleInput(
      {
        lat: coord?.lat,
        lon: coord?.lon,
        category: draft.category,
        condition: draft.condition,
        description: draft.description,
        observed_at: observedIso,
      },
      PILOT_BOUNDS,
    );
    const photoErr = validatePhotoMeta(file);
    const all: FieldErrors = { ...(check.ok ? {} : check.errors), ...(photoErr ? { photo: photoErr } : {}) };
    if (!check.ok || photoErr) {
      setErrors(all);
      setFormError('Проверьте отмеченные поля.');
      const first = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
      return;
    }

    let uploadedPath: string | null = null;
    try {
      setStage('photo');
      const photo = await preparePhoto(file!).catch(() => {
        throw Object.assign(new Error('photo'), { photo: true });
      });
      setStage('upload');
      const userId = await currentUserId();
      const id = crypto.randomUUID();
      const path = `${userId}/${id}.${photo.ext}`;
      uploadedPath = await uploadPhoto(path, photo.blob);
      setStage('save');
      const created = await createObstacle({ id, ...check.value, photo_path: uploadedPath });
      uploadedPath = null;
      sessionStorage.removeItem(DRAFT_KEY);
      onCreated(created);
    } catch (err) {
      if ((err as { photo?: boolean }).photo) {
        setErrors((e) => ({ ...e, photo: 'Не удалось прочитать фото. Выберите другой файл.' }));
        setFormError('Проверьте отмеченные поля.');
      } else {
        const code = errorCode(err);
        const fields = (err as { fields?: FieldErrors }).fields;
        if (fields) setErrors(fields);
        if (code === 'PHOTO_INVALID' || code === 'PHOTO_TOO_LARGE') setErrors((e) => ({ ...e, photo: userMessage(err) }));
        setFormError(userMessage(err));
      }
      // Запись не создана — пробуем убрать загруженный файл
      if (uploadedPath) deletePhoto(uploadedPath).catch(() => undefined);
    } finally {
      setStage('idle');
    }
  };

  const conditions = draft.category ? CONDITIONS_BY_CATEGORY[draft.category] : [];
  const descLen = textLength(draft.description);
  const progress = { idle: 0, photo: 0.3, upload: 0.65, save: 0.92 }[stage];
  const stageLabel = { idle: 'Опубликовать', photo: 'Сжимаем фото…', upload: 'Загружаем фото…', save: 'Сохраняем…' }[stage];

  return (
    <form className="panel form" onSubmit={submit} noValidate aria-labelledby="add-title">
      <div className="panel-head">
        <h2 id="add-title" ref={headingRef} tabIndex={-1}>
          Новая отметка
        </h2>
        <button type="button" className="icon-btn" onClick={onCancel} disabled={busy} aria-label="Отменить добавление">
          <Icon name="close" />
        </button>
      </div>

      <div className="field">
        <span className="field-label" id="coord-label">
          Место
        </span>
        <div className={`coord ${coord ? 'coord--set' : ''}`} aria-live="polite">
          <span className="coord__icon">
            <Icon name={coord ? 'check' : 'crosshair'} size={18} />
          </span>
          <span key={coord ? `${coord.lat}${coord.lon}` : 'none'} className="coord__text">
            {coord ? `Выбрано: ${coord.lat.toFixed(5)}, ${coord.lon.toFixed(5)}` : 'Нажмите на карту, где находится объект'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={onUseCenter}
          aria-invalid={Boolean(errors.coordinate)}
          aria-describedby={errors.coordinate ? 'coord-err' : undefined}
        >
          <Icon name="crosshair" size={18} />
          Взять центр карты
        </button>
        {errors.coordinate && (
          <p className="field-error" id="coord-err">
            {errors.coordinate}
          </p>
        )}
      </div>

      <fieldset className="field" aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? 'cat-err' : undefined}>
        <legend className="field-label">Что это</legend>
        <div className="tiles">
          {CATEGORIES.map((c) => (
            <label key={c} className="tile">
              <input type="radio" name="category" value={c} checked={draft.category === c} onChange={() => set('category', c)} />
              <span>
                <Icon name={c} size={28} />
                {CATEGORY_LABEL[c]}
              </span>
            </label>
          ))}
        </div>
        {errors.category && (
          <p className="field-error" id="cat-err">
            {errors.category}
          </p>
        )}
      </fieldset>

      <fieldset
        className="field"
        disabled={!draft.category}
        aria-invalid={Boolean(errors.condition)}
        aria-describedby={errors.condition ? 'cond-err' : undefined}
      >
        <legend className="field-label">Состояние</legend>
        {draft.category ? (
          <div className="segmented" key={draft.category}>
            {conditions.map((c) => (
              <label key={c} className="segment">
                <input
                  type="radio"
                  name="condition"
                  value={c}
                  checked={draft.condition === c}
                  onChange={() => set('condition', c)}
                />
                <span className={`seg-${c}`}>{conditionLabel(draft.category as Category, c)}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="muted small">Сначала выберите, что это.</p>
        )}
        {errors.condition && (
          <p className="field-error" id="cond-err">
            {errors.condition}
          </p>
        )}
      </fieldset>

      <div className="field">
        <span className="field-label" id="photo-label">
          Фото
        </span>
        <label className={`dropzone ${preview ? 'has-photo' : ''}`} htmlFor="photo">
          {preview ? (
            <img className="dropzone__preview" src={preview} alt="Выбранное фото" />
          ) : (
            <span className="dropzone__empty">
              <Icon name="camera" size={30} />
              <strong>Сфотографировать или выбрать</strong>
            </span>
          )}
          {preview && <span className="dropzone__change">Заменить фото</span>}
        </label>
        <input
          ref={fileInputRef}
          id="photo"
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          aria-labelledby="photo-label"
          aria-invalid={Boolean(errors.photo)}
          aria-describedby={`photo-hint${errors.photo ? ' photo-err' : ''}`}
        />
        <p className="muted small" id="photo-hint">
          JPEG, PNG или WebP до 5 МБ. Геометка из файла удаляется.
        </p>
        {errors.photo && (
          <p className="field-error" id="photo-err">
            {errors.photo}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="observed">
          Когда видели
        </label>
        <input
          id="observed"
          type="datetime-local"
          value={draft.observed}
          max={toLocalInput(new Date())}
          onChange={(e) => set('observed', e.target.value)}
          aria-invalid={Boolean(errors.observed_at)}
          aria-describedby={errors.observed_at ? 'obs-err' : undefined}
        />
        {errors.observed_at && (
          <p className="field-error" id="obs-err">
            {errors.observed_at}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="description">
          Описание <span className="muted">(необязательно)</span>
        </label>
        <textarea
          id="description"
          rows={3}
          maxLength={DESCRIPTION_LIMIT}
          value={draft.description}
          placeholder="Например: съезд есть только с правой стороны"
          onChange={(e) => set('description', e.target.value)}
          aria-invalid={Boolean(errors.description)}
          aria-describedby="desc-count"
        />
        <p className="muted small counter" id="desc-count">
          {descLen} из {DESCRIPTION_LIMIT}
        </p>
        {errors.description && <p className="field-error">{errors.description}</p>}
      </div>

      {formError && (
        <div className="notice notice--error" role="alert">
          <Icon name="alert" className="notice__icon" />
          <p>{formError}</p>
        </div>
      )}

      <button type="submit" className={`btn btn--primary btn--block submit ${busy ? 'is-busy' : ''}`} disabled={busy}>
        <span className="submit__bar" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
        <span className="submit__label">{stageLabel}</span>
      </button>
    </form>
  );
}
