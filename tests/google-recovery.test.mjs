import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuth2Client } from 'google-auth-library';
import { boot, call, user } from './roadmap-helpers.mjs';

async function fixture(t) {
  const mails = [];
  const s = await boot(t, { passwordResetTransport: { sendMail: async mail => mails.push(mail) } });
  const admin = await user(s, 'admin@google-recovery.test');
  s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(admin.user.id);
  assert.equal((await call(s, '/admin/google-login', { method: 'PUT', cookie: admin.cookie,
    body: { enabled: true, clientId: 'fixture.apps.googleusercontent.com', clientSecret: 'fixture', reason: 'Regression test' } })).status, 200);
  let nonce;
  t.mock.method(OAuth2Client.prototype, 'getToken', async () => ({ tokens: { id_token: 'fixture' } }));
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({ getPayload: () => ({
    sub: 'attacker-google', email: 'attacker@google.test', email_verified: true, nonce,
  }) }));
  s.start = async cookie => {
    const r = await fetch(s.base + '/api/auth/google/start', { redirect: 'manual', headers: cookie ? { cookie } : {} });
    assert.equal(r.status, 302);
    const url = new URL(r.headers.get('location'));
    nonce = url.searchParams.get('nonce');
    return { state: url.searchParams.get('state'), cookie: [cookie, r.headers.get('set-cookie').split(';')[0]].filter(Boolean).join('; ') };
  };
  s.finish = ({ state, cookie }) => fetch(s.base + '/api/auth/google/callback?code=fixture&state=' + state,
    { redirect: 'manual', headers: { cookie } });
  s.recover = async actor => {
    assert.equal((await call(s, '/auth/forgot-password', { method: 'POST', body: { email: actor.user.email } })).status, 200);
    const code = mails.at(-1).text.match(/\b\d{6}\b/)[0];
    assert.equal((await call(s, '/auth/reset-password', { method: 'POST', body: {
      email: actor.user.email, code, password: 'RecoveredPassword123!',
    } })).status, 200);
  };
  return s;
}
const sessionCookie = response => response.headers.getSetCookie().find(value => value.startsWith('nt_session='))?.split(';')[0];

test('recovery revokes attacker-linked Google identity and outstanding link states; fresh Google login still works', async t => {
  const s = await fixture(t);
  const victim = await user(s, 'victim@google-recovery.test');
  const linked = await s.finish(await s.start(victim.cookie));
  assert.equal(linked.status, 302);
  assert.equal((await call(s, '/me', { cookie: sessionCookie(linked) })).body.user.id, victim.user.id);
  const pendingLink = await s.start(victim.cookie);
  await s.recover(victim);
  assert.equal(s.db.prepare('SELECT count(*) n FROM google_identities WHERE user_id=?').get(victim.user.id).n, 0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM google_oauth_states WHERE user_id=?').get(victim.user.id).n, 0);
  assert.equal((await s.finish(pendingLink)).status, 400);
  assert.equal((await call(s, '/me', { cookie: sessionCookie(linked) })).status, 401);
  const fresh = await s.finish(await s.start());
  assert.equal(fresh.status, 302);
  const googleUser = (await call(s, '/me', { cookie: sessionCookie(fresh) })).body.user;
  assert.notEqual(googleUser.id, victim.user.id);
  assert.equal(googleUser.email, 'attacker@google.test');
  const repeat = await s.finish(await s.start());
  assert.equal(repeat.status, 302);
  assert.equal((await call(s, '/me', { cookie: sessionCookie(repeat) })).body.user.id, googleUser.id);
});

test('password recovery during Google verification prevents an in-flight link from restoring access', async t => {
  const s = await fixture(t), victim = await user(s, 'race@google-recovery.test');
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  t.mock.method(OAuth2Client.prototype, 'getToken', async () => {
    entered(); await gate; return { tokens: { id_token: 'fixture' } };
  });
  const pending = s.finish(await s.start(victim.cookie));
  try {
    await started;
    await s.recover(victim);
  } finally { release(); }
  assert.equal((await pending).status, 401);
  assert.equal(s.db.prepare('SELECT count(*) n FROM google_identities WHERE user_id=?').get(victim.user.id).n, 0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(victim.user.id).n, 0);
});
