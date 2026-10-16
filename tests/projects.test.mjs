import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase, migrateDatabase } from './database-helpers.mjs';
import { seedDemo } from '../server/seed.mjs';
import { exportSnapshot, importSnapshot, upgradeSnapshot } from '../server/database-snapshot.mjs';
import { V2_TABLE_COLUMNS } from '../server/database-tables.mjs';
import { defaultProjectId, getProjectAccess, projectAccessSql, canAccessProject, resolveTaskProject } from '../server/projects.mjs';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';

const clock = () => new Date('2026-10-16T02:00:00Z');
const at = clock().toISOString();
function workspace(db, id) {
  db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)').run(id, id, at);
  db.prepare("INSERT INTO subscriptions(workspace_id,plan,cycle,status,current_period_end,updated_at) VALUES (?,'business','monthly','active','2030-01-01',?)").run(id, at);
}
function member(db, workspaceId, id, role = 'member', type = 'member') {
  db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING').run(id, id, id+'@test.example', 'unused', at);
  db.prepare('INSERT INTO workspace_members(workspace_id,user_id,role,created_at,member_type) VALUES (?,?,?,?,?)').run(workspaceId, id, role, at, type);
}
function project(db, id, mode = 'private', team = null) {
  db.prepare('INSERT INTO projects(id,workspace_id,name,access_mode,team_id,created_by,created_at,updated_at) VALUES (?,\'w\',?,?,?,\'owner\',?,?)').run(id, id, mode, team, at, at);
}
function grant(db, id, user, role) {
  db.prepare('INSERT INTO project_members(project_id,workspace_id,user_id,role,created_at) VALUES (?,\'w\',?,?,?)').run(id, user, role, at);
}
function task(db, id, projectId, team = null) {
  db.prepare(`INSERT INTO tasks(id,workspace_id,title,description,status,priority,recurrence,created_by,created_at,updated_at,team_id,project_id) VALUES (?,'w',?,'','todo','medium','none','owner',?,?,?,?)`).run(id, id, at, at, team, projectId);
}

// TC-W1-T03-A/B/C/D: old snapshots follow the same project backfill as migration.
test('project upgrade preserves IDs, duplicate column names, child links and empty scopes', () => {
  const source = openDatabase(), target = openDatabase();
  try {
    seedDemo({ db: source, clock });
    const owner = source.prepare('SELECT * FROM workspace_members LIMIT 1').get();
    const teamId = 'empty-team';
    source.prepare("INSERT INTO teams(id,workspace_id,name,color,created_at,updated_at) VALUES (?,?,'Empty','blue',?,?)").run(teamId, owner.workspace_id, at, at);
    for (const id of ['duplicate-a','duplicate-b']) source.prepare("INSERT INTO board_columns(id,workspace_id,name,status,created_at,updated_at) VALUES (?,?,'Identical','todo',?,?)").run(id, owner.workspace_id, at, at);
    const current = exportSnapshot(source);
    const old = { ...current, schemaVersion: 2, tables: Object.fromEntries(Object.entries(V2_TABLE_COLUMNS).map(([table, columns]) => [table, {
      columns: [...columns], rows: current.tables[table].rows.map(row => columns.map(column => row[current.tables[table].columns.indexOf(column)])),
    }])) };
    importSnapshot(target, old);
    assert.deepEqual(exportSnapshot(target), upgradeSnapshot(old));
    assert.equal(target.prepare('SELECT count(*) n FROM projects').get().n,
      target.prepare('SELECT count(*) n FROM workspaces').get().n + target.prepare('SELECT count(*) n FROM teams').get().n);
    assert.equal(target.prepare('SELECT id FROM projects WHERE team_id=?').get(teamId).id, defaultProjectId(owner.workspace_id, teamId));
    assert.equal(target.prepare("SELECT count(*) n FROM board_columns WHERE name='Identical'").get().n, 2);
    for (const child of ['task_checklists', 'task_checklist_items', 'task_comments', 'task_attachments'])
      assert.deepEqual(exportSnapshot(target).tables[child], current.tables[child]);
    const id = 'legacy-new';
    target.prepare("INSERT INTO tasks(id,workspace_id,title,description,status,priority,recurrence,created_by,created_at,updated_at) VALUES (?,?,'Legacy','','todo','medium','none',?,?,?)").run(id, owner.workspace_id, owner.user_id, at, at);
    const before = target.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    target.prepare("UPDATE tasks SET title='Changed' WHERE id=?").run(id);
    assert.equal(target.prepare('SELECT project_id FROM tasks WHERE id=?').get(id).project_id, before.project_id);
    assert.equal(before.project_id, defaultProjectId(owner.workspace_id));
    migrateDatabase(target);
    assert.equal(target.prepare('SELECT project_id FROM tasks WHERE id=?').get(id).project_id, before.project_id);
  } finally { source.close(); target.close(); }
});

// TC-W1-T04-A/B/C/D, TC-W1-T05-G: read/write roles and plan state are independent.
test('project ACL covers private, inherited, guest, platform admin, downgrade and current membership', () => {
  const db = openDatabase();
  try {
    workspace(db, 'w'); workspace(db, 'other');
    for (const [id, role, type] of [['owner','owner'],['admin','admin'],['editor','member'],['commenter','member'],['viewer','member'],['manager','member'],['guest','member','guest'],['outsider','member'],['saas','member']])
      member(db, id === 'outsider' || id === 'saas' ? 'other' : 'w', id, role, type);
    db.prepare("UPDATE users SET is_platform_admin=1 WHERE id='saas'").run();
    db.prepare("INSERT INTO teams(id,workspace_id,name,color,created_at,updated_at) VALUES ('team','w','Team','blue',?,?)").run(at, at);
    db.prepare("INSERT INTO team_members(team_id,workspace_id,user_id,role,created_at) VALUES ('team','w','editor','member',?)").run(at);
    project(db, 'private');
    for (const [id, role] of [['editor','editor'],['commenter','commenter'],['viewer','viewer'],['manager','manager'],['guest','editor']]) grant(db,'private',id,role);
    task(db, 'private-task', 'private');
    task(db, 'common-task', defaultProjectId('w'));
    task(db, 'team-task', defaultProjectId('w','team'), 'team');
    const can = (id, action = 'read', projectId = 'private') => canAccessProject(db, 'w', id, projectId, { action, clock });
    for (const id of ['owner','admin','manager','editor','commenter','viewer','guest']) assert.equal(can(id), true, id);
    for (const id of ['outsider','saas']) assert.equal(can(id), false, id);
    assert.equal(can('viewer','comment'), false);
    assert.equal(can('commenter','comment'), true); assert.equal(can('commenter','ack'),true); assert.equal(can('commenter','write'),false);
    assert.equal(can('editor','write'),true); assert.equal(can('editor','delete'),true); assert.equal(can('editor','manage'),false);
    assert.equal(can('manager','manage'),true);
    assert.equal(can('guest','write'),true); assert.equal(can('guest','delete'),false); assert.equal(can('guest','move'),false); assert.equal(can('guest','manage'),false);
    assert.equal(can('guest','read',defaultProjectId('w')),false);
    assert.equal(can('editor','read',defaultProjectId('w','team')),true);
    assert.equal(can('viewer','read',defaultProjectId('w','team')),false);
    for (const userId of ['owner','editor','viewer','guest','saas']) {
      const rows = db.prepare(`SELECT t.* FROM tasks t WHERE ${projectAccessSql('t')}`).all('w', userId);
      const expected = db.prepare('SELECT * FROM tasks WHERE workspace_id=\'w\'').all().filter(t => can(userId,'read',t.project_id));
      assert.deepEqual(rows.map(r=>r.id).sort(), expected.map(r=>r.id).sort(), userId+' list/detail parity');
    }
    db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id='w'").run();
    assert.equal(can('owner','write'),false); assert.equal(can('guest','write'),false); assert.equal(can('guest'),true);
    assert.equal(getProjectAccess(db,'w','guest','private',{clock}).readonly,true);
    assert.equal(db.prepare("SELECT member_type FROM workspace_members WHERE workspace_id='w' AND user_id='guest'").get().member_type,'guest');
    assert.equal(db.prepare("SELECT access_mode FROM projects WHERE id='private'").get().access_mode,'private');
    db.prepare("DELETE FROM project_members WHERE project_id='private' AND user_id='guest'").run();
    assert.equal(can('guest'),false);
    db.prepare("DELETE FROM team_members WHERE team_id='team' AND user_id='editor'").run();
    assert.equal(can('editor','read',defaultProjectId('w','team')),false);
    assert.equal(resolveTaskProject(db,'w','viewer',{task:{project_id:'private'},action:'read',clock}).id,'private');
  } finally { db.close(); }
});

test('project constraints reject cross-tenant links, guest managers and mismatched task scopes atomically', () => {
  const db = openDatabase();
  try {
    workspace(db,'w'); workspace(db,'other'); member(db,'w','owner','owner'); member(db,'w','guest','member','guest');
    member(db,'other','outside'); project(db,'private');
    assert.throws(() => grant(db,'private','outside','viewer'), /foreign key/i);
    assert.throws(() => grant(db,'private','guest','manager'), /Guest cannot/);
    assert.throws(() => task(db,'wrong-tenant',defaultProjectId('other')), /Invalid project scope/);
    assert.throws(() => task(db,'wrong-team','private','missing'), /scope mismatch/);
    assert.equal(db.prepare('SELECT count(*) n FROM tasks').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM project_members').get().n,0);
    db.exec('BEGIN');
    task(db,'rolled-back','private');
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT count(*) n FROM tasks').get().n,0);
    // The SQL itself is replay-safe in addition to the version ledger/startup lock.
    db.exec(readFileSync(new URL('../server/migrations/postgres/003-projects.sql',import.meta.url),'utf8'));
    assert.equal(db.prepare('SELECT count(*) n FROM projects').get().n,3);
  } finally { db.close(); }
});

test('project API enforces membership management, scoped picker and archive/restore rules', async t => {
  const s = await boot(t, { clock });
  const owner = await user(s,'project-owner@example.test');
  const editor = await user(s,'project-editor@example.test');
  const guest = await user(s,'project-guest@example.test');
  const outside = await user(s,'project-outside@example.test');
  addMember(s,owner,editor); addMember(s,owner,guest);
  s.db.prepare("UPDATE subscriptions SET plan='business', current_period_end='2030-01-01' WHERE workspace_id=?").run(owner.workspace.id);
  s.db.prepare("UPDATE workspace_members SET member_type='guest' WHERE workspace_id=? AND user_id=?").run(owner.workspace.id,guest.user.id);
  const request = (actor,path,method='GET',body) => call(s,path,{cookie:actor.cookie,method,body});
  const created = await request(owner,'/projects','POST',{name:'Private canary',accessMode:'private'});
  assert.equal(created.status,201,JSON.stringify(created.body));
  const id = created.body.project.id;
  assert.equal(created.body.project.boardId,id);
  assert.equal((await request(editor,`/projects/${id}`)).status,404);
  assert.equal((await request(guest,'/projects')).body.projects.length,0);
  for (const [person,role] of [[editor,'editor'],[guest,'viewer']])
    assert.equal((await request(owner,`/projects/${id}/members/${person.user.id}`,'PUT',{role})).status,200);
  assert.equal((await request(editor,`/projects/${id}/members/${guest.user.id}`,'PUT',{role:'editor'})).status,403);
  assert.equal((await request(owner,`/projects/${id}/members/${guest.user.id}`,'PUT',{role:'manager'})).status,403);
  assert.equal((await request(owner,`/projects/${id}/members/${outside.user.id}`,'PUT',{role:'viewer'})).status,400);
  const picker = await request(guest,`/projects/${id}/members`);
  assert.equal(picker.status,200);
  assert.ok(!picker.body.members.some(row=>row.id===outside.user.id));
  assert.ok(picker.body.members.every(row=>!Object.hasOwn(row,'email')));
  assert.equal((await request(guest,`/projects/${id}`,'PATCH',{name:'No'})).status,403);
  assert.equal((await request(owner,`/projects/${id}`,'PATCH',{archived:true})).status,200);
  assert.equal((await request(editor,`/projects/${id}`)).body.project.readonly,true);
  assert.equal((await request(owner,`/projects/${id}`,'PATCH',{archived:false})).status,200);
  assert.equal((await request(editor,`/projects/${id}`)).body.project.readonly,false);
  s.db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id=?").run(owner.workspace.id);
  assert.equal((await request(owner,`/projects/${id}`,'PATCH',{name:'No'})).status,403);
  assert.equal((await request(guest,`/projects/${id}`)).status,200);
  assert.equal((await request(guest,`/projects/${id}`)).body.project.readonly,true);
});

// TC-W1-T04-C and TC-X02: a real API canary across parent and child endpoints.
test('private task API hides canary content and rejects writes after grant removal', async t => {
  const s = await boot(t, { clock });
  const owner = await user(s,'canary-owner@example.test'), reader = await user(s,'canary-reader@example.test');
  addMember(s,owner,reader);
  s.db.prepare("UPDATE subscriptions SET plan='business', current_period_end='2030-01-01' WHERE workspace_id=?").run(owner.workspace.id);
  const request = (actor,path,method='GET',body) => call(s,path,{cookie:actor.cookie,method,body});
  const created = await request(owner,'/projects','POST',{name:'Private project',accessMode:'private'});
  assert.equal(created.status,201);
  const projectId = created.body.project.id;
  const createdTask = await request(owner,'/tasks','POST',{title:'PRIVATE_CANARY_57230',projectId});
  assert.equal(createdTask.status,201,JSON.stringify(createdTask.body));
  const id = createdTask.body.task.id;
  assert.equal(createdTask.body.task.projectId,projectId);
  for (const path of [`/tasks/${id}`,`/tasks/${id}/detail`,`/tasks/${id}/extras`,`/tasks/${id}/reminders`,`/tasks/${id}/upload-policy`]) {
    const result = await request(reader,path);
    assert.equal(result.status,404,path+' '+JSON.stringify(result.body));
    assert.ok(!JSON.stringify(result.body).includes('PRIVATE_CANARY'));
  }
  for (const path of ['/tasks','/tasks?q=PRIVATE_CANARY_57230','/personal-tasks'])
    assert.ok(!JSON.stringify((await request(reader,path)).body).includes('PRIVATE_CANARY'));
  assert.equal((await request(owner,`/projects/${projectId}/members/${reader.user.id}`,'PUT',{role:'viewer'})).status,200);
  assert.equal((await request(reader,`/tasks/${id}/detail`)).status,200);
  assert.ok([403,409].includes((await request(reader,`/tasks/${id}`,'PATCH',{title:'Overwrite'})).status));
  assert.equal((await request(owner,`/projects/${projectId}/members/${reader.user.id}`,'DELETE')).status,200);
  const before = s.db.prepare('SELECT aggregate_revision FROM tasks WHERE id=?').get(id).aggregate_revision;
  assert.equal((await request(reader,`/tasks/${id}`,'PATCH',{title:'Overwrite'})).status,404);
  assert.equal(s.db.prepare('SELECT aggregate_revision FROM tasks WHERE id=?').get(id).aggregate_revision,before);
});
