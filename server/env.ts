import { resolve } from 'node:path';
import { parseBounds } from '../shared/config';
import type { RouterConfig } from './routing';

try {
  process.loadEnvFile(resolve('.env'));
} catch {
  // .env не обязателен
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: resolve(process.env.DATA_DIR ?? 'data'),
  bounds: parseBounds(process.env.VITE_PILOT_BOUNDS),
  router: (process.env.ROUTER?.trim().toLowerCase() === 'ors'
    ? {
        engine: 'ors',
        apiKey: process.env.ORS_API_KEY?.trim() || undefined,
        baseUrl: process.env.ORS_BASE_URL?.trim() || 'https://api.heigit.org/openrouteservice',
      }
    : {
        engine: 'valhalla',
        baseUrl: process.env.VALHALLA_URL?.trim() || 'https://valhalla1.openstreetmap.de',
      }) as RouterConfig,
  storageLimitBytes: Number(process.env.STORAGE_LIMIT_MB ?? 1024) * 1024 * 1024,
};
