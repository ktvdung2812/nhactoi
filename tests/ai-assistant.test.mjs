import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from './database-helpers.mjs';
import { openDatabase, SCHEMA_VERSION } from './database-helpers.mjs';
import { createAiModelCatalog } from "../server/ai-models.mjs";

const answer = content => Response.json({ choices: [{ message: { role: "assistant", content } }] });
const calls = (...items) => Response.json({ choices: [{ message: { role: "assistant", content: null, tool_calls: items.map(([name, args], i) => ({ id: `tool_${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) } }] });
async function boot(t, aiFetch = async () => answer("Xin chào"), env = {}) {
  const app = createApp({ dbPath: ":memory:", aiFetch, env: { NODE_ENV: "test", AI_ENABLED: "true", AI_PROVIDER: "openrouter", AI_MODEL: "test-model", AI_API_KEY: "test-secret", ...env } });
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); });
  return { app, db: app.locals.db, client: () => client(`http://127.0.0.1:${server.address().port}`) };
}
function client(base) {
  let cookie = "";
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { "Content-Type": "application/json", cookie }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const nextCookie = response.headers.get("set-cookie");
    if (nextCookie) cookie = nextCookie.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
}
async function register(api, email = "ai@example.test") {
  const r = await api("/auth/register", { name: "Người dùng", email, password: "Assistant2026!", workspaceName: "Không gian AI" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test("AI settings require platform admin, encrypt keys, redact audit, and respect disabled configuration", async t => {
  let requests = 0;
  const s = await boot(t, async () => { requests++; return answer("hi"); }, { AI_ENABLED: "false" });
  const api = s.client();
  assert.equal((await api("/ai/config")).status, 401);
  const user = await register(api);
  assert.equal((await api("/admin/ai-settings")).status, 403);
  assert.equal((await api("/ai/chat", { message: "Chào" })).status, 503);
  assert.equal(requests, 0);
  s.db.prepare("UPDATE users SET is_platform_admin=1 WHERE id=?").run(user.user.id);
  const config = { enabled: true, provider: "openrouter", model: "test-model", apiKey: "secret-new", reason: "Bật AI kiểm thử" };
  const saved = await api("/admin/ai-settings", config, "PUT");
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.hasApiKey, true);
  assert.ok(!JSON.stringify(saved.body).includes("secret-new"));
  const row = s.db.prepare("SELECT value,encrypted FROM app_settings WHERE key='aiAssistant'").get();
  assert.equal(row.encrypted, 1);
  assert.ok(!row.value.includes("secret-new"));
  assert.ok(!JSON.stringify(s.db.prepare("SELECT * FROM admin_audit_logs WHERE action='ai.configure'").all()).includes("secret-new"));
  assert.equal((await api("/admin/ai-settings", { ...config, apiKey: "", provider: "anthropic" }, "PUT")).status, 400);
  assert.equal((await api("/admin/ai-settings", { ...config, apiKey: "" }, "PUT")).body.hasApiKey, true);
  assert.equal((await api("/admin/ai-settings", { ...config, enabled: false, apiKey: "", clearApiKey: true }, "PUT")).body.hasApiKey, false);
  assert.equal((await api("/ai/config")).body.ready, false);
});

test("chat uses authorized tools, persists private history, and returns drafts without creating tasks", async t => {
  let phase = 0;
  const sent = [];
  const s = await boot(t, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(options.body); sent.push(body);
    if (phase++ === 0) return calls(["search_tasks", { q: "Công việc" }], ["draft_task", { title: "Việc mới", dueAt: "2026-10-01T17:00:00+07:00", priority: "high" }]);
    return answer("Đây là công việc bạn có thể xem và bản nháp chưa được lưu.");
  });
  const owner = s.client(), member = s.client(), outside = s.client();
  const a = await register(owner), b = await register(member, "member-ai@example.test");
  await register(outside, "outside-ai@example.test");
  s.db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,'member',?)").run(a.workspace.id, b.user.id, new Date().toISOString());
  await member("/workspaces/switch", { workspaceId: a.workspace.id });
  const team = await owner("/teams", { name: "Bí mật", color: "blue", members: [{ userId: a.user.id, role: "lead" }] });
  assert.equal(team.status, 201, JSON.stringify(team.body));
  const shared = await owner("/tasks", { title: "Công việc chung", dueAt: "2026-10-01T10:00:00.000Z" });
  const hidden = await owner("/tasks", { title: "Công việc tuyệt mật", teamId: team.body.team.id, dueAt: "2026-10-01T10:00:00.000Z" });
  assert.equal(shared.status, 201); assert.equal(hidden.status, 201);
  const count = s.db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n;
  const reply = await member("/ai/chat", { message: "Tìm công việc và soạn bản nháp" });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(reply.body.messages.length, 2);
  assert.equal(reply.body.messages[1].drafts[0].dueAt, "2026-10-01T10:00:00.000Z");
  assert.deepEqual(reply.body.messages[1].references.map(r => r.id), [shared.body.task.id]);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n, count);
  assert.ok(!JSON.stringify(sent).includes("Công việc tuyệt mật"));
  const id = reply.body.conversationId;
  assert.equal((await owner(`/ai/conversations/${id}`)).status, 404);
  assert.equal((await outside(`/ai/conversations/${id}`)).status, 404);
  assert.equal((await outside(`/ai/conversations/${id}`, undefined, "DELETE")).status, 404);
  assert.equal((await owner("/ai/chat", { conversationId: id, message: "Đọc" })).status, 404);
  assert.equal((await member("/ai/conversations")).body.conversations.length, 1);
  const next = await member("/ai/chat", { conversationId: id, message: "Cảm ơn" });
  assert.equal(next.body.messages.length, 4);
  assert.equal(sent.at(-1).messages[1].content, "Tìm công việc và soạn bản nháp");
  assert.equal((await member(`/ai/conversations/${id}`, undefined, "DELETE")).status, 200);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ai_messages").get().n, 0);
});

test("provider errors and invalid inputs never save partial messages or leak provider secrets", async t => {
  let mode = "error", requests = 0;
  const s = await boot(t, async () => { requests++; return mode === "error" ? Response.json({ error: "secret-provider-diagnostics" }, { status: 401 }) : answer("Đã trả lời"); });
  const api = s.client(); await register(api);
  for (const body of [{ message: " " }, { message: "x".repeat(6001) }, { message: "xin chào", history: [] }]) assert.equal((await api("/ai/chat", body)).status, 400);
  assert.equal(requests, 0);
  const failed = await api("/ai/chat", { message: "Chào" });
  assert.equal(failed.status, 502);
  assert.ok(!JSON.stringify(failed.body).includes("secret-provider"));
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ai_conversations").get().n, 0);
  mode = "success";
  const success = await api("/ai/chat", { message: "Thử lại" });
  assert.equal(success.status, 200);
  mode = "error";
  assert.equal((await api("/ai/chat", { conversationId: success.body.conversationId, message: "Lỗi lần nữa" })).status, 502);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ai_messages").get().n, 2);
  s.db.prepare("UPDATE subscriptions SET status='expired'").run();
  assert.equal((await api("/ai/chat", { message: "Không được gọi AI" })).status, 402);
});

test("concurrent requests and changed workspace cannot save a late AI response", async t => {
  let release, arrived;
  const pending = new Promise(resolve => { arrived = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const s = await boot(t, async () => { arrived(); await gate; return answer("Phản hồi muộn"); });
  const api = s.client();
  const first = await register(api);
  const other = s.client(); const second = await register(other, "switch-ai@example.test");
  s.db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,'member',?)").run(second.workspace.id, first.user.id, new Date().toISOString());
  const request = api("/ai/chat", { message: "Một" });
  await pending;
  assert.equal((await api("/ai/chat", { message: "Hai" })).status, 409);
  assert.equal((await api("/workspaces/switch", { workspaceId: second.workspace.id })).status, 200);
  release();
  assert.equal((await request).status, 409);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ai_messages").get().n, 0);
});

test("Anthropic tool protocol and malformed/unknown tools are handled without mutations", async t => {
  let step = 0;
  const s = await boot(t, async (url, options) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(options.headers["anthropic-version"], "2023-06-01");
    const body = JSON.parse(options.body);
    assert.equal(body.tools[0].input_schema.type, "object");
    if (step++ === 0) return Response.json({ content: [
      { type: "tool_use", id: "one", name: "draft_task", input: { title: "Lỗi", dueAt: "yesterday" } },
      { type: "tool_use", id: "two", name: "delete_task", input: { id: "any" } },
      { type: "tool_use", id: "three", name: "workload_summary", input: {} },
    ] });
    const outputs = body.messages.at(-1).content;
    assert.equal(outputs[0].type, "tool_result");
    assert.ok(JSON.parse(outputs[0].content).error);
    assert.ok(JSON.parse(outputs[1].content).error);
    assert.equal(JSON.parse(outputs[2].content).todo, 0);
    return Response.json({ content: [{ type: "text", text: "Bạn muốn đặt hạn vào ngày nào?" }] });
  }, { AI_PROVIDER: "anthropic" });
  const api = s.client(); await register(api);
  const reply = await api("/ai/chat", { message: "Tạo việc" });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.deepEqual(reply.body.messages[1].drafts, []);
  assert.equal(step, 2);
});

test("[SQLite legacy] AI migration upgrades existing SQLite without losing data and survives reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-ai-"));
  const path = join(dir, "db.sqlite");
  try {
    let db = openDatabase(path);
    db.prepare("INSERT INTO users(id,name,email,password_hash,created_at) VALUES ('u','User','a@b.test','hash','2026-09-01')").run();
    db.exec("DROP TABLE ai_messages; DROP TABLE ai_conversations; DELETE FROM schema_migrations WHERE version=24;");
    db.close(); db = openDatabase(path);
    assert.equal(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v, SCHEMA_VERSION);
    assert.equal(db.prepare("SELECT name FROM users WHERE id='u'").get().name, "User");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_conversations").get().n, 0);
    db.close(); db = openDatabase(path);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=24").get().n, 1);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("revoking team membership during a tool round prevents saving; old references are redacted", async t => {
  let revoke = true, teamId, memberId;
  const s = await boot(t, async (url, options) => {
    const last = JSON.parse(options.body).messages.at(-1);
    if (last.role === "user") return calls(["search_tasks", {}]);
    if (revoke) s.db.prepare("DELETE FROM team_members WHERE team_id=? AND user_id=?").run(teamId, memberId);
    return answer("Nội dung của team riêng");
  });
  const owner = s.client(), member = s.client();
  const a = await register(owner), b = await register(member, "revoked-ai@example.test");
  memberId = b.user.id;
  s.db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,'member',?)").run(a.workspace.id, memberId, new Date().toISOString());
  await member("/workspaces/switch", { workspaceId: a.workspace.id });
  const team = await owner("/teams", { name: "Team riêng", color: "blue", members: [{ userId: a.user.id, role: "lead" }, { userId: memberId, role: "member" }] });
  assert.equal(team.status, 201);
  teamId = team.body.team.id;
  assert.equal((await owner("/tasks", { title: "Việc riêng", teamId, dueAt: "2026-10-01T10:00:00.000Z" })).status, 201);
  assert.equal((await member("/ai/chat", { message: "Tóm tắt" })).status, 409);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ai_messages").get().n, 0);
  s.db.prepare("INSERT INTO team_members(team_id,workspace_id,user_id,role,created_at) VALUES (?,?,?,'member',?)").run(teamId, a.workspace.id, memberId, new Date().toISOString());
  revoke = false;
  const reply = await member("/ai/chat", { message: "Tóm tắt lại" });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  s.db.prepare("DELETE FROM team_members WHERE team_id=? AND user_id=?").run(teamId, memberId);
  const history = await member(`/ai/conversations/${reply.body.conversationId}`);
  assert.deepEqual(history.body.messages[1].references, []);
  assert.ok(!history.body.messages[1].content.includes("Nội dung của team riêng"));
});

test("AI request quota rejects excess calls before contacting the provider", async t => {
  let count = 0;
  const s = await boot(t, async () => { count++; return answer("Xin chào"); });
  const api = s.client(); await register(api);
  let conversationId;
  for (let i = 0; i < 20; i++) {
    const r = await api("/ai/chat", { message: "Chào", ...(conversationId ? { conversationId } : {}) });
    assert.equal(r.status, 200);
    conversationId = r.body.conversationId;
  }
  assert.equal((await api("/ai/chat", { message: "Vượt giới hạn" })).status, 429);
  assert.equal(count, 20);
});

test("model catalog is admin-only, filters tool-capable models and caches public requests without credentials", async t => {
  let calls = 0;
  const s = await boot(t, async (url, options) => {
    calls++;
    assert.equal(url, "https://openrouter.ai/api/v1/models");
    assert.deepEqual(options.headers, {});
    return Response.json({ data: [
      { id: "test/z", name: "Z model", supported_parameters: ["tools"] },
      { id: "test/a", name: "A model", supported_parameters: ["tools"] },
      { id: "test/image", name: "Image only", supported_parameters: [] },
      { id: "test/a", name: "A model", supported_parameters: ["tools"] },
    ] });
  });
  const api = s.client();
  assert.equal((await api("/admin/ai-models?provider=openrouter")).status, 401);
  const user = await register(api);
  assert.equal((await api("/admin/ai-models?provider=openrouter")).status, 403);
  s.db.prepare("UPDATE users SET is_platform_admin=1 WHERE id=?").run(user.user.id);
  assert.equal((await api("/admin/ai-models?provider=unknown")).status, 400);
  const result = await api("/admin/ai-models?provider=openrouter");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.models.map(m => m.id), ["test/a", "test/z"]);
  assert.equal(result.body.source, "live");
  await api("/admin/ai-models?provider=openrouter");
  assert.equal(calls, 1);
  assert.equal((await api("/admin/ai-models?provider=anthropic")).body.source, "fallback");
  assert.equal(calls, 1, "Do not send OpenRouter's key to Anthropic");
});

test("Anthropic catalog paginates, refreshes after a key change and has a safe fallback", async () => {
  let requests = 0;
  const load = createAiModelCatalog(async (url, options) => {
    requests++;
    assert.equal(options.headers["anthropic-version"], "2023-06-01");
    if (options.headers["x-api-key"] === "expired-key") return Response.json({ error: "private diagnostic" }, { status: 401 });
    assert.equal(options.headers["x-api-key"], "valid-key");
    return url.includes("after_id=")
      ? Response.json({ data: [{ id: "claude-b", display_name: "Claude B" }], has_more: false })
      : Response.json({ data: [{ id: "claude-a", display_name: "Claude A" }], has_more: true, last_id: "claude-a" });
  });
  const [a, b] = await Promise.all([load("anthropic", "valid-key"), load("anthropic", "valid-key")]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.models.map(m => m.id), ["claude-a", "claude-b"]);
  assert.equal(requests, 2);
  const fallback = await load("anthropic", "expired-key");
  assert.equal(requests, 3);
  assert.equal(fallback.source, "fallback");
  assert.ok(fallback.models.length > 0);
  assert.ok(!JSON.stringify(fallback).includes("private diagnostic"));
});


test("private project revocation during AI response prevents commit and redacts saved references", async t => {
 let revoke=true,projectId,memberId,workspaceId;
 const s=await boot(t,async(url,options)=>{
  const last=JSON.parse(options.body).messages.at(-1);
  if(last.role==='user')return calls(['search_tasks',{}]);
  if(revoke)s.db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(projectId,memberId);
  return answer('CANARY_PRIVATE_AI');
 });
 const owner=s.client(),member=s.client();const a=await register(owner,'private-ai-owner@example.test'),b=await register(member,'private-ai-member@example.test');
 workspaceId=a.workspace.id;memberId=b.user.id;
 s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(workspaceId);
 s.db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,'member',?)").run(workspaceId,memberId,new Date().toISOString());
 await member('/workspaces/switch',{workspaceId});
 const project=await owner('/projects',{name:'Private AI',accessMode:'private'});assert.equal(project.status,201);projectId=project.body.project.id;
 await owner(`/projects/${projectId}/members/${memberId}`,{role:'editor'},'PUT');
 assert.equal((await owner('/tasks',{title:'CANARY_PRIVATE_AI',projectId})).status,201);
 assert.equal((await member('/ai/chat',{message:'Tóm tắt công việc'})).status,409);
 assert.equal(s.db.prepare('SELECT count(*) n FROM ai_messages').get().n,0);
 await owner(`/projects/${projectId}/members/${memberId}`,{role:'editor'},'PUT');revoke=false;
 const answerResult=await member('/ai/chat',{message:'Tóm tắt lại'});assert.equal(answerResult.status,200,JSON.stringify(answerResult.body));
 assert.equal(answerResult.body.messages[1].references.length,1);
 await owner(`/projects/${projectId}/members/${memberId}`,undefined,'DELETE');
 const history=await member(`/ai/conversations/${answerResult.body.conversationId}`);
 assert.ok(!JSON.stringify(history.body).includes('CANARY_PRIVATE_AI'));assert.deepEqual(history.body.messages[1].references,[]);
});
