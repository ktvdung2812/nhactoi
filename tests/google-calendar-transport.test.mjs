import test from 'node:test';
import assert from 'node:assert/strict';
import {OAuth2Client} from 'google-auth-library';
import {CALENDAR_SCOPE,googleCalendarTransport} from '../server/google-calendar-transport.mjs';

test('TC-W7-T01 live OAuth adapter binds PKCE/callback/scope and rejects unverified identity or missing consent',async t=>{
 let scope=CALENDAR_SCOPE,verified=true,exchangeOptions,transportTimeout;
 t.mock.method(OAuth2Client.prototype,'getToken',async function(options){exchangeOptions=options;transportTimeout=this.transporter.defaults.timeout;return {tokens:{scope,id_token:'TEST_ID_TOKEN'}};});
 t.mock.method(OAuth2Client.prototype,'verifyIdToken',async function({audience}){assert.equal(audience,'test-client');return {getPayload:()=>({sub:'google-subject',email_verified:verified})};});
 const p=googleCalendarTransport({clientId:'test-client',clientSecret:'TEST_SECRET'},'https://app.example/calendar/callback');
 const auth=new URL(p.authUrl({state:'STATE',challenge:'CHALLENGE'}));
 assert.equal(auth.origin,'https://accounts.google.com');assert.equal(auth.searchParams.get('redirect_uri'),'https://app.example/calendar/callback');
 assert.equal(auth.searchParams.get('state'),'STATE');assert.equal(auth.searchParams.get('code_challenge'),'CHALLENGE');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
 assert.deepEqual(new Set(auth.searchParams.get('scope').split(' ')),new Set(['openid','email',CALENDAR_SCOPE]));
 assert.equal((await p.exchange('CODE','VERIFIER')).accountId,'google-subject');assert.equal(exchangeOptions.codeVerifier,'VERIFIER');assert.equal(transportTimeout,20000);
 scope='openid email';await assert.rejects(p.exchange('CODE','VERIFIER'),/scope not granted/);
 scope=CALENDAR_SCOPE;verified=false;await assert.rejects(p.exchange('CODE','VERIFIER'),/identity was not verified/);
});

test('TC-W7-T02/T03 live Calendar adapter preserves If-Match and redacts transport errors',async t=>{
 let request,error;const refreshes=[];
 t.mock.method(OAuth2Client.prototype,'request',async function(options){request=options;if(error)throw error;this.emit('tokens',{access_token:'REFRESHED_TEST_TOKEN'});return {data:{id:'event',etag:'new-etag'}};});
 const p=googleCalendarTransport({clientId:'client',clientSecret:'SECRET'},'https://app.example/callback',tokens=>refreshes.push(tokens));
 await p.patchEvent({access_token:'OLD_TEST_TOKEN'},'calendar@example.test','event/id',{summary:'Meeting'},'old-etag');
 assert.equal(request.url,'https://www.googleapis.com/calendar/v3/calendars/calendar%40example.test/events/event%2Fid');
 assert.equal(request.headers['If-Match'],'old-etag');assert.equal(request.retry,false);assert.equal(request.timeout,20000);assert.equal(refreshes.length,1);
 error={response:{status:401,data:{error:'invalid_grant',detail:'SECRET_CANARY'}},message:'SECRET_CANARY'};
 await assert.rejects(p.getEvent({},'calendar','event'),e=>e.status===401&&e.invalidGrant&&!JSON.stringify(e).includes('SECRET_CANARY')&&!e.message.includes('SECRET_CANARY'));
});
