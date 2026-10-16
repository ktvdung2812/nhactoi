import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { openDatabase } from './database-helpers.mjs';
import { openDatabase as connect, withTransaction } from '../server/db.mjs';

test('PostgreSQL reconnects after idle loss and restores the configured schema', async () => {
  const db = openDatabase();
  const control = connect(process.env.TEST_DATABASE_URL, { migrate: false });
  try {
    const pid = db.prepare('SELECT pg_backend_pid() pid').get().pid;
    control.prepare('SELECT pg_terminate_backend(?)').get(pid);
    await setTimeout(30);
    const recovered = db.prepare('SELECT pg_backend_pid() pid, current_schema() schema').get();
    assert.notEqual(recovered.pid, pid);
    assert.equal(recovered.schema, db.schema);
    assert.ok(db.prepare('SELECT count(*) n FROM schema_migrations').get().n > 0);
    // Ordinary SQL errors must preserve the connection and transaction rollback.
    assert.throws(() => withTransaction(db, () => db.exec('SELECT missing_column')), /missing_column/);
    assert.equal(db.prepare('SELECT pg_backend_pid() pid').get().pid, recovered.pid);
  } finally { db.close(); control.close(); }
});

test('PostgreSQL aborts lost transactions even when callers catch a query error', () => {
  const db = openDatabase();
  const control = connect(process.env.TEST_DATABASE_URL, { migrate: false });
  try {
    db.exec('CREATE TABLE recovery_probe (id integer PRIMARY KEY)');
    for (const swallow of [false, true]) {
      const pid = db.prepare('SELECT pg_backend_pid() pid').get().pid;
      assert.throws(() => withTransaction(db, () => {
        db.exec('INSERT INTO recovery_probe VALUES (1)');
        control.prepare('SELECT pg_terminate_backend(?)').get(pid);
        if (swallow) {
          assert.throws(() => db.exec('SELECT 1'), /connection|terminated|queryable/i);
          assert.throws(() => db.exec('INSERT INTO recovery_probe VALUES (2)'), /transaction.*ROLLBACK/i);
        }
        // COMMIT itself must fail if the connection died while otherwise idle.
      }), /connection|terminated|queryable/i);
      assert.equal(db.prepare('SELECT count(*) n FROM recovery_probe').get().n, 0);
      assert.notEqual(db.prepare('SELECT pg_backend_pid() pid').get().pid, pid);
    }
    withTransaction(db, () => db.exec('INSERT INTO recovery_probe VALUES (3)'));
    assert.deepEqual(db.prepare('SELECT id FROM recovery_probe').all(), [{ id: 3 }]);
  } finally { db.close(); control.close(); }
});

test('PostgreSQL never replays a statement whose connection fails during execution', async () => {
  const db = openDatabase();
  try {
    db.exec('CREATE SEQUENCE recovery_attempts');
    // Sequence increments survive rollback, making a hidden replay observable.
    assert.throws(() => db.exec(`DO $$ BEGIN
      PERFORM nextval('recovery_attempts');
      PERFORM pg_terminate_backend(pg_backend_pid());
    END $$`), /terminat|connection/i);
    await setTimeout(30);
    assert.equal(db.prepare('SELECT last_value FROM recovery_attempts').get().last_value, 1);
  } finally { db.close(); }
});
