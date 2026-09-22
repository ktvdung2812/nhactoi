import test from 'node:test';import assert from 'node:assert/strict';
import {boot,call,user} from './roadmap-helpers.mjs';import {nextServiceDate,processServiceReminders} from '../server/services.mjs';
test('service renewals are scoped, atomic, prevent duplicate renewal and deliver one reminder',async t=>{
 const s=await boot(t),owner=await user(s,'owner-service@example.test'),other=await user(s,'other-service@example.test');
 const created=await call(s,'/services',{method:'POST',cookie:owner.cookie,body:{name:'Bảo trì',nextDate:'2026-09-22',cycle:'month',amount:100000}});assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.service.id;
 assert.equal((await call(s,'/services/'+id+'/history',{cookie:other.cookie})).status,404);
 assert.equal((await call(s,'/services/'+id,{method:'PATCH',cookie:owner.cookie,body:{nextDate:'2026-02-30'}})).status,400);
 assert.equal(nextServiceDate('2028-02-29','year',1),'2029-02-28');assert.equal(nextServiceDate('2026-01-31','month',1),'2026-02-28');
 const first=processServiceReminders({db:s.db,clock:()=>new Date('2026-09-21T12:00:00Z')});assert.equal(first,1);assert.equal(processServiceReminders({db:s.db,clock:()=>new Date('2026-09-21T12:00:00Z')}),0);
 const renewed=await call(s,'/services/'+id+'/renew',{method:'POST',cookie:owner.cookie,body:{expectedDate:'2026-09-22',amount:110000}});assert.equal(renewed.status,200);assert.equal(renewed.body.nextDate,'2026-10-22');
 assert.equal((await call(s,'/services/'+id+'/renew',{method:'POST',cookie:owner.cookie,body:{expectedDate:'2026-09-22'}})).status,409);
 assert.equal((await call(s,'/services/'+id+'/history',{cookie:owner.cookie})).body.history.length,1);
 assert.equal((await call(s,'/services/'+id+'/archive',{method:'PUT',cookie:owner.cookie,body:{archived:true}})).status,200);assert.equal((await call(s,'/services/'+id+'/renew',{method:'POST',cookie:owner.cookie,body:{expectedDate:'2026-10-22'}})).status,409);
});
