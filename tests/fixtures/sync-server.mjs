import { createApp } from '../../server/index.mjs';
import { openDatabase } from '../../server/db.mjs';
import { readFileSync } from 'node:fs';

const [schema, dbPath, applicationName, fixtureOptionsPath] = process.argv.slice(2);
const fixtureOptions = fixtureOptionsPath ? JSON.parse(readFileSync(fixtureOptionsPath, 'utf8')) : {};
const url = new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set('application_name', applicationName);
const db = openDatabase(url.toString(), { schema, migrate: false });
const app = createApp({ db, dbPath, clock: () => new Date(fixtureOptions.clockFile ? readFileSync(fixtureOptions.clockFile, 'utf8') : '2026-09-22T04:00:00Z'), env: { NODE_ENV: 'test', FRONTEND_ORIGIN: 'http://localhost:5173', ...fixtureOptions.env } });
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.on('message', message => {
  if (message === 'close') server.close(() => { app.locals.close(); process.exit(0); });
});
