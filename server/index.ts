import { join } from 'node:path';
import { env } from './env';
import { openDb } from './db';
import { createApp } from './app';
import { routerLabel } from './routing';

const db = openDb(join(env.dataDir, 'app.db'));
const app = createApp({
  db,
  photosDir: join(env.dataDir, 'photos'),
  bounds: env.bounds,
  router: env.router,
  storageLimitBytes: env.storageLimitBytes,
  staticDir: 'dist',
});

app.listen(env.port, () => {
  console.log(`[api] http://localhost:${env.port}  данные: ${env.dataDir}`);
  console.log(`[api] маршрутизатор: ${routerLabel(env.router)}`);
  if (env.router.engine === 'ors' && !env.router.apiKey) {
    console.log('[api] ROUTER=ors, но ORS_API_KEY не задан — маршрут будет отвечать «недоступен».');
  }
});
