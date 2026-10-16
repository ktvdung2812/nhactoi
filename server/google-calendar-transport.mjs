import { OAuth2Client } from 'google-auth-library';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const api = 'https://www.googleapis.com/calendar/v3';
const segment = encodeURIComponent;

// The same interface is injected by tests. Production always uses Google's HTTPS endpoints.
export function googleCalendarTransport(settings, callback, saveTokens) {
  const client = tokens => {
    const oauth = new OAuth2Client({clientId:settings.clientId,clientSecret:settings.clientSecret,redirectUri:callback,transporterOptions:{timeout:20000,retry:false}});
    if (tokens) oauth.setCredentials(tokens);
    oauth.on('tokens', refresh => saveTokens?.(refresh));
    return oauth;
  };
  const request = async (tokens, path, method='GET', body, headers) => {
    try { return (await client(tokens).request({ url: api + path, method, data: body, headers, timeout: 20000, retry: false })).data; }
    catch (error) {
      const safe = new Error('Google Calendar request failed');
      safe.status = Number(error.response?.status || error.code) || 0;
      safe.invalidGrant = error.response?.data?.error === 'invalid_grant';
      throw safe;
    }
  };
  return {
    authUrl: ({state, challenge}) => client().generateAuthUrl({ scope: ['openid', 'email', CALENDAR_SCOPE], access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' }),
    async exchange(code, verifier) {
      const oauth = client();
      const { tokens } = await oauth.getToken({ code, codeVerifier: verifier, redirect_uri: callback });
      if (!String(tokens.scope || '').split(' ').includes(CALENDAR_SCOPE) || !tokens.id_token) throw new Error('Calendar scope not granted');
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: settings.clientId });
      const identity = ticket.getPayload();
      if (!identity?.sub || !identity.email_verified) throw new Error('Google identity was not verified');
      return { tokens, accountId: identity.sub };
    },
    createCalendar: tokens => request(tokens, '/calendars', 'POST', { summary: 'Nhắc Tôi', timeZone: 'Asia/Ho_Chi_Minh' }),
    getEvent: (tokens, calendar, id) => request(tokens, `/calendars/${segment(calendar)}/events/${segment(id)}`),
    createEvent: (tokens, calendar, event) => request(tokens, `/calendars/${segment(calendar)}/events`, 'POST', event),
    patchEvent: (tokens, calendar, id, event, etag) => request(tokens, `/calendars/${segment(calendar)}/events/${segment(id)}`, 'PATCH', event, { 'If-Match': etag }),
    deleteEvent: (tokens, calendar, id, etag) => request(tokens, `/calendars/${segment(calendar)}/events/${segment(id)}`, 'DELETE', undefined, etag ? {'If-Match':etag} : undefined),
    listEvents: (tokens, calendar, { syncToken, pageToken }) => {
      const params = new URLSearchParams({ maxResults: '250', showDeleted: 'true', singleEvents: 'false', ...(syncToken ? {syncToken} : {}), ...(pageToken ? {pageToken} : {}) });
      return request(tokens, `/calendars/${segment(calendar)}/events?${params}`);
    },
    watch: (tokens, calendar, channel) => request(tokens, `/calendars/${segment(calendar)}/events/watch`, 'POST', channel),
    stopWatch: (tokens, channel) => request(tokens, '/channels/stop', 'POST', channel),
    revoke: tokens => client(tokens).revokeCredentials(),
  };
}
