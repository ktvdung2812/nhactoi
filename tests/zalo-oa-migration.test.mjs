import test from 'node:test';
import assert from 'node:assert/strict';
import {boot,user,call} from './roadmap-helpers.mjs';
import {openDatabase} from './database-helpers.mjs';
import {migrateDatabase} from '../server/db.mjs';
import {exportSnapshot,importSnapshot,upgradeSnapshot} from '../server/database-snapshot.mjs';
import {V11_TABLE_COLUMNS} from '../server/database-tables.mjs';
test('W8 schema11 snapshot upgrades without altering tasks; migration repeat and encrypted OA delivery/attempt/callback round-trip',async t=>{
 const s=await boot(t);const owner=await user(s,'oa-migration@example.test');await call(s,'/tasks',{method:'POST',cookie:owner.cookie,body:{title:'Unchanged baseline'}});
 const current=exportSnapshot(s.db),old={...current,schemaVersion:11,tables:Object.fromEntries(Object.entries(V11_TABLE_COLUMNS).map(([table,columns])=>[table,{columns:[...columns],rows:current.tables[table].rows.map(row=>columns.map(c=>row[current.tables[table].columns.indexOf(c)]))}]))};
 const upgraded=upgradeSnapshot(old);assert.deepEqual(upgraded.tables.tasks.rows,old.tables.tasks.rows);assert.equal(upgraded.tables.zalo_oa_deliveries.rows.length,0);
 const at=new Date().toISOString();s.db.prepare("INSERT INTO zalo_oa_connections(id,workspace_id,oa_id,authorized_by,status,contract_json,created_at,updated_at) VALUES('c',?,'OA',?,'disconnected','{}',?,?)").run(owner.workspace.id,owner.user.id,at,at);
 s.db.prepare("INSERT INTO zalo_oa_recipients(id,connection_id,recipient_key,eligibility_json,updated_at) VALUES('r','c','uid:12345','{}',?)").run(at);
 s.db.prepare("INSERT INTO zalo_oa_deliveries(id,connection_id,workspace_id,actor_id,source_kind,source_id,cycle,recipient_id,purpose,template_id,generation,payload_json,source_json,status,attempts,created_at,updated_at) VALUES('d','c',?,?,'task','task','cycle','r','internal','template',1,'{}','{}','unknown',1,?,?)").run(owner.workspace.id,owner.user.id,at,at);
 s.db.prepare("INSERT INTO zalo_oa_attempts(id,delivery_id,attempt,status,started_at) VALUES('a','d',1,'unknown',?)").run(at);
 migrateDatabase(s.db,{bootstrapAdmin:false});const snapshot=exportSnapshot(s.db),target=openDatabase();try{importSnapshot(target,snapshot);assert.equal(target.prepare("SELECT status FROM zalo_oa_deliveries WHERE id='d'").get().status,'unknown');assert.equal(target.prepare("SELECT count(*) n FROM zalo_oa_attempts").get().n,1);assert.deepEqual(exportSnapshot(target),snapshot);}finally{target.close();}
});
