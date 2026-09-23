// Ручное удаление ошибочной точки владельцем проекта (до появления админ-панели).
// Запуск: npm run delete-point -- <id точки>
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env';
import { openDb } from './db';

const id = process.argv[2];
if (!id) {
  console.log('Использование: npm run delete-point -- <id точки>');
  process.exit(1);
}
const db = openDb(join(env.dataDir, 'app.db'));
const row = db.prepare('SELECT photo_path FROM obstacles WHERE id = ?').get(id) as { photo_path: string } | undefined;
if (!row) {
  console.log('Точка не найдена.');
  process.exit(1);
}
db.prepare('DELETE FROM obstacles WHERE id = ?').run(id);
const file = join(env.dataDir, 'photos', row.photo_path);
if (existsSync(file)) unlinkSync(file);
console.log('Точка и фото удалены.');
