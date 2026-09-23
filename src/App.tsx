import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LatLon, ObstacleDTO, ReportResponse, RouteResponse } from '../shared/types';
import { CATEGORIES, CONDITION_CLASS, type Category, type ConditionClass } from '../shared/catalog';
import { ROUTE_RETRY_DELAY_MS, ROUTE_WARNING_DISTANCE_M, inBounds } from '../shared/config';
import { pointsNearLine } from '../shared/geo';
import { buildRoute, ensureSession, fetchObstacle, fetchObstacles } from './api/client';
import { errorCode, userMessage } from './lib/messages';
import { PILOT_BOUNDS, PILOT_NAME } from './lib/env';
import { MapView, type MapHandle } from './components/MapView';
import { BrowsePanel, type Filters } from './components/BrowsePanel';
import { ObstacleCard } from './components/ObstacleCard';
import { AddForm } from './components/AddForm';
import { RoutePanel } from './components/RoutePanel';
import { Icon, Logo } from './components/Icon';

type Mode = 'browse' | 'route' | 'add';
const panelKeyFor = (selectedId: string | null, mode: Mode) => (selectedId ? `card-${selectedId}` : mode);
const ALL_CLASSES: ConditionClass[] = ['good', 'bad', 'unknown'];

export default function App() {
  const mapRef = useRef<MapHandle>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [insets, setInsets] = useState({ left: 0, bottom: 0 });
  const [collapsed, setCollapsed] = useState(false);

  // Данные
  const [obstacles, setObstacles] = useState<ObstacleDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // Режимы и выбор
  const [mode, setMode] = useState<Mode>('browse');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGone, setSelectedGone] = useState(false);
  // null — карта еще не сообщила видимую область; тогда список показывает все точки
  const [visibleIds, setVisibleIds] = useState<string[] | null>(null);
  const [filters, setFilters] = useState<Filters>({
    categories: new Set(CATEGORIES),
    classes: new Set(ALL_CLASSES),
  });

  // Маршрут
  const [start, setStart] = useState<LatLon | null>(null);
  const [end, setEnd] = useState<LatLon | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<{ message: string; retryAt: number | null } | null>(null);
  const routeReq = useRef(0);

  // Добавление
  const [addCoord, setAddCoord] = useState<LatLon | null>(null);

  const [userPos, setUserPos] = useState<LatLon | null>(null);
  const [mapError, setMapError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // --- Загрузка -----------------------------------------------------------------

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetchObstacles();
      setObstacles(res.items);
      setTruncated(res.truncated);
    } catch (err) {
      setLoadError(userMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    ensureSession().catch(() => undefined);
    load();
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          setUserPos(p);
          if (inBounds(PILOT_BOUNDS, p.lat, p.lon)) mapRef.current?.flyTo(p, 16);
        },
        () => undefined,
        { timeout: 8000, maximumAge: 60_000 },
      );
    }
  }, [load]);

  // Панель перекрывает часть карты: снизу на телефоне, слева на десктопе.
  // Сообщаем карте, чтобы центр и маршрут оказались в видимой части.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const mq = window.matchMedia('(max-width: 899px)');
    const update = () => {
      const r = el.getBoundingClientRect();
      setInsets(
        mq.matches
          ? { left: 0, bottom: Math.round(window.innerHeight - r.top) }
          : { left: Math.round(r.right), bottom: 0 },
      );
    };
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    mq.addEventListener('change', update);
    update();
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // --- Фильтры -------------------------------------------------------------------

  const wheelchairPreset =
    filters.classes.size === 1 && filters.classes.has('good') && filters.categories.size === CATEGORIES.length;

  const filtered = useMemo(
    () =>
      obstacles.filter(
        (o) => filters.categories.has(o.category) && filters.classes.has(CONDITION_CLASS[o.condition]),
      ),
    [obstacles, filters],
  );

  const visible = useMemo(() => {
    if (!visibleIds) return filtered;
    const ids = new Set(visibleIds);
    return filtered.filter((o) => ids.has(o.id));
  }, [filtered, visibleIds]);

  const toggleIn = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  // --- Маршрут --------------------------------------------------------------------

  const requestRoute = useCallback(async (a: LatLon, b: LatLon) => {
    const id = ++routeReq.current;
    setRouteLoading(true);
    setRouteError(null);
    try {
      const res = await buildRoute(a, b);
      if (id !== routeReq.current) return;
      setRoute(res);
      mapRef.current?.fitLine(res.geometry.coordinates);
    } catch (err) {
      if (id !== routeReq.current) return;
      const code = errorCode(err);
      setRoute(null);
      setRouteError({
        message: userMessage(err),
        retryAt: code === 'ROUTE_UNAVAILABLE' ? Date.now() + ROUTE_RETRY_DELAY_MS : null,
      });
    } finally {
      if (id === routeReq.current) setRouteLoading(false);
    }
  }, []);

  const resetRoute = () => {
    routeReq.current++;
    setStart(null);
    setEnd(null);
    setRoute(null);
    setRouteError(null);
    setRouteLoading(false);
  };

  const setRoutePoint = (p: LatLon) => {
    if (!start || (start && end)) {
      routeReq.current++;
      setStart(p);
      setEnd(null);
      setRoute(null);
      setRouteError(null);
      setRouteLoading(false);
    } else {
      setEnd(p);
      requestRoute(start, p);
    }
  };

  // Предупреждения считаются по всем загруженным точкам, независимо от фильтра
  const near = useMemo(() => {
    if (!route) return { warnings: [], disputed: [], accessible: 0 };
    const all = pointsNearLine(obstacles, route.geometry.coordinates, ROUTE_WARNING_DISTANCE_M);
    return {
      warnings: all.filter((p) => p.item.status === 'active' && CONDITION_CLASS[p.item.condition] !== 'good'),
      disputed: all.filter((p) => p.item.status === 'disputed'),
      accessible: all.filter((p) => p.item.status === 'active' && CONDITION_CLASS[p.item.condition] === 'good')
        .length,
    };
  }, [route, obstacles]);

  const highlightIds = useMemo(
    () => (route ? [...near.warnings, ...near.disputed].map((p) => p.item.id) : []),
    [route, near],
  );

  // --- Выбор точки ------------------------------------------------------------------

  const openPoint = (id: string) => {
    setSelectedId(id);
    setSelectedGone(false);
    const o = obstacles.find((x) => x.id === id);
    if (o) mapRef.current?.flyTo({ lat: o.lat, lon: o.lon });
    // Сверяем с сервером: точку могли скрыть
    fetchObstacle(id)
      .then((fresh) => setObstacles((list) => list.map((x) => (x.id === id ? fresh : x))))
      .catch((err) => {
        if (errorCode(err) === 'NOT_FOUND') {
          setSelectedGone(true);
          setObstacles((list) => list.filter((x) => x.id !== id));
        }
      });
  };

  const onReported = (id: string, res: ReportResponse) => {
    setObstacles((list) =>
      res.status === 'hidden'
        ? list.filter((x) => x.id !== id)
        : list.map((x) => (x.id === id ? { ...x, status: res.status as 'active' | 'disputed' } : x)),
    );
  };

  const onPick = (p: LatLon) => {
    if (!inBounds(PILOT_BOUNDS, p.lat, p.lon)) {
      setToast('Это место за границей пилотного района.');
      return;
    }
    if (mode === 'route') setRoutePoint(p);
    else if (mode === 'add') setAddCoord(p);
  };

  const useCenter = () => {
    const c = mapRef.current?.getCenter();
    if (c) onPick(c);
  };

  // --- Панель -----------------------------------------------------------------------

  useEffect(() => setCollapsed(false), [panelKeyFor(selectedId, mode)]);

  const selected = selectedId ? obstacles.find((o) => o.id === selectedId) ?? null : null;
  const pickMode = selectedId ? 'none' : mode === 'browse' ? 'none' : mode;

  const panelKey = panelKeyFor(selectedId, mode);
  let panel: React.ReactNode;
  if (selectedId) {
    panel = (
      <ObstacleCard
        obstacle={selected}
        unavailable={selectedGone || !selected}
        onBack={() => setSelectedId(null)}
        onReported={onReported}
      />
    );
  } else if (mode === 'route') {
    panel = (
      <RoutePanel
        start={start}
        end={end}
        loading={routeLoading}
        result={route}
        error={routeError}
        warnings={near.warnings}
        disputed={near.disputed}
        accessibleNear={near.accessible}
        onUseCenter={useCenter}
        onRetry={() => start && end && requestRoute(start, end)}
        onReset={resetRoute}
        onClose={() => {
          resetRoute();
          setMode('browse');
        }}
        onOpenPoint={openPoint}
      />
    );
  } else if (mode === 'add') {
    panel = (
      <AddForm
        coord={addCoord}
        onUseCenter={useCenter}
        onCancel={() => {
          setAddCoord(null);
          setMode('browse');
        }}
        onCreated={(o) => {
          setObstacles((list) => [o, ...list.filter((x) => x.id !== o.id)]);
          setAddCoord(null);
          setMode('browse');
          setToast('Отметка опубликована.');
          setSelectedId(o.id);
          setSelectedGone(false);
          mapRef.current?.flyTo({ lat: o.lat, lon: o.lon });
        }}
      />
    );
  } else {
    panel = (
      <BrowsePanel
        filters={filters}
        wheelchairPreset={wheelchairPreset}
        visible={visible}
        loading={loading}
        loadError={loadError}
        truncated={truncated}
        hasRoute={Boolean(route)}
        onTogglePreset={() =>
          setFilters((f) =>
            wheelchairPreset
              ? { categories: new Set(CATEGORIES), classes: new Set(ALL_CLASSES) }
              : { categories: new Set(CATEGORIES), classes: new Set<ConditionClass>(['good']) },
          )
        }
        onToggleCategory={(c: Category) => setFilters((f) => ({ ...f, categories: toggleIn(f.categories, c) }))}
        onToggleClass={(c) => setFilters((f) => ({ ...f, classes: toggleIn(f.classes, c) }))}
        onStartRoute={() => setMode('route')}
        onStartAdd={() => setMode('add')}
        onOpenPoint={openPoint}
        onReload={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  const direction = selectedId ? 'forward' : mode === 'browse' ? 'back' : 'forward';

  return (
    <div className={`app ${pickMode !== 'none' ? 'app--picking' : ''}`}>
      <main className="stage">
        <MapView
          ref={mapRef}
          points={filtered}
          highlightIds={highlightIds}
          selectedId={selectedId}
          pickMode={pickMode}
          route={route?.geometry.coordinates ?? null}
          start={mode === 'route' ? start : null}
          end={mode === 'route' ? end : null}
          addCoord={mode === 'add' ? addCoord : null}
          userPos={userPos}
          insets={insets}
          onSelect={openPoint}
          onPick={onPick}
          onVisibleChange={setVisibleIds}
          onMapError={() => setMapError(true)}
        />
        {pickMode !== 'none' && (
          <p
            key={`${mode}-${Boolean(start)}-${Boolean(end)}`}
            className="pick-hint"
            role="status"
            style={{ left: `calc(${insets.left}px + (100% - ${insets.left}px) / 2)` }}
          >
            <Icon name={mode === 'add' ? 'plus' : 'route'} size={18} />
            {mode === 'add'
              ? 'Нажмите на карту, где находится объект'
              : !start
                ? 'Нажмите на карту: откуда едете'
                : !end
                  ? 'Теперь нажмите: куда едете'
                  : 'Новое нажатие начнет маршрут заново'}
          </p>
        )}
        {mapError && (
          <p
            className="map-banner"
            role="alert"
            style={{ bottom: insets.bottom + 12, left: `calc(${insets.left}px + (100% - ${insets.left}px) / 2)` }}
          >
            <Icon name="alert" size={18} />
            Подложка карты не загрузилась. Отметки и формы работают.
          </p>
        )}
      </main>

      <aside className={`sheet ${collapsed ? 'is-collapsed' : ''}`} ref={sheetRef} aria-label="Панель">
        <button
          type="button"
          className="sheet__handle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Развернуть панель' : 'Свернуть панель'}
        >
          <span />
        </button>
        <header className="brand">
          <Logo size={38} />
          <div>
            <h1>Свободный путь</h1>
            <p className="brand__pilot">{PILOT_NAME}</p>
          </div>
        </header>
        <div className="sheet__body">
          <div key={panelKey} className={`panel-anim panel-anim--${direction}`}>
            {panel}
          </div>
        </div>
      </aside>

      {toast && (
        <div className="toast" role="status" key={toast}>
          <Icon name="check" size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
