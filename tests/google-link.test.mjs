import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user } from './roadmap-helpers.mjs';
import { enableGoogle } from './google-helpers.mjs';

async function setup(t) {
  let now = Date.parse('2026-10-22T01:00:00Z');
  const mails = [];
  const s = await boot(t, { clock: () => new Date(now), passwordResetTransport: { sendMail: async mail => { mails.push(mail); } } });
  const google = await enableGoogle(t, s, { sub: 'thief-google', email: 'thief@google.test' });
  return Object.assign(s, { google, mails, advance: ms => { now += ms; } });
}
const linkStates = (s, actor) => s.db.prepare('SELECT count(*) n FROM google_oauth_states WHERE user_id=?').get(actor.user.id).n;
const identities = (s, actor) => s.db.prepare('SELECT count(*) n FROM google_identities WHERE user_id=?').get(actor.user.id).n;

test('Google sign-in no longer starts from a signed-in session, so it cannot link without a password', async t => {
  const s = await setup(t);
  const actor = await user(s, 'start-signed-in@example.test');
  const started = await s.google.start(actor.cookie);
  assert.equal(started.status, 400);
  assert.match((await started.json()).error, /liên kết Google trong mục Tài khoản/);
  assert.equal(started.headers.get('set-cookie'), null);
  assert.equal(linkStates(s, actor), 0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM google_oauth_states').get().n, 0);

  const anonymous = await s.google.start();
  assert.equal(anonymous.status, 302);
  assert.equal(new URL(anonymous.headers.get('location')).origin, 'https://accounts.google.com');
  assert.equal(s.db.prepare('SELECT count(*) n FROM google_oauth_states WHERE user_id IS NULL').get().n, 1);
});

test('linking Google needs the current password, locks after five wrong guesses and links on success', async t => {
  const s = await setup(t);
  const actor = await user(s, 'link-guess@example.test');
  assert.equal((await s.google.link(actor, undefined)).status, 400);
  assert.equal((await call(s, '/auth/google/link', { method: 'POST', body: { password: 'Password123!' } })).status, 401);
  for (let attempt = 0; attempt < 5; attempt++) {
    const guess = await s.google.link(actor, `Wrong${attempt}Password!`);
    assert.equal(guess.status, 403, JSON.stringify(guess.body));
    assert.equal(guess.body.url, undefined);
  }
  const locked = await s.google.link(actor, 'Password123!');
  assert.equal(locked.status, 429, 'the right password is refused once locked');
  assert.ok(Number(locked.retryAfter) > 0 && Number(locked.retryAfter) <= 900);
  assert.equal(linkStates(s, actor), 0);
  assert.equal((await call(s, '/me', { cookie: actor.cookie })).status, 200, 'wrong passwords do not sign the user out');

  s.advance(15 * 60_000 + 1);
  const linked = await s.google.link(actor, 'Password123!');
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  const url = new URL(linked.body.url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.ok(url.searchParams.get('state'));
  assert.match(linked.cookie, /nhactoi_google_state=/);
  assert.equal(linkStates(s, actor), 1);

  const done = await s.google.finish(linked.body.url, linked.cookie);
  assert.equal(done.status, 302);
  assert.equal(identities(s, actor), 1);
  assert.equal(linkStates(s, actor), 0);
  assert.equal((await call(s, '/auth/google/config', { cookie: actor.cookie })).body.linked, true);
});

test('the right password clears earlier wrong link guesses', async t => {
  const s = await setup(t);
  const actor = await user(s, 'link-reset@example.test');
  for (let attempt = 0; attempt < 3; attempt++) assert.equal((await s.google.link(actor, 'WrongPassword!')).status, 403);
  assert.equal((await s.google.link(actor, 'Password123!')).status, 200);
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await s.google.link(actor, 'WrongPassword!')).status, 403);
  assert.equal((await s.google.link(actor, 'Password123!')).status, 429);
});

test('parallel wrong link guesses cannot outrun the per-account counter', async t => {
  const s = await setup(t);
  const actor = await user(s, 'link-race@example.test');
  const results = await Promise.all(Array.from({ length: 10 }, (_, attempt) => s.google.link(actor, `Wrong${attempt}Password!`)));
  assert.deepEqual(results.map(r => r.status).sort(), [...Array(5).fill(403), ...Array(5).fill(429)]);
  assert.equal((await s.google.link(actor, 'Password123!')).status, 429);
});

test('a stolen password session can neither link the thief\'s Google account nor change email without the password', async t => {
  const s = await setup(t);
  const victim = await user(s, 'victim-link@example.test');
  // The thief only has the victim's cookie.
  const started = await s.google.start(victim.cookie);
  assert.equal(started.status, 400);
  assert.equal((await s.google.link(victim, undefined)).status, 400);
  assert.equal((await s.google.link(victim, 'GuessedPassword1!')).status, 403);
  assert.equal(identities(s, victim), 0);

  const change = await call(s, '/me/email-change', { method: 'POST', cookie: victim.cookie, body: { email: 'thief@google.test' } });
  assert.equal(change.status, 403);
  assert.equal(change.body.code, undefined);
  assert.equal(s.mails.length, 0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM email_change_requests WHERE user_id=?').get(victim.user.id).n, 0);

  // Even if a Google identity were attached some other way, a password
  // session still needs the password.
  s.db.prepare('INSERT INTO google_identities(sub,user_id,created_at) VALUES (?,?,?)').run('thief-google', victim.user.id, new Date().toISOString());
  assert.equal((await call(s, '/me/email-change', { method: 'POST', cookie: victim.cookie, body: { email: 'thief@google.test' } })).status, 403);
});

test('sessions record how they signed in', async t => {
  const s = await setup(t);
  const actor = await user(s, 'methods@example.test');
  const methods = () => s.db.prepare('SELECT auth_method FROM sessions WHERE user_id=? ORDER BY created_at, id').all(actor.user.id).map(row => row.auth_method);
  assert.deepEqual(methods(), ['password']);
  const login = await call(s, '/auth/login', { method: 'POST', body: { email: actor.user.email, password: 'Password123!' } });
  assert.equal(login.status, 200);
  assert.deepEqual(methods(), ['password', 'password']);
  const linked = await s.google.link(actor, 'Password123!');
  s.advance(1000);
  assert.equal((await s.google.finish(linked.body.url, linked.cookie)).status, 302);
  assert.deepEqual(methods(), ['password', 'password', 'google']);
  s.advance(1000);
  await s.google.signIn();
  assert.deepEqual(methods(), ['password', 'password', 'google', 'google']);
});
