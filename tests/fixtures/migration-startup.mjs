import { openDatabase, migrateDatabase } from '../../server/db.mjs';

const [schema, applicationName] = process.argv.slice(2);
const url = new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set('application_name', applicationName);
const db = openDatabase(url.toString(), { schema, migrate: false });
const applied = [], prepare = db.prepare;
db.prepare = sql => {
  const statement = prepare(sql);
  if (sql.startsWith('INSERT INTO schema_migrations')) return { ...statement, run(...values) {
    const result = statement.run(...values);
    applied.push(values[0]);
    return result;
  } };
  return statement;
};
process.on('message', message => {
  if (message === 'close') { db.close(); process.exit(0); }
  if (message === 'start') {
    migrateDatabase(db, { bootstrapAdmin: false });
    process.send({ type: 'done', applied });
  }
});
process.send({ type: 'ready', pid: process.pid, backendPid: db.prepare('SELECT pg_backend_pid() pid').get().pid });
