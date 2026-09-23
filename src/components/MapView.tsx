import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 держит веб-воркер в отдельном модуле: собираем его как worker-бандл Vite.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { ObstacleDTO, LatLon } from '../../shared/types';
import { CATEGORIES, CONDITION_CLASS, type ConditionClass } from '../../shared/catalog';
import { inBounds } from '../../shared/config';
import { GLYPHS_URL, PILOT_BOUNDS, TILE_ATTRIBUTION, TILE_URL } from '../lib/env';
import { drawIcon, iconName } from '../lib/icons';

export interface MapHandle {
  getCenter(): LatLon;
  flyTo(p: LatLon, zoom?: number): void;
  fitLine(coords: [number, number][]): void;
}

export type PickMode = 'none' | 'route' | 'add';

interface Props {
  points: ObstacleDTO[];
  highlightIds: string[];
  selectedId: string | null;
  pickMode: PickMode;
  route: [number, number][] | null;
  start: LatLon | null;
  end: LatLon | null;
  addCoord: LatLon | null;
  userPos: LatLon | null;
  /** Сколько карты закрывает панель: снизу на мобильном, слева на десктопе. */
  insets: { left: number; bottom: number };
  onSelect(id: string): void;
  onPick(p: LatLon): void;
  onVisibleChange(ids: string[]): void;
  onMapError(): void;
}

maplibregl.setWorkerUrl(workerUrl);

const CLASSES: ConditionClass[] = ['good', 'bad', 'unknown'];
const POINT_LAYERS = ['clusters', 'points'];
const b = PILOT_BOUNDS;
const PAD = 0.03;

function toFeatureCollection(points: ObstacleDTO[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        id: p.id,
        icon: iconName(p.category, CONDITION_CLASS[p.condition], p.status === 'disputed'),
      },
    })),
  };
}

// Внешний элемент двигает MapLibre, внутренний анимируется CSS (падение метки)
function pinElement(label: string, variant: 'start' | 'end' | 'add' | 'user'): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pin-wrap';
  wrap.setAttribute('aria-hidden', 'true');
  const el = document.createElement('div');
  el.className = `pin pin--${variant}`;
  const text = document.createElement('span');
  text.textContent = label;
  el.appendChild(text);
  wrap.appendChild(el);
  if (variant !== 'user') {
    const shadow = document.createElement('div');
    shadow.className = 'pin-shadow';
    wrap.appendChild(shadow);
  }
  return wrap;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROUTE_COLOR = '#16324F';

function routeGradient(color: string, progress: number): ExpressionSpecification {
  // step по line-progress: до progress — цвет, после — прозрачно
  return ['step', ['line-progress'], color, Math.max(0.0001, progress), 'rgba(0,0,0,0)'];
}

export const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const markers = useRef<Partial<Record<'start' | 'end' | 'add' | 'user', maplibregl.Marker>>>({});

  useImperativeHandle(ref, () => ({
    getCenter() {
      const c = mapRef.current!.getCenter();
      return { lat: c.lat, lon: c.lng };
    },
    flyTo(p, zoom) {
      mapRef.current?.flyTo({
        center: [p.lon, p.lat],
        zoom: zoom ?? Math.max(mapRef.current.getZoom(), 17),
        speed: 1.4,
        essential: false,
      });
    },
    fitLine(coords) {
      if (!coords.length || !mapRef.current) return;
      const bounds = coords.reduce(
        (acc, c) => acc.extend(c as [number, number]),
        new maplibregl.LngLatBounds(coords[0], coords[0]),
      );
      mapRef.current.fitBounds(bounds, {
        padding: { top: 90, bottom: 60, left: 60, right: 80 },
        maxZoom: 17,
        duration: reducedMotion() ? 0 : 900,
      });
    },
  }));

  // Инициализация карты — один раз
  useEffect(() => {
    let map: MLMap;
    try {
      map = createMap(containerRef.current!);
    } catch {
      // WebGL недоступен — список точек и формы продолжают работать
      propsRef.current.onMapError();
      return;
    }
    setupMap(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  function createMap(container: HTMLElement): MLMap {
    return new maplibregl.Map({
      container,
      style: {
        version: 8,
        glyphs: GLYPHS_URL,
        sources: {
          osm: { type: 'raster', tiles: [TILE_URL], tileSize: 256, maxzoom: 19, attribution: TILE_ATTRIBUTION },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      bounds: [
        [b.west, b.south],
        [b.east, b.north],
      ],
      maxBounds: [
        [b.west - PAD, b.south - PAD],
        [b.east + PAD, b.north + PAD],
      ],
      minZoom: 11,
      maxZoom: 19,
      attributionControl: { compact: false },
      dragRotate: false,
      pitchWithRotate: false,
    });
  }

  function setupMap(map: MLMap) {
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.getCanvas().setAttribute('aria-label', 'Карта. Стрелки — сдвиг, плюс и минус — масштаб.');
    mapRef.current = map;

    let reportedError = false;
    map.on('error', (e) => {
      const msg = String(e.error?.message ?? '');
      if (!reportedError && /tile|fetch|Failed|NetworkError|load/i.test(msg)) {
        reportedError = true;
        propsRef.current.onMapError();
      }
    });

    map.on('load', () => {
      const ratio = Math.min(3, Math.ceil(window.devicePixelRatio || 1));
      for (const c of CATEGORIES)
        for (const cls of CLASSES)
          for (const d of [false, true]) {
            map.addImage(iconName(c, cls, d), drawIcon(c, cls, d, ratio), { pixelRatio: ratio });
          }

      map.addSource('route', {
        type: 'geojson',
        lineMetrics: true,
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-width': 12, 'line-gradient': routeGradient('#ffffff', 1.1) },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-width': 6, 'line-gradient': routeGradient(ROUTE_COLOR, 1.1) },
      });

      map.addSource('highlights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'highlights',
        type: 'circle',
        source: 'highlights',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 23, 19],
          'circle-color': '#FFC400',
          'circle-opacity': ['case', ['get', 'selected'], 0.9, 0.55],
          'circle-stroke-color': '#16324F',
          'circle-stroke-width': ['case', ['get', 'selected'], 2.5, 0],
        },
      });

      map.addLayer(
        {
          id: 'pulse',
          type: 'circle',
          source: 'highlights',
          paint: {
            'circle-radius': 18,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#FFC400',
            'circle-stroke-width': 3,
            'circle-stroke-opacity': 0,
          },
        },
        'highlights',
      );

      map.addSource('obstacles', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 48,
        clusterMaxZoom: 16,
      });
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'obstacles',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#16324F',
          'circle-radius': ['step', ['get', 'point_count'], 19, 10, 23, 50, 29],
          'circle-stroke-width': 4,
          'circle-stroke-color': '#FFC400',
          'circle-stroke-opacity': 0.95,
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'obstacles',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 14,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: 'points',
        type: 'symbol',
        source: 'obstacles',
        filter: ['!', ['has', 'point_count']],
        layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      });

      map.on('click', 'clusters', async (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const src = map.getSource('obstacles') as GeoJSONSource;
        const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.5 });
      });
      map.on('click', 'points', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) propsRef.current.onSelect(id);
      });
      for (const layer of POINT_LAYERS) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }

      setReady(true);
    });

    // Выбор координаты нажатием на карту (если нажали не на маркер)
    map.on('click', (e) => {
      const { pickMode, onPick } = propsRef.current;
      if (pickMode === 'none') return;
      const hit = map.getLayer('points')
        ? map.queryRenderedFeatures(e.point, { layers: POINT_LAYERS })
        : [];
      if (hit.length) return;
      onPick({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    const emitVisible = () => {
      const bounds = map.getBounds();
      const ids = propsRef.current.points
        .filter((p) => bounds.contains([p.lon, p.lat]))
        .map((p) => p.id);
      propsRef.current.onVisibleChange(ids);
    };
    map.on('moveend', emitVisible);
    map.once('idle', emitVisible);
  }

  // Отступ под панель
  const insetApplied = useRef(false);
  const { left: insetLeft, bottom: insetBottom } = props.insets;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setPadding({ top: 0, left: insetLeft, right: 0, bottom: insetBottom });
    if (!insetApplied.current && (insetBottom > 0 || insetLeft > 0)) {
      insetApplied.current = true;
      map.fitBounds(
        [
          [b.west, b.south],
          [b.east, b.north],
        ],
        { animate: false },
      );
    }
  }, [insetLeft, insetBottom]);

  // Точки
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('obstacles') as GeoJSONSource).setData(toFeatureCollection(props.points));
    const bounds = map.getBounds();
    props.onVisibleChange(props.points.filter((p) => bounds.contains([p.lon, p.lat])).map((p) => p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.points]);

  // Подсветка: выбранная точка и предупреждения маршрута
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ids = new Set(props.highlightIds);
    if (props.selectedId) ids.add(props.selectedId);
    const features = props.points
      .filter((p) => ids.has(p.id))
      .map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: { selected: p.id === props.selectedId },
      }));
    (map.getSource('highlights') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [ready, props.points, props.highlightIds, props.selectedId]);

  // Линия маршрута: прорисовывается от А к Б
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('route') as GeoJSONSource).setData(
      props.route
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: props.route }, properties: {} }
        : { type: 'FeatureCollection', features: [] },
    );
    const setProgress = (p: number) => {
      map.setPaintProperty('route-line', 'line-gradient', routeGradient(ROUTE_COLOR, p));
      map.setPaintProperty('route-casing', 'line-gradient', routeGradient('#ffffff', p));
    };
    if (!props.route || reducedMotion()) {
      setProgress(1.1);
      return;
    }
    let frame = 0;
    const startTime = performance.now();
    const DURATION = 1100;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(t >= 1 ? 1.1 : eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    setProgress(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, props.route]);

  // Пульсирующее кольцо вокруг выбранной точки и предупреждений маршрута
  const hasHighlights = props.highlightIds.length > 0 || Boolean(props.selectedId);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !hasHighlights || reducedMotion()) {
      if (ready && map) map.setPaintProperty('pulse', 'circle-stroke-opacity', 0);
      return;
    }
    let frame = 0;
    const PERIOD = 1800;
    const tick = (now: number) => {
      const t = (now % PERIOD) / PERIOD;
      map.setPaintProperty('pulse', 'circle-radius', 16 + t * 20);
      map.setPaintProperty('pulse', 'circle-stroke-opacity', 0.9 * (1 - t));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, hasHighlights]);

  // Метки A, B, новая точка, пользователь
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = (key: 'start' | 'end' | 'add' | 'user', pos: LatLon | null, label: string) => {
      const existing = markers.current[key];
      if (!pos) {
        existing?.remove();
        delete markers.current[key];
        return;
      }
      if (existing) existing.setLngLat([pos.lon, pos.lat]);
      else
        markers.current[key] = new maplibregl.Marker({
          element: pinElement(label, key),
          anchor: key === 'user' ? 'center' : 'bottom',
        })
          .setLngLat([pos.lon, pos.lat])
          .addTo(map);
    };
    sync('start', props.start, 'А');
    sync('end', props.end, 'Б');
    sync('add', props.addCoord, '+');
    sync('user', props.userPos && inBounds(PILOT_BOUNDS, props.userPos.lat, props.userPos.lon) ? props.userPos : null, '');
  }, [props.start, props.end, props.addCoord, props.userPos]);

  // Прицел нужен, пока место не выбрано
  const showCrosshair =
    (props.pickMode === 'add' && !props.addCoord) || (props.pickMode === 'route' && !(props.start && props.end));

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      {showCrosshair && (
        <div
          className="crosshair"
          style={{ top: `calc((100% - ${insetBottom}px) / 2)`, left: `calc((100% + ${insetLeft}px) / 2)` }}
          aria-hidden="true"
        >
          <span />
        </div>
      )}
      {!ready && <div className="map-skeleton" aria-hidden="true" />}
    </div>
  );
});
