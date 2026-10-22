import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBackup, inspectBackup } from "../server/backups.mjs";
import { boot, call, user, task } from "./roadmap-helpers.mjs";

async function attachmentBackup(t) {
  const server = await boot(t);
  const owner = await user(server, `backup-regression-${Date.now()}@example.test`);
  const card = await task(server, owner, "Backup attachment");
  const uploaded = await fetch(`${server.base}/api/tasks/${card.id}/files`, {
    method: "POST",
    headers: {
      cookie: owner.cookie,
      "content-type": "application/octet-stream",
      "x-file-name": "backup-regression.txt",
    },
    body: "attachment bytes for backup regression",
  });
  assert.equal(uploaded.status, 201, await uploaded.text());
  const backup = await createBackup({
    db: server.db,
    dbPath: join(server.dir, "test.sqlite"),
    clock: () => new Date("2026-09-22T00:00:00.000Z"),
    settingsKey: server.app.locals.config._settingsKey,
  });
  return { server, backup, snapshot: join(server.dir, "snapshots", backup.id) };
}

function copySnapshot(snapshot, backupId) {
  const root = mkdtempSync(join(tmpdir(), "nhactoi-backup-regression-"));
  mkdirSync(join(root, "snapshots"), { recursive: true });
  cpSync(snapshot, join(root, "snapshots", backupId), { recursive: true });
  return root;
}

test("backup inspection rejects incomplete and inconsistent attachment manifests", async (t) => {
  const { server, backup, snapshot } = await attachmentBackup(t);
  const originalManifest = JSON.parse(readFileSync(join(snapshot, "manifest.json"), "utf8"));
  assert.equal(originalManifest.files.length, 1);
  assert.equal(originalManifest.files[0].storageType, "local");
  assert.equal(typeof originalManifest.files[0].storageRoot, "string");
  assert.equal(typeof originalManifest.files[0].storageKey, "string");

  const cases = [
    ["missing", (manifest) => { manifest.files = []; }],
    ["duplicate", (manifest) => { manifest.files = [manifest.files[0], { ...manifest.files[0] }]; }],
    ["path traversal", (manifest) => { manifest.files[0].file = "files/../database.sqlite"; }],
    ["wrong hash", (manifest) => { manifest.files[0].sha256 = "0".repeat(64); }],
    ["wrong size", (manifest) => { manifest.files[0].size += 1; }],
    ["wrong storage metadata", (manifest) => { manifest.files[0].storageKey = "other.bin"; }],
  ];
  for (const [label, edit] of cases) {
    const root = copySnapshot(snapshot, backup.id);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const manifestPath = join(root, "snapshots", backup.id, "manifest.json");
    const manifest = JSON.parse(JSON.stringify(originalManifest));
    edit(manifest);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    assert.throws(
      () => inspectBackup(join(root, "restored.sqlite"), backup.id, server.app.locals.config._settingsKey),
      /bản sao|manifest|tệp|dung lượng|hash|metadata|đường dẫn|kho/u,
      label,
    );
  }

  // A failed validation must leave an existing destination untouched and must
  // not create a restore storage directory as a side effect.
  const root = copySnapshot(snapshot, backup.id);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifestPath = join(root, "snapshots", backup.id, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.files = [];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const destinationDb = join(root, "restored.sqlite");
  writeFileSync(destinationDb, "destination sentinel");
  assert.throws(() => execFileSync(process.execPath, [
    "scripts/restore-backup.mjs",
    destinationDb,
    backup.id,
    "--offline-confirm-restore",
  ], { cwd: process.cwd(), stdio: "pipe" }));
  assert.equal(readFileSync(destinationDb, "utf8"), "destination sentinel");
  assert.deepEqual(readdirSync(root).sort(), ["restored.sqlite", "snapshots"]);
  assert.equal(existsSync(join(root, "restored-uploads")), false);
});

test("team roster removal blocks incomplete primary and secondary assignees atomically", async (t) => {
  const server = await boot(t);
  const owner = await user(server, "roster-owner-regression@example.test");
  const primary = await user(server, "roster-primary-regression@example.test");
  const secondary = await user(server, "roster-secondary-regression@example.test");

  for (const member of [primary, secondary]) {
    const invitation = await call(server, "/invitations", {
      method: "POST",
      cookie: owner.cookie,
      body: { email: member.user.email },
    });
    assert.equal(invitation.status, 201, JSON.stringify(invitation.body));
    const token = new URLSearchParams(new URL(invitation.body.inviteUrl).hash.slice(1)).get("invite");
    const accepted = await call(server, "/invitations/accept", {
      method: "POST",
      cookie: member.cookie,
      body: { token },
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  }

  const created = await call(server, "/teams", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      name: "Roster regression",
      description: "",
      color: "blue",
      members: [
        { userId: owner.user.id, role: "lead" },
        { userId: primary.user.id, role: "member" },
        { userId: secondary.user.id, role: "member" },
      ],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const teamId = created.body.team.id;
  const primaryTask = await call(server, "/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Primary assignment", teamId, assigneeId: primary.user.id, dueAt: "2030-01-01T10:00:00Z" },
  });
  assert.equal(primaryTask.status, 201, JSON.stringify(primaryTask.body));
  const secondaryTask = await call(server, "/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Secondary assignment", teamId, dueAt: "2030-01-01T11:00:00Z" },
  });
  assert.equal(secondaryTask.status, 201, JSON.stringify(secondaryTask.body));
  const extras = await call(server, `/tasks/${secondaryTask.body.task.id}/extras`, {
    method: "PUT",
    cookie: owner.cookie,
    body: { assigneeIds: [secondary.user.id], labelIds: [] },
  });
  assert.equal(extras.status, 200, JSON.stringify(extras.body));

  const roster = () => server.db.prepare(
    "SELECT user_id, role FROM team_members WHERE team_id = ? ORDER BY user_id",
  ).all(teamId);
  const before = roster();
  const primaryRemoval = await call(server, `/teams/${teamId}/members`, {
    method: "PUT",
    cookie: owner.cookie,
    body: {
      members: [
        { userId: owner.user.id, role: "lead" },
        { userId: secondary.user.id, role: "member" },
      ],
    },
  });
  assert.equal(primaryRemoval.status, 409, JSON.stringify(primaryRemoval.body));
  assert.deepEqual(roster(), before);

  const secondaryRemoval = await call(server, `/teams/${teamId}/members`, {
    method: "PUT",
    cookie: owner.cookie,
    body: {
      members: [
        { userId: owner.user.id, role: "lead" },
        { userId: primary.user.id, role: "member" },
      ],
    },
  });
  assert.equal(secondaryRemoval.status, 409, JSON.stringify(secondaryRemoval.body));
  assert.deepEqual(roster(), before);
});
