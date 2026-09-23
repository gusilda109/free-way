import { parseBounds } from '../../shared/config';

export const PILOT_BOUNDS = parseBounds(import.meta.env.VITE_PILOT_BOUNDS);
export const PILOT_NAME: string = import.meta.env.VITE_PILOT_NAME || 'Академгородок, Новосибирск';
export const TILE_URL: string = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION: string =
  import.meta.env.VITE_TILE_ATTRIBUTION ||
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">участники OpenStreetMap</a>';
export const GLYPHS_URL: string =
  import.meta.env.VITE_GLYPHS_URL || 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
