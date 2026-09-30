import pg from 'pg';
import { runAsWorker } from 'synckit';

// ponytail: preserve the existing synchronous transaction boundary. Queries
// block the request thread; move callers to async pg before scaling throughput.
const clients = new Map();
pg.types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds JavaScript safe range');
  return number;
});

runAsWorker(async (action, id, input) => {
  if (action === 'connect') {
    const client = new pg.Client({ connectionString: input.connectionString,
      connectionTimeoutMillis: 10000, statement_timeout: 30000,
      idle_in_transaction_session_timeout: 60000, application_name: 'nhactoi' });
    // A dropped idle connection must fail its next query, not crash the worker.
    client.on('error', () => {});
    try {
      await client.connect();
      await client.query("SELECT set_config('search_path', $1, false)", [input.schema]);
      clients.set(id, client);
    } catch (error) { await client.end(); throw error; }
    return;
  }
  const client = clients.get(id);
  if (!client) throw new Error('Database is closed');
  if (action === 'close') { clients.delete(id); await client.end(); return; }
  const result = await client.query(input.sql, input.values.length ? input.values : undefined);
  const last = Array.isArray(result) ? result.at(-1) : result;
  return { rows: last?.rows || [], rowCount: last?.rowCount || 0 };
});
