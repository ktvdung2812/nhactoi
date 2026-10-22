import pg from 'pg';
import { runAsWorker } from 'synckit';

// ponytail: preserve the existing synchronous transaction boundary. Queries
// block the request thread; move callers to async pg before scaling throughput.
const clients = new Map();
const NETWORK_ERRORS = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
]);

function isConnectionError(error) {
  const code = String(error?.code || '').toUpperCase();
  return code.startsWith('08') || NETWORK_ERRORS.has(code)
    || ['57P01', '57P02', '57P03'].includes(code)
    || /(?:connection|socket) (?:terminated|closed|reset|refused)|not queryable|server closed the connection|socket hang up/i.test(String(error?.message || error));
}

async function closeClient(client) {
  if (!client) return;
  try { await client.end(); } catch {}
}

function addConnectionListeners(record, client) {
  const markBroken = () => {
    if (!record.closed && record.client === client) {
      record.broken = true;
      if (record.transactionStatus !== 'I') record.transactionLost = true;
    }
  };
  // A connection can fail while idle, before the next query gets a chance to
  // observe the error. Keep the record recoverable for the next call.
  client.on('error', markBroken);
  client.on('end', markBroken);
  // Use PostgreSQL's transaction state, including failed transactions and
  // savepoints, rather than trying to parse arbitrary SQL batches.
  client.connection.on('readyForQuery', message => {
    if (record.client === client) record.transactionStatus = message.status;
  });
}

async function connectClient(record) {
  const client = new pg.Client({ connectionString: record.connectionString,
    connectionTimeoutMillis: 10000, statement_timeout: 30000,
    idle_in_transaction_session_timeout: 60000, application_name: 'nhactoi' });
  addConnectionListeners(record, client);
  try {
    await client.connect();
    await client.query("SELECT set_config('search_path', $1, false)", [record.schema]);
    if (record.closed) throw new Error('Database is closed');
    record.client = client;
    record.broken = false;
    return client;
  } catch (error) {
    await closeClient(client);
    throw error;
  }
}

async function ensureClient(record) {
  if (record.closed) throw new Error('Database is closed');
  const current = record.client;
  if (current && !record.broken && !current._ended && !current._ending && current._queryable !== false)
    return current;
  if (record.connecting) return record.connecting;
  record.connecting = (async () => {
    record.client = null;
    record.broken = true;
    await closeClient(current);
    return connectClient(record);
  })().finally(() => { record.connecting = null; });
  return record.connecting;
}

pg.types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds JavaScript safe range');
  return number;
});

runAsWorker(async (action, id, input) => {
  if (action === 'connect') {
    const record = {
      connectionString: input.connectionString,
      schema: input.schema,
      client: null,
      connecting: null,
      broken: false,
      closed: false,
      transactionStatus: 'I',
      transactionLost: false,
    };
    clients.set(id, record);
    try { await ensureClient(record); }
    catch (error) { clients.delete(id); throw error; }
    return;
  }
  const record = clients.get(id);
  if (!record) throw new Error('Database is closed');
  if (action === 'close') {
    record.closed = true;
    clients.delete(id);
    await record.connecting?.catch(() => {});
    await closeClient(record.client);
    record.client = null;
    return;
  }
  if (record.transactionStatus !== 'I' && (record.broken || record.client?._queryable === false
    || record.client?._ended || record.client?._ending)) record.transactionLost = true;
  if (record.transactionLost) {
    // Never resume work (or replay COMMIT) on a fresh connection. The caller
    // must abandon the failed transaction before unrelated requests recover.
    if (!/^\s*ROLLBACK(?:\s+(?:WORK|TRANSACTION))?\s*;?\s*$/i.test(input.sql))
      throw new Error('Database connection lost during transaction; ROLLBACK required');
    const failed = record.client;
    record.client = null;
    record.broken = true;
    record.transactionStatus = 'I';
    record.transactionLost = false;
    await closeClient(failed);
    return { rows: [], rowCount: 0 };
  }
  const client = await ensureClient(record);
  let result;
  try {
    result = await client.query(input.sql, input.values.length ? input.values : undefined);
  } catch (error) {
    if (isConnectionError(error)) {
      record.broken = true;
      if (record.transactionStatus !== 'I') record.transactionLost = true;
    }
    throw error;
  }
  const last = Array.isArray(result) ? result.at(-1) : result;
  return { rows: last?.rows || [], rowCount: last?.rowCount || 0 };
});
