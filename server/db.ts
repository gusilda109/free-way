import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Схема повторяет модель данных ТЗ (раздел 2.3): те же таблицы, поля и ограничения.
 * При переезде на Supabase это станет SQL-миграцией Postgres почти без изменений.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS obstacles (
  id          TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL REFERENCES sessions(id),
  lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon         REAL NOT NULL CHECK (lon BETWEEN -180 AND 180),
  category    TEXT NOT NULL CHECK (category IN ('curb', 'stairs', 'elevator')),
  condition   TEXT NOT NULL CHECK (
    (category = 'curb'     AND condition IN ('passable', 'blocked', 'unknown')) OR
    (category = 'stairs'   AND condition IN ('ramp', 'blocked', 'unknown')) OR
    (category = 'elevator' AND condition IN ('working', 'broken', 'unknown'))
  ),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  photo_path  TEXT NOT NULL UNIQUE,
  observed_at TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disputed', 'hidden')),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS obstacles_status_idx ON obstacles (status);

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  obstacle_id TEXT NOT NULL REFERENCES obstacles(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES sessions(id),
  reason      TEXT NOT NULL CHECK (reason IN ('outdated', 'incorrect')),
  created_at  TEXT NOT NULL,
  UNIQUE (obstacle_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON reports (reporter_id, created_at);

CREATE TABLE IF NOT EXISTS route_requests (
  session_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS route_requests_idx ON route_requests (session_id, created_at);
`;

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(db: DB): { id: string; token: string } {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, token_hash, created_at) VALUES (?, ?, ?)').run(
    id,
    hashToken(token),
    new Date().toISOString(),
  );
  return { id, token };
}

export function findSession(db: DB, token: string): string | null {
  const row = db.prepare('SELECT id FROM sessions WHERE token_hash = ?').get(hashToken(token)) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

/** Выполнить функцию в транзакции с блокировкой на запись. */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
