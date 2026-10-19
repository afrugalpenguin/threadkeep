import path from 'node:path';
import Database from 'better-sqlite3';
import { mkdirPrivate } from '../paths.js';
import { migrations } from './migrations/index.js';

export type Db = Database.Database;

export function schemaVersion(db: Db): number {
  const row = db.prepare("select name from sqlite_master where type = 'table' and name = 'schema_version'").get();
  if (!row) return 0;
  return (db.prepare('select coalesce(max(version), 0) as v from schema_version').get() as { v: number }).v;
}

export function openDb(file: string): Db {
  mkdirPrivate(path.dirname(file));
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = on');
  db.exec('create table if not exists schema_version (version integer primary key, applied_at text)');
  const current = schemaVersion(db);
  if (current > (migrations[migrations.length - 1]?.version ?? 0)) {
    db.close();
    throw new Error(`database schema ${current} is newer than this hansard build`);
  }
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('insert into schema_version (version, applied_at) values (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      );
    })();
  }
  return db;
}
