import test from 'node:test';
import assert from 'node:assert/strict';
import {boot, call, user} from './roadmap-helpers.mjs';
import {boardTransferBody, JSON_BODY_LIMIT_BYTES} from '../shared/board-transfer.mjs';

test('malformed cookies are ignored and valid sessions still authenticate', async t => {
  const s = await boot(t);
  for (const value of ['%', '%ZZ', '%E0%A4']) {
    assert.equal((await call(s, '/me', {cookie:`nt_session=${value}`})).status, 401);
  }
  const owner = await user(s, 'cookie-qa@test.local');
  assert.equal((await call(s, '/me', {cookie:`broken=%; ${owner.cookie}`})).status, 200);
  assert.equal((await call(s, '/me', {cookie:owner.cookie})).status, 200);
});

test('JSON parser returns safe 400 and 413 responses, then accepts a valid request', async t => {
  const s = await boot(t);
  for (const [body, status] of [['{invalid', 400], [JSON.stringify({name:'x'.repeat(JSON_BODY_LIMIT_BYTES)}), 413]]) {
    const response = await fetch(s.base + '/api/auth/register', {
      method:'POST', headers:{'content-type':'application/json'}, body,
    });
    assert.equal(response.status, status);
    const payload = await response.json();
    assert.equal(typeof payload.error, 'string');
    assert.ok(!payload.error.includes('internal server error'));
    assert.ok(!payload.error.includes('{invalid'));
  }
  assert.ok((await user(s, 'parser-qa@test.local')).cookie);
});

test('unexpected server errors retain a safe HTTP 500 response', async t => {
  let failClock = false;
  const s = await boot(t, {clock:() => {
    if (failClock) throw Object.assign(new Error('private clock failure'), {status:400});
    return new Date();
  }});
  const owner = await user(s,'server-error-qa@test.local');
  failClock = true;
  const response = await call(s,'/me',{cookie:owner.cookie});
  assert.equal(response.status,500);
  assert.deepEqual(response.body,{error:'internal server error'});
  failClock = false;
  assert.equal((await call(s,'/me',{cookie:owner.cookie})).status,200);
});

const board = () => ({format:'nhactoi-board',version:1,columns:[],tasks:[]});
test('API and transfer helper accept exactly 1 MiB and reject the next byte', async t => {
  const s = await boot(t), owner = await user(s, 'transfer-limit@test.local');
  const data = {...board(),note:''};
  data.note = 'x'.repeat(JSON_BODY_LIMIT_BYTES - Buffer.byteLength(boardTransferBody(data)));
  const body = boardTransferBody(data);
  for (const [payload, status] of [[body,201],[body+' ',413]]) {
    const response = await fetch(s.base+'/api/board-transfer', {
      method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie},body:payload,
    });
    assert.equal(response.status,status);
  }
});

test('transfer size counts compact UTF-8 payload including envelope at the exact body limit', () => {
  for (const length of [899000, 901000]) {
    const data = {...board(), note:'a'.repeat(length)};
    assert.ok(boardTransferBody(JSON.parse(JSON.stringify(data,null,2))).length > length);
  }
  const data = {...board(), note:'ấ'};
  const overhead = Buffer.byteLength(boardTransferBody(data));
  data.note += 'x'.repeat(JSON_BODY_LIMIT_BYTES - overhead);
  assert.equal(Buffer.byteLength(boardTransferBody(data)), JSON_BODY_LIMIT_BYTES);
  data.note += 'x';
  assert.throws(() => boardTransferBody(data), /1 MiB/);
  assert.throws(() => boardTransferBody({...board(),tasks:Array(501).fill({})}), /500/);
  assert.throws(() => boardTransferBody({...board(),columns:Array(41).fill({})}), /40/);
  assert.throws(() => boardTransferBody(null), /phiên bản 1/);
});

test('500-task pretty export above 900 KB round-trips; oversized exports explain the same limits', async t => {
  const s = await boot(t), owner = await user(s, 'transfer-qa@test.local');
  const data = {...board(),columns:[{name:'Todo',status:'todo',tone:'blue'}],tasks:Array.from({length:500}, (_, i) => ({
    title:`Task ${i}`,description:'x'.repeat(1750),status:'todo',priority:'low',
    dueAt:'2030-01-01T10:00:00Z',recurrence:'none',category:'',column:'Todo',checklists:[],
  }))};
  assert.equal((await call(s,'/board-transfer',{method:'POST',cookie:owner.cookie,body:JSON.parse(boardTransferBody(data))})).status,201);
  const exported = await call(s,'/board-transfer',{cookie:owner.cookie});
  assert.equal(exported.status,200);
  const file = JSON.stringify(exported.body,null,2);
  assert.ok(Buffer.byteLength(file)>900000);
  const body = boardTransferBody(JSON.parse(file));
  const imported = await call(s,'/board-transfer',{method:'POST',cookie:owner.cookie,body:JSON.parse(body)});
  assert.equal(imported.status,201);
  assert.equal(imported.body.count,500);
  const tooMany = await call(s,'/board-transfer',{cookie:owner.cookie});
  assert.equal(tooMany.status,400);
  assert.match(tooMany.body.error,/500/);
});
