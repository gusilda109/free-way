// Демо-набор точек для пилотного района.
// npm run seed            — добавить, если база пустая
// npm run seed -- --force — добавить еще раз
// npm run seed -- --reset — удалить ВСЕ точки, сигналы и фото, затем добавить демо-набор
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from './env';
import { openDb } from './db';
import { inBounds } from '../shared/config';

const SEED_SESSION = '00000000-0000-4000-8000-000000000000';

// Демо-точки в Академгородке. Координаты примерные, состояния выдуманы.
const POINTS = [
  { lat: 54.8436, lon: 83.0936, category: 'stairs', condition: 'ramp', description: 'Демо: пандус у входа в старый корпус НГУ.' },
  { lat: 54.8449, lon: 83.0914, category: 'curb', condition: 'passable', description: 'Демо: пониженный бордюр на переходе по Пирогова.' },
  { lat: 54.8446, lon: 83.0988, category: 'curb', condition: 'blocked', description: 'Демо: высокий бордюр у торгового центра на Ильича.' },
  { lat: 54.8381, lon: 83.1069, category: 'curb', condition: 'passable', description: 'Демо: съезд на переходе по Морскому проспекту.' },
  { lat: 54.8398, lon: 83.1045, category: 'stairs', condition: 'blocked', description: 'Демо: вход в магазин только по ступеням.' },
  { lat: 54.8413, lon: 83.0975, category: 'elevator', condition: 'working', description: 'Демо: лифт в здании работает.' },
  { lat: 54.8504, lon: 83.1061, category: 'elevator', condition: 'broken', description: 'Демо: лифт не реагирует на кнопку.' },
  { lat: 54.8361, lon: 83.1002, category: 'curb', condition: 'unknown', description: 'Демо: идет ремонт тротуара.' },
  { lat: 54.8425, lon: 83.1012, category: 'curb', condition: 'passable', description: '' },
] as const;

const force = process.argv.includes('--force');
const reset = process.argv.includes('--reset');
const db = openDb(join(env.dataDir, 'app.db'));
if (reset) {
  db.exec('DELETE FROM reports; DELETE FROM obstacles;');
  rmSync(join(env.dataDir, 'photos'), { recursive: true, force: true });
  console.log('Все точки, сигналы и фото удалены.');
}
const { n } = db.prepare('SELECT COUNT(*) AS n FROM obstacles').get() as { n: number };
if (n > 0 && !force && !reset) {
  console.log(`В базе уже ${n} точек — пропускаю. Для повторного добавления: npm run seed -- --force`);
  process.exit(0);
}

db.prepare('INSERT OR IGNORE INTO sessions (id, token_hash, created_at) VALUES (?, ?, ?)').run(
  SEED_SESSION,
  `seed-${randomUUID()}`,
  new Date().toISOString(),
);

const photosDir = join(env.dataDir, 'photos', SEED_SESSION);
mkdirSync(photosDir, { recursive: true });
let added = 0;
let skipped = 0;
for (const p of POINTS) {
  if (!inBounds(env.bounds, p.lat, p.lon)) {
    skipped++;
    continue;
  }
  const id = randomUUID();
  const photoPath = `${SEED_SESSION}/${id}.jpg`;
  copyFileSync(join(import.meta.dirname, 'seed-assets', `${p.category}.jpg`), join(env.dataDir, 'photos', photoPath));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO obstacles (id, created_by, lat, lon, category, condition, description, photo_path, observed_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(id, SEED_SESSION, p.lat, p.lon, p.category, p.condition, p.description, photoPath, now, now);
  added++;
}
console.log(`Добавлено демо-точек: ${added}. Замените их проверенными данными перед пилотом.`);
if (skipped) {
  console.log(`Пропущено ${skipped}: они вне границ VITE_PILOT_BOUNDS из .env. Проверьте границы Академгородка.`);
}
