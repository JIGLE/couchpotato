import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MIGRATIONS, Settings, isHealthy, migrate, openDatabase, schemaVersion, serverSecret } from './storage.ts';

function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'couchpotato-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a new database is migrated to the latest version', () => {
  const db = openDatabase(':memory:');
  assert.equal(schemaVersion(db), MIGRATIONS.length);
  assert.ok(isHealthy(db));
  db.close();
  assert.equal(isHealthy(db), false);
});

test('migrations run once and in order', () => {
  const steps = ['CREATE TABLE a (n INTEGER)', 'INSERT INTO a VALUES (1)', 'INSERT INTO a VALUES (2)'];
  const db = openDatabase(':memory:', steps.slice(0, 2));
  assert.equal(schemaVersion(db), 2);
  assert.equal(migrate(db, steps.slice(0, 2)), 0, 'nothing left to run');
  assert.equal(migrate(db, steps), 1, 'only the new one runs');
  const rows = db.prepare('SELECT n FROM a ORDER BY rowid').all() as { n: number }[];
  assert.deepEqual(rows.map((r) => r.n), [1, 2]);
  db.close();
});

test('a failing migration rolls back and leaves the version alone', () => {
  const db = openDatabase(':memory:', ['CREATE TABLE a (n INTEGER)']);
  const broken = ['CREATE TABLE a (n INTEGER)', 'CREATE TABLE b (n INTEGER); INSERT INTO nope VALUES (1)'];
  assert.throws(() => migrate(db, broken), /migration 2 failed/);
  assert.equal(schemaVersion(db), 1);
  const b = db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get();
  assert.equal(b, undefined, 'half-applied table was rolled back');
  db.close();
});

test('an older build refuses a newer database', () => {
  const db = openDatabase(':memory:', ['SELECT 1', 'SELECT 2']);
  assert.throws(() => migrate(db, ['SELECT 1']), /version 2/);
  db.close();
});

test('settings and the server secret survive closing and reopening the file', (t) => {
  const file = path.join(tempDir(t), 'nested', 'couchpotato.db');

  const first = openDatabase(file);
  const settings = new Settings(first, () => 1000);
  assert.equal(settings.get('greeting'), undefined);
  settings.set('greeting', 'hello');
  settings.set('greeting', 'olá');
  const secret = serverSecret(settings);
  assert.ok(secret.length >= 40);
  first.close();

  const second = openDatabase(file);
  const again = new Settings(second);
  assert.equal(again.get('greeting'), 'olá');
  assert.equal(serverSecret(again), secret, 'same secret after a restart');
  assert.equal(schemaVersion(second), MIGRATIONS.length);
  second.close();
});

test('the database uses WAL and enforces foreign keys', (t) => {
  const db = openDatabase(path.join(tempDir(t), 'couchpotato.db'));
  assert.deepEqual({ ...db.prepare('PRAGMA journal_mode').get() }, { journal_mode: 'wal' });
  assert.deepEqual({ ...db.prepare('PRAGMA foreign_keys').get() }, { foreign_keys: 1 });
  db.close();
});
