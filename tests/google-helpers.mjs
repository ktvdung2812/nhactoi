import assert from 'node:assert/strict';
import { OAuth2Client } from 'google-auth-library';
import { call, user } from './roadmap-helpers.mjs';

// Turns on Google sign-in and stands in for Google's token endpoints.
// `profile` is the Google account the next callback signs in as.
export async function enableGoogle(t, s, profile = { sub: 'google-subject', email: 'google@example.test' }) {
  const admin = await user(s, `google-admin-${Math.random().toString(36).slice(2)}@example.test`);
  s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(admin.user.id);
  assert.equal((await call(s, '/admin/google-login', { method: 'PUT', cookie: admin.cookie,
    body: { enabled: true, clientId: 'fixture.apps.googleusercontent.com', clientSecret: 'fixture', reason: 'Regression test' } })).status, 200);
  let nonce;
  t.mock.method(OAuth2Client.prototype, 'getToken', async () => ({ tokens: { id_token: 'fixture' } }));
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({ getPayload: () => ({
    ...google.profile, email_verified: true, nonce,
  }) }));
  const stateCookie = response => response.headers.getSetCookie().find(value => value.startsWith('nhactoi_google_state='))?.split(';')[0];
  const google = {
    profile,
    // Completes Google's redirect for an authorization URL from /start or /link.
    async finish(authUrl, cookie) {
      const url = new URL(authUrl);
      nonce = url.searchParams.get('nonce');
      return fetch(`${s.base}/api/auth/google/callback?code=fixture&state=${url.searchParams.get('state')}`,
        { redirect: 'manual', headers: cookie ? { cookie } : {} });
    },
    async start(cookie) {
      return fetch(`${s.base}/api/auth/google/start`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    },
    // Signs in from a browser without a session; returns the new session cookie.
    async signIn() {
      const started = await google.start();
      assert.equal(started.status, 302);
      const done = await google.finish(started.headers.get('location'), stateCookie(started));
      assert.equal(done.status, 302, await done.clone().text());
      return sessionCookie(done);
    },
    async link(actor, password) {
      const response = await fetch(`${s.base}/api/auth/google/link`, { method: 'POST',
        headers: { 'content-type': 'application/json', cookie: actor.cookie }, body: JSON.stringify({ password }) });
      const body = await response.json();
      return { status: response.status, body, retryAfter: response.headers.get('retry-after'),
        cookie: [actor.cookie, stateCookie(response)].filter(Boolean).join('; ') };
    },
  };
  return google;
}

export const sessionCookie = response => response.headers.getSetCookie().find(value => value.startsWith('nt_session='))?.split(';')[0];
