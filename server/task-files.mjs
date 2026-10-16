import { canAccessTask } from './task-access.mjs';
import { getRemoteStore } from "./remote-storage.mjs";
import {notifyTaskAudience} from "./collaboration.mjs";
import {
  constants as fsConstants,
  createReadStream,
  chmodSync,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import * as fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { createId } from "./auth.mjs";

// Next bundles server modules into .next; storage policy is rooted at the project.
const PROJECT_DIR = resolve(/* turbopackIgnore: true */ process.cwd());
const PROJECT_DATA_DIR = resolve(PROJECT_DIR, "data");
const DEFAULT_MAX_FILE_SIZE_MB = 10;
const MIN_MAX_FILE_SIZE_MB = 1;
const HARD_MAX_FILE_SIZE_MB = 50;
const MAX_FILENAME_LENGTH = 240;
const MAX_CLEANUP_BATCH = 100;
const STORAGE_SETTING_KEY = "attachmentStorage";
const DEFAULT_STORAGE_ENABLED = true;
const CLEANUP_RETRY_MAX_MS = 60 * 60 * 1000;

function isWithin(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${requirePathSeparator()}`) && !isAbsolute(rel));
}

// Keeping this tiny helper separate avoids hard-coding a platform separator in
// the path boundary check while preserving the module's ESM/no-global nature.
function requirePathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}

function defaultStoragePath(dbPath) {
  if (!dbPath || dbPath === ":memory:") return resolve(PROJECT_DATA_DIR, "uploads");
  return resolve(dirname(resolve(String(dbPath))), "uploads");
}

function canonicalStoragePath(input, HttpError) {
  let cursor = resolve(input);
  const missing = [];
  while (true) {
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new HttpError(400, "localPath cannot be inspected");
      const parent = dirname(cursor);
      if (parent === cursor) throw new HttpError(400, "localPath cannot be inspected");
      missing.push(basename(cursor));
      cursor = parent;
      continue;
    }
    if (stat.isSymbolicLink()) {
      // A configured storage directory itself must never be a symlink. System
      // aliases such as macOS /var are canonicalized only when they are an
      // ancestor of the requested directory.
      if (!missing.length) throw new HttpError(400, "localPath cannot contain symbolic links");
    }
    let real;
    try {
      real = realpathSync(cursor);
    } catch {
      throw new HttpError(400, "localPath cannot be inspected");
    }
    return resolve(real, ...missing.reverse());
  }
}

function storageConfig(db, dbPath) {
  const fallback = {
    enabled: DEFAULT_STORAGE_ENABLED,
    maxFileSizeMb: DEFAULT_MAX_FILE_SIZE_MB,
    localPath: defaultStoragePath(dbPath),
  };
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(STORAGE_SETTING_KEY);
  if (!row?.value) return fallback;
  let value;
  try {
    value = JSON.parse(row.value);
  } catch {
    return fallback;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const enabled = typeof value.enabled === "boolean" ? value.enabled : fallback.enabled;
  const parsedSize = Number(value.maxFileSizeMb);
  const maxFileSizeMb = Number.isSafeInteger(parsedSize) && parsedSize >= MIN_MAX_FILE_SIZE_MB && parsedSize <= HARD_MAX_FILE_SIZE_MB
    ? parsedSize
    : fallback.maxFileSizeMb;
  const configuredPath = typeof value.localPath === "string" && value.localPath.trim()
    ? resolve(value.localPath)
    : fallback.localPath;
  return { enabled, maxFileSizeMb, localPath: configuredPath };
}

function assertStoragePathPolicy(input, HttpError) {
  if (typeof input !== "string" || !input.trim())
    throw new HttpError(400, "localPath is required");
  if (!isAbsolute(input))
    throw new HttpError(400, "localPath must be an absolute path");
  const rawCandidate = resolve(input);
  const candidate = canonicalStoragePath(rawCandidate, HttpError);
  // A path inside the repository is safe only below data/. This prevents an
  // admin setting from turning the static/public or source tree into a file
  // store. Paths outside the project are allowed for mounted private disks.
  if (isWithin(PROJECT_DIR, candidate) && !isWithin(PROJECT_DATA_DIR, candidate))
    throw new HttpError(400, "localPath must be under the project data directory or outside the project");
  if (candidate === PROJECT_DIR)
    throw new HttpError(400, "localPath is not a private storage directory");
  return rawCandidate;
}

function assertNoSymlink(pathname, HttpError) {
  const absolute = resolve(pathname);
  const parts = absolute.split(requirePathSeparator());
  let current = parts[0] || requirePathSeparator();
  for (let index = 1; index < parts.length; index += 1) {
    current = current === requirePathSeparator()
      ? `${current}${parts[index]}`
      : join(/* turbopackIgnore: true */ current, parts[index]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new HttpError(400, "localPath cannot be inspected");
    }
    if (stat.isSymbolicLink()) throw new HttpError(400, "localPath cannot contain symbolic links");
  }
}

function validateWritableStoragePath(input, HttpError, { canonical = false } = {}) {
  const rawPath = assertStoragePathPolicy(input, HttpError);
  const path = canonicalStoragePath(rawPath, HttpError);
  try {
    // Inspect existing ancestors before mkdir so a configured symlink is
    // rejected rather than followed while creating the storage tree.
    assertNoSymlink(path, HttpError);
    let existed = false;
    try {
      const existing = lstatSync(path);
      existed = true;
      if (!existing.isDirectory()) throw new HttpError(400, "localPath must be a directory");
      if ((existing.mode & 0o077) !== 0) throw new HttpError(400, "localPath must be private");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
    mkdirSync(path, { recursive: true, mode: 0o700 });
    assertNoSymlink(path, HttpError);
    const stat = lstatSync(path);
    if (!stat.isDirectory()) throw new HttpError(400, "localPath must be a directory");
    if (!existed) chmodSync(path, 0o700);
    if ((stat.mode & 0o077) !== 0) throw new HttpError(400, "localPath must be private");
    const probe = join(path, `.write-check-${randomBytes(12).toString("hex")}`);
    const fd = openSync(probe, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    closeSync(fd);
    unlinkSync(probe);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "localPath is not writable");
  }
  return canonical ? path : rawPath;
}

function bodyObject(value, HttpError) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "request body is invalid");
  return value;
}

function assertKeys(value, allowed, HttpError) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new HttpError(400, "request body contains unsupported fields");
  }
}

function adminReason(value, HttpError) {
  if (typeof value !== "string" || !value.trim() || value.length > 500)
    throw new HttpError(400, "reason is required");
  return value.trim();
}

function taskForAccess(db, taskId, auth, canAccessTeamTask, HttpError, { write = false } = {}) {
  const task = db.prepare(
    `SELECT *
     FROM tasks
     WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).get(taskId, auth.workspaceId);
  if (!task || !canAccessTask(db, auth.workspaceId, auth.userId, task)) return null;
  if (write && !canAccessTask(db, auth.workspaceId, auth.userId, task, { write: true }))
    throw new HttpError(409, "Đội nhóm đã lưu trữ và chỉ được đọc");
  return task;
}

function assertLiveSession(db, req, clock, HttpError) {
  const session = db.prepare(
    `SELECT s.expires_at, u.disabled_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ? AND s.workspace_id = ?`,
  ).get(req.auth.sessionId, req.auth.userId, req.auth.workspaceId);
  if (!session || session.disabled_at || new Date(session.expires_at).getTime() <= new Date(clock()).getTime())
    throw new HttpError(401, "authentication required");
}

function decodeFilename(value, HttpError) {
  if (typeof value !== "string" || !value) throw new HttpError(400, "X-File-Name is required");
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "X-File-Name is invalid");
  }
  if (!decoded || decoded.length > MAX_FILENAME_LENGTH || /[\\/\u0000\r\n]/u.test(decoded) || [...decoded].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f))
    throw new HttpError(400, "X-File-Name is invalid");
  return decoded;
}

function mimeType(value) {
  const candidate = String(value || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(candidate)
    ? candidate.slice(0, 255)
    : "application/octet-stream";
}

function objectKey() {
  const value = randomBytes(32).toString("hex");
  return `files/${value.slice(0, 2)}/${value}`;
}

function safeStoragePath(row, HttpError = Error) {
  if (!row || typeof row.storage_root !== "string" || !isAbsolute(row.storage_root))
    throw new HttpError(500, "attachment storage metadata is invalid");
  if (typeof row.storage_key !== "string" || !row.storage_key || isAbsolute(row.storage_key))
    throw new HttpError(500, "attachment storage metadata is invalid");
  const keyParts = row.storage_key.split(/[\\/]+/u);
  if (keyParts.some((part) => !part || part === "." || part === ".." || part.includes("\u0000")))
    throw new HttpError(500, "attachment storage metadata is invalid");
  const root = resolve(row.storage_root);
  const target = resolve(root, ...keyParts);
  if (!isWithin(root, target) || target === root)
    throw new HttpError(500, "attachment storage metadata is invalid");
  return target;
}

function queueRowFor(db, row) {
  return db.prepare(
    `SELECT id, storage_root, storage_key, attempts, last_error, next_attempt_at
     FROM task_file_cleanup WHERE storage_root = ? AND storage_key = ?`,
  ).get(row.storage_root, row.storage_key);
}

/** Queue a file before deleting its attachment row in the same transaction. */
export function enqueueAttachmentCleanup(db, row, createdAt = new Date().toISOString()) {
  if (!row || row.kind !== "file" || !row.storage_root || !row.storage_key) return null;
  const existing = queueRowFor(db, row);
  if (existing) return existing.id;
  const id = createId("file_cleanup_");
  db.prepare(
    `INSERT INTO task_file_cleanup
       (id, storage_root, storage_key, created_at, attempts, last_error, next_attempt_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?)`,
  ).run(id, row.storage_root, row.storage_key, createdAt, createdAt);
  return id;
}

function retryAt(attempts) {
  const delay = Math.min(CLEANUP_RETRY_MAX_MS, 1000 * 2 ** Math.min(Number(attempts), 16));
  return new Date(Date.now() + delay).toISOString();
}

function tryRemoveFile(row) {
  try {
    const path = safeStoragePath(row);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      unlinkSync(path);
      return null;
    }
    if (!stat.isFile()) throw new Error("attachment storage object is not a regular file");
    unlinkSync(path);
    return null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return error;
  }
}

function markCleanupFailure(db, queue, error) {
  const attempts = Number(queue.attempts || 0) + 1;
  const message = String(error?.message || error || "file cleanup failed").slice(0, 1000);
  try {
    db.prepare(
      `UPDATE task_file_cleanup
       SET attempts = ?, last_error = ?, next_attempt_at = ?
       WHERE id = ?`,
    ).run(attempts, message, retryAt(attempts), queue.id);
  } catch (queueError) {
    // The queue is the durability boundary. Keep a loud server-side record if
    // even that write is unavailable; the caller still returns the committed
    // database mutation rather than pretending the bytes were deleted.
    console.error("[nhactoi] attachment cleanup queue update failed:", queueError);
  }
}

function removeQueueRow(db, id) {
  if (!id) return;
  try {
    db.prepare("DELETE FROM task_file_cleanup WHERE id = ?").run(id);
  } catch (error) {
    console.error("[nhactoi] attachment cleanup queue delete failed:", error);
  }
}

/** Retry due cleanup rows. Called at route registration and after mutations. */
export function drainAttachmentCleanupQueue(db, { now = new Date().toISOString(), limit = MAX_CLEANUP_BATCH } = {}) {
  const rows = db.prepare(
    `SELECT id, storage_root, storage_key, attempts, last_error, next_attempt_at
     FROM task_file_cleanup
     WHERE storage_root NOT LIKE 'remote:%' AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC, created_at ASC, id ASC
     LIMIT ?`,
  ).all(now, Math.max(1, Math.min(MAX_CLEANUP_BATCH, Number(limit) || MAX_CLEANUP_BATCH)));
  for (const row of rows) {
    const error = tryRemoveFile(row);
    if (error) markCleanupFailure(db, row, error);
    else removeQueueRow(db, row.id);
  }
  return rows.length;
}

/**
 * Remove committed attachment files. Rows should already have cleanup queue
 * entries when the owning DB delete was transactional. If a caller supplies a
 * row without one, a queue entry is created before attempting removal.
 */
export function cleanupAttachmentRows(db, rows, { now = new Date().toISOString() } = {}) {
  for (const row of rows || []) {
    if (!row || row.kind !== "file" || !row.storage_root || !row.storage_key) continue;
    let queue = queueRowFor(db, row);
    if (!queue) {
      try {
        const id = enqueueAttachmentCleanup(db, row, now);
        queue = { id, storage_root: row.storage_root, storage_key: row.storage_key, attempts: 0 };
      } catch (error) {
        console.error("[nhactoi] attachment cleanup queue insert failed:", error);
        continue;
      }
    }
    if (row.storage_root.startsWith("remote:")) continue;
    const error = tryRemoveFile(row);
    if (error) markCleanupFailure(db, queue, error);
    else removeQueueRow(db, queue.id);
  }
  drainAttachmentCleanupQueue(db, { now });
}

function attachmentJson(row) {
  const base = {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    createdByName: row.created_by_name || null,
  };
  if (row.kind === "file") {
    return {
      ...base,
      kind: "file",
      originalName: row.original_name || row.title,
      sizeBytes: Number(row.size_bytes || 0),
      mimeType: row.mime_type || "application/octet-stream",
      downloadUrl: `/api/tasks/${encodeURIComponent(row.task_id)}/attachments/${encodeURIComponent(row.id)}/download`,
    };
  }
  return { ...base, kind: "link", url: row.url };
}

function safeAsciiFilename(name) {
  const ascii = String(name || "download")
    .replace(/[đĐ]/g, "d")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\"\r\n]/g, "_")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .trim()
    .slice(0, 120);
  return ascii || "download";
}

function contentDisposition(name) {
  const safe = safeAsciiFilename(name);
  const encoded = encodeURIComponent(String(name || "download"))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

async function streamUpload(req, target, maxBytes, HttpError) {
  const fd = await fs.open(
    target,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o600,
  );
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.resume();
        throw new HttpError(413, "file is too large");
      }
      let offset = 0;
      while (offset < chunk.length) {
        const result = await fd.write(chunk, offset, chunk.length - offset);
        offset += result.bytesWritten;
      }
    }
    if (!bytes) throw new HttpError(400, "file must not be empty");
    await fd.sync();
    return bytes;
  } finally {
    await fd.close().catch(() => {});
  }
}

function currentStorageConfig(db, dbPath, HttpError) {
  const config = storageConfig(db, dbPath);
  config.localPath = assertStoragePathPolicy(config.localPath, HttpError);
  return config;
}

export function registerTaskFileRoutes(
  app,
  {
    db,
    dbPath,
    clock,
    isoNow,
    withTransaction,
    requireAuth,
    requirePlatformAdmin,
    ensureWritable,
    HttpError,
    fail,
    canAccessTeamTask,
    writeAdminAudit,
  },
) {
  // Retrying a prior committed delete is cheap and makes cleanup durable after
  // a process restart without introducing a background worker or timer.
  try {
    drainAttachmentCleanupQueue(db, { now: isoNow(clock) });
  } catch (error) {
    console.error("[nhactoi] attachment cleanup retry failed:", error);
  }

  app.get("/api/admin/storage", requirePlatformAdmin, (req, res, next) => {
    try {
      return res.json(currentStorageConfig(db, dbPath, HttpError));
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/admin/storage", requirePlatformAdmin, (req, res, next) => {
    try {
      const body = bodyObject(req.body, HttpError);
      assertKeys(body, new Set(["enabled", "maxFileSizeMb", "localPath", "reason"]), HttpError);
      const reason = adminReason(body.reason, HttpError);
      const before = currentStorageConfig(db, dbPath, HttpError);
      const enabled = body.enabled === undefined ? before.enabled : body.enabled;
      if (typeof enabled !== "boolean") throw new HttpError(400, "enabled must be true or false");
      const maxFileSizeMb = body.maxFileSizeMb === undefined ? before.maxFileSizeMb : Number(body.maxFileSizeMb);
      if (!Number.isSafeInteger(maxFileSizeMb) || maxFileSizeMb < MIN_MAX_FILE_SIZE_MB || maxFileSizeMb > HARD_MAX_FILE_SIZE_MB)
        throw new HttpError(400, "maxFileSizeMb must be an integer from 1 to 50");
      const localPath = validateWritableStoragePath(
        body.localPath === undefined ? before.localPath : body.localPath,
        HttpError,
      );
      const after = { enabled, maxFileSizeMb, localPath };
      const now = isoNow(clock);
      withTransaction(db, () => {
        db.prepare(
          `INSERT INTO app_settings(key, value, encrypted, updated_at)
           VALUES (?, ?, 0, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = 0, updated_at = excluded.updated_at`,
        ).run(STORAGE_SETTING_KEY, JSON.stringify(after), now);
        if (writeAdminAudit) {
          writeAdminAudit(db, {
            actorUserId: req.auth.userId,
            action: "storage.update",
            targetType: "settings",
            targetId: STORAGE_SETTING_KEY,
            reason,
            before,
            after,
            createdAt: now,
          });
        }
      });
      return res.json(after);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/tasks/:id/upload-policy", requireAuth, (req, res, next) => {
    try {
      const task = taskForAccess(db, req.params.id, req.auth, canAccessTeamTask, HttpError);
      if (!task) return fail(res, 404, "task was not found");
      const config = currentStorageConfig(db, dbPath, HttpError);
      return res.json({ enabled: config.enabled, maxFileSizeMb: config.maxFileSizeMb });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tasks/:id/files", requireAuth, async (req, res, next) => {
    let tempPath = null;
    let finalPath = null;
    let committed = false;
    let remoteObject = null;
    try {
      ensureWritable(req);
      assertLiveSession(db, req, clock, HttpError);
      const task = taskForAccess(db, req.params.id, req.auth, canAccessTeamTask, HttpError, { write: true });
      if (!task) return fail(res, 404, "task was not found");
      const config = currentStorageConfig(db, dbPath, HttpError);
      if (!config.enabled) throw new HttpError(503, "file uploads are disabled");
      const contentType = String(req.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "application/octet-stream") throw new HttpError(415, "content-type must be application/octet-stream");
      const maxBytes = config.maxFileSizeMb * 1024 * 1024;
      const declaredLength = req.get("content-length");
      if (declaredLength !== undefined && declaredLength !== null && declaredLength !== "") {
        const parsed = Number(declaredLength);
        if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(400, "content-length is invalid");
        if (parsed > maxBytes) {
          req.resume();
          throw new HttpError(413, "file is too large");
        }
      }
      const originalName = decodeFilename(req.get("x-file-name"), HttpError);
      const count = Number(db.prepare("SELECT COUNT(*) AS count FROM task_attachments WHERE task_id = ?").get(task.id).count);
      if (count >= 100) throw new HttpError(400, "a task can have at most 100 attachments");

      const root = validateWritableStoragePath(config.localPath, HttpError, { canonical: true });
      const object = objectKey();
      const objectTarget = resolve(root, object);
      if (!isWithin(root, objectTarget)) throw new HttpError(500, "attachment storage metadata is invalid");
      const objectDir = dirname(objectTarget);
      mkdirSync(objectDir, { recursive: true, mode: 0o700 });
      assertNoSymlink(objectDir, HttpError);
      chmodSync(objectDir, 0o700);
      tempPath = join(root, `.upload-${randomBytes(24).toString("hex")}.tmp`);
      const sizeBytes = await streamUpload(req, tempPath, maxBytes, HttpError);
      finalPath = objectTarget;
      await fs.link(tempPath, finalPath);
      await fs.unlink(tempPath);
      tempPath = null;

      const remoteStore = getRemoteStore(db);
      const remoteProfile = remoteStore?.active();
      if (remoteProfile) remoteObject = await remoteStore.put(remoteProfile, finalPath, object);
      const id = createId("attachment_");
      const now = isoNow(clock);
      const attachment = withTransaction(db, () => {
        // The request may have spent a long time streaming. Recheck the
        // workspace billing/suspension gate immediately before committing.
        ensureWritable(req);
        assertLiveSession(db, req, clock, HttpError);
        const current = taskForAccess(db, req.params.id, req.auth, canAccessTeamTask, HttpError, { write: true });
        if (!current) throw new HttpError(404, "task was not found");
        const currentCount = Number(db.prepare("SELECT COUNT(*) AS count FROM task_attachments WHERE task_id = ?").get(current.id).count);
        if (currentCount >= 100) throw new HttpError(400, "a task can have at most 100 attachments");
        const inserted = db.prepare(
          `INSERT INTO task_attachments
             (id, task_id, title, url, kind, original_name, mime_type, size_bytes, storage_root, storage_key, created_by, created_at)
           VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          current.id,
          originalName,
          `/api/tasks/${encodeURIComponent(current.id)}/attachments/${encodeURIComponent(id)}/download`,
          originalName,
          mimeType(req.get("content-type")),
          sizeBytes,
          remoteObject?.root || root,
          remoteObject?.key || object,
          req.auth.userId,
          now,
        );
        if (!inserted.changes) throw new HttpError(500, "file attachment could not be saved");
        db.prepare(
          `INSERT INTO task_activity(id, task_id, actor_user_id, action, summary, created_at)
           VALUES (?, ?, ?, 'attachment_added', ?, ?)`,
        ).run(createId("activity_"), current.id, req.auth.userId, `đã tải lên tệp “${originalName}”`, now);
        notifyTaskAudience(db,{taskId:current.id,actorUserId:req.auth.userId,summary:`đã tải lên tệp “${originalName}”`,createdAt:now});
        return db.prepare(
          `SELECT a.*, u.name AS created_by_name
           FROM task_attachments a LEFT JOIN users u ON u.id = a.created_by
           WHERE a.id = ?`,
        ).get(id);
      });
      committed = true;
      if (remoteObject) {
        cleanupAttachmentRows(db,[{kind:"file",storage_root:root,storage_key:object}],{now});
      }
      return res.status(201).json({ attachment: attachmentJson(attachment) });
    } catch (error) {
      if (remoteObject && !committed) enqueueAttachmentCleanup(db,{kind:"file",storage_root:remoteObject.root,storage_key:remoteObject.key},isoNow(clock));
      if (tempPath) {
        try { await fs.unlink(tempPath); } catch (cleanupError) { if (cleanupError?.code !== "ENOENT") console.error("[nhactoi] upload temp cleanup failed:", cleanupError); }
      }
      if (finalPath && !committed) {
        const row = { kind: "file", storage_root: dirname(finalPath), storage_key: relative(dirname(finalPath), finalPath) };
        try { cleanupAttachmentRows(db, [row], { now: isoNow(clock) }); } catch (cleanupError) { console.error("[nhactoi] upload final cleanup failed:", cleanupError); }
      }
      return next(error);
    }
  });

  app.get("/api/tasks/:id/attachments/:attachmentId/download", requireAuth, async (req, res, next) => {
    try {
      const task = taskForAccess(db, req.params.id, req.auth, canAccessTeamTask, HttpError);
      if (!task) return fail(res, 404, "attachment was not found");
      const attachment = db.prepare(
        `SELECT a.* FROM task_attachments a
         JOIN tasks t ON t.id = a.task_id AND t.workspace_id = ?
         WHERE a.id = ? AND a.task_id = ? AND a.kind = 'file' AND t.deleted_at IS NULL`,
      ).get(req.auth.workspaceId, req.params.attachmentId, task.id);
      if (!attachment) return fail(res, 404, "attachment was not found");
      if (attachment.storage_root.startsWith("remote:")) {
        const stream=await getRemoteStore(db).get(attachment.storage_root,attachment.storage_key);
        assertLiveSession(db,req,clock,HttpError);
        if(!taskForAccess(db,req.params.id,req.auth,canAccessTeamTask,HttpError)) {stream.destroy?.();return fail(res,404,"attachment was not found");}
        res.setHeader("Content-Type","application/octet-stream");res.setHeader("Content-Disposition",contentDisposition(attachment.original_name||attachment.title));res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Cache-Control","private, no-store");
        stream.on("error",error=>{if(!res.headersSent)next(error);else res.destroy(error)});stream.pipe(res);return;
      }
      const path = safeStoragePath(attachment, HttpError);
      let fd;
      try {
        fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const stat = fstatSync(fd);
        if (!stat.isFile()) throw Object.assign(new Error("attachment is not a file"), { code: "EISDIR" });
      } catch (error) {
        if (fd !== undefined) closeSync(fd);
        if (error?.code === "ENOENT" || error?.code === "EISDIR") return fail(res, 404, "attachment was not found");
        throw error;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(attachment.size_bytes));
      res.setHeader("Content-Disposition", contentDisposition(attachment.original_name || attachment.title));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      const stream = createReadStream(null, { fd, autoClose: true });
      stream.on("error", (error) => {
        if (!res.headersSent) return next(error);
        res.destroy(error);
      });
      stream.pipe(res);
      return undefined;
    } catch (error) {
      return next(error);
    }
  });
}

export { attachmentJson, contentDisposition, defaultStoragePath, storageConfig, safeStoragePath };
