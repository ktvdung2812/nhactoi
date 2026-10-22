import { registerZaloOa } from './zalo-oa.mjs';
import { registerPublicApi, publicApiErrorEnvelope } from './public-api.mjs';
import { registerWebhooks } from './webhooks.mjs';
import { registerGoogleCalendar } from './google-calendar.mjs';
import { canAccessTask, taskAccessSql, guestNotificationAccessSql } from './task-access.mjs';
import { registerProjectRoutes, resolveTaskProject, defaultProjectId } from './projects.mjs';
import { registerProjectAdvancedRoutes } from './project-advanced.mjs';
import { registerImportRoutes } from './imports.mjs';
import { subscriptionJson } from './subscription-json.mjs';
import { invalidateSessions } from './restore-safety.mjs';
import { planningDay } from '../shared/personal-planning.mjs';
import { ENTITLEMENT_CODES, planEntitlements, currentPlans, hasWorkspaceEntitlement } from './entitlements.mjs';
import { lockWorkspaceSeats, lockPlanSeatChanges, workspaceSeatCount } from './workspace-seats.mjs';
import { webPushConfig, registerWebPushRoutes, processWebPush } from "./web-push.mjs";
import { RECURRENCES as RECURRENCE_VALUES, nextTaskOccurrence } from "../shared/task-recurrence.mjs";
import { validateRecurrenceOptions, storedRecurrenceOptions } from "./recurrence.mjs";
import { registerReminderRoutes, processWorkflowReminders, legacyReminderAllowed, processReminderEmails } from "./reminder-workflow.mjs";
import { registerAppearanceRoutes } from "./appearance.mjs";
import { DEMO_EMAILS, seedDemo } from "./seed.mjs";
import { registerEmailChangeRoutes } from "./email-change.mjs";
import { registerPersonalTaskRoutes } from "./personal-tasks.mjs";
import { registerAiAssistantRoutes } from "./ai-assistant.mjs";
import {registerTaskExtrasRoutes,extraAssigneeIds,reconcileTaskAssignees,copyRecurringExtras,taskScopeLinkConflict} from "./task-extras.mjs";
import {registerRemoteStorageRoutes} from "./remote-storage.mjs";
import {registerGoogleRoutes} from "./google-login.mjs";
import { createPersonalWorkspace, personalWorkspaceId, isPersonalWorkspace } from "./personal-workspace.mjs";
import {registerBackupRoutes} from "./backups.mjs";
import {registerEventRoutes,processEventReminders} from "./calendar-events.mjs";
import { recordRevision, assertRevision } from "./record-revision.mjs";
import { registerTaskMutationPipeline, registerTaskMutationCommand } from "./task-mutation-pipeline.mjs";
import {registerBoardTransferRoutes} from "./board-transfer.mjs";
import {JSON_BODY_LIMIT_BYTES} from "../shared/board-transfer.mjs";
import { registerCollaborationRoutes } from "./collaboration.mjs";
import { registerServiceRoutes, processServiceReminders } from "./services.mjs";
import { registerOperationsDashboard } from "./operations-dashboard.mjs";
import { registerWorkCalendarRoutes, nextWorkingOccurrence, getWorkCalendar, delegatedRecipients } from "./work-calendar.mjs";
import { registerTimeRoutes } from "./work-time.mjs";
import { registerWorkReports } from "./work-reports.mjs";
import { registerAutomationRoutes,emitTaskEvent } from "./automations.mjs";
import { authRequestLimiter, registerPasswordResetRoutes } from "./password-reset.mjs";
import {
  createFcmTransport,
  processNotificationOutbox,
  registerMobileRoutes,
} from "./mobile.mjs";
import express from "express";
import nodemailer from "nodemailer";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { openDatabase, withTransaction } from "./db.mjs";
import {
  createId,
  createToken,
  hashPassword,
  hashToken,
  safeEqualText,
  verifyPassword,
} from "./auth.mjs";
import { registerTicketRoutes } from "./tickets.mjs";
import {
  canAccessTeamTask,
  canManageAllTeams,
  getTeamAccess,
  registerTeamRoutes,
  visibleTeamRows,
} from "./teams.mjs";
import {
  changedTaskSummary,
  recordTaskActivity,
  registerTaskDetailRoutes,
} from "./task-details.mjs";
import { recordTrashItem, registerTrashRoutes } from "./trash.mjs";
import { registerTaskFileRoutes } from "./task-files.mjs";
import {
  registerBoardRoutes,
  resolveTaskColumn,
  ensureBoardColumns,
} from "./boards.mjs";

const SESSION_COOKIE = "nt_session";
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const SETTINGS_KEY_BYTES = 32;
const SETTINGS_KEY_ENV_NAMES = [
  "NHACTOI_SETTINGS_KEY",
  "SETTINGS_ENCRYPTION_KEY",
  "ADMIN_SETTINGS_KEY",
];
const SETTINGS_KEY_FILE_ENV_NAMES = [
  "NHACTOI_SETTINGS_KEY_FILE",
  "SETTINGS_KEY_FILE",
  "ADMIN_SETTINGS_KEY_FILE",
];
const SETTINGS_PLAIN_KEYS = new Set([
  "publicAppUrl",
  "plans",
  "billgateway.apiUrl",
  "billgateway.projectId",
  "smtp.host",
  "smtp.port",
  "smtp.secure",
  "smtp.user",
  "smtp.from",
  "smtp.enabled",
]);
const SETTINGS_SECRET_KEYS = new Set([
  "billgateway.apiKey",
  "billgateway.webhookSecret",
  "smtp.password",
]);

const DEFAULT_PLANS = [
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 199000,
    yearlyPrice: 1990000,
    memberLimit: 3,
    features: [
      "Quản lý việc và nhắc việc",
      "Thu chi cơ bản",
      "Tối đa 3 thành viên",
    ],
  },
  {
    id: "team",
    name: "Team",
    monthlyPrice: 499000,
    yearlyPrice: 4990000,
    memberLimit: 10,
    features: ["Tất cả Starter", "Phân quyền nhóm", "Tối đa 10 thành viên"],
  },
  {
    id: "business",
    name: "Business",
    monthlyPrice: 999000,
    yearlyPrice: 9990000,
    memberLimit: 50,
    features: ["Tất cả Team", "Tối đa 50 thành viên"],
  },
];

const RECURRENCES = new Set(RECURRENCE_VALUES);
const STATUSES = new Set(["todo", "doing", "done"]);
const PRIORITIES = new Set(["low", "medium", "high"]);

function configFrom(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const numberEnv = (names, fallback) => {
    for (const name of names) {
      if (env[name] !== undefined && env[name] !== "") {
        const parsed = Number(env[name]);
        if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
      }
    }
    return fallback;
  };
  const gatewayApiUrl = String(
    env.BILLGATE_API_URL || env.BILLGATE_URL || env.BILLING_GATEWAY_URL || "",
  ).replace(/\/$/, "");
  const gatewayUrl = String(env.BILLGATE_CHECKOUT_URL || gatewayApiUrl).replace(
    /\/$/,
    "",
  );
  const gatewayApiKey = String(
    env.BILLGATE_API_KEY || env.BILLING_GATEWAY_API_KEY || "",
  );
  const gatewayProjectId = String(
    env.BILLGATE_PROJECT_ID || env.BILLING_GATEWAY_PROJECT_ID || "",
  );
  const webhookSecret = String(
    env.BILLGATE_WEBHOOK_SECRET || env.BILLING_WEBHOOK_SECRET || "",
  );
  // Checkout and reconciliation need all integration credentials. A flag
  // cannot make a partially configured live integration look healthy.
  const configured = Boolean(gatewayApiUrl && gatewayApiKey && webhookSecret);
  const frontendOrigins = String(
    env.FRONTEND_ORIGIN ||
      env.FRONTEND_URL ||
      "http://localhost:3000,http://127.0.0.1:3000",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    env,
    importLimits: {maxBytes:Math.min(512*1024,numberEnv(['IMPORT_MAX_FILE_BYTES'],512*1024)),maxRows:Math.min(500,numberEnv(['IMPORT_MAX_ROWS'],500)),maxLists:Math.min(40,numberEnv(['IMPORT_MAX_LISTS'],40)),maxColumns:100},
    port: Number(env.PORT || 3000),
    host: String(env.HOST || "127.0.0.1"),
    nodeEnv: String(env.NODE_ENV || "development"),
    // Passwordless demo login must be switched on explicitly, never in production.
    devLoginEnabled:
      String(env.NODE_ENV || "development") !== "production" &&
      String(env.NHACTOI_DEV_LOGIN || "").toLowerCase() === "true",
    gatewayUrl,
    gatewayApiUrl,
    gatewayApiKey,
    gatewayProjectId,
    webhookSecret,
    billingConfigured: configured,
    frontendOrigins,
    publicAppUrl: String(
      env.PUBLIC_APP_URL || env.FRONTEND_URL || "http://localhost:3000",
    ).replace(/\/$/, ""),
    cookieSecure:
      String(env.COOKIE_SECURE || "").toLowerCase() === "true" ||
      String(env.NODE_ENV || "") === "production",
    sessionDays: numberEnv(["SESSION_DAYS"], SESSION_DAYS),
    mobileSessionDays: numberEnv(["MOBILE_SESSION_DAYS"], SESSION_DAYS),
    inviteDays: numberEnv(["INVITE_DAYS"], INVITE_DAYS),
    plans: DEFAULT_PLANS.map((plan) => ({
      ...plan,
      monthlyPrice: numberEnv(
        [
          `${plan.id.toUpperCase()}_MONTHLY_PRICE`,
          `BILLING_${plan.id.toUpperCase()}_MONTHLY_PRICE`,
        ],
        plan.monthlyPrice,
      ),
      yearlyPrice: numberEnv(
        [
          `${plan.id.toUpperCase()}_YEARLY_PRICE`,
          `BILLING_${plan.id.toUpperCase()}_YEARLY_PRICE`,
        ],
        plan.yearlyPrice,
      ),
    })),
    smtp: env.SMTP_HOST
      ? {
          host: String(env.SMTP_HOST),
          port: Number(env.SMTP_PORT || 587),
          secure: String(env.SMTP_SECURE || "").toLowerCase() === "true",
          user: env.SMTP_USER ? String(env.SMTP_USER) : undefined,
          pass: env.SMTP_PASS ? String(env.SMTP_PASS) : undefined,
          from: String(
            env.SMTP_FROM || env.SMTP_USER || "no-reply@nhactoi.local",
          ),
        }
      : null,
    smtpEnabled: Boolean(env.SMTP_HOST),
    settingsSource: {
      publicAppUrl: "env",
      plans: "env",
      billgateway: "env",
      smtp: "env",
    },
  };
}

function settingKeyFromEnv(env) {
  for (const name of SETTINGS_KEY_ENV_NAMES) {
    const value = env?.[name];
    if (value !== undefined && value !== "") return String(value);
  }
  return "";
}

function deriveSettingsKey(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^[a-f0-9]{64}$/i.test(text)) return Buffer.from(text, "hex");
  try {
    const decoded = Buffer.from(text, "base64");
    if (decoded.length === SETTINGS_KEY_BYTES) return decoded;
  } catch {}
  return createHash("sha256").update(text, "utf8").digest();
}

function settingsKeyFileFromEnv(env, dbPath) {
  for (const name of SETTINGS_KEY_FILE_ENV_NAMES) {
    const value = env?.[name];
    if (value !== undefined && value !== "") return resolve(String(value));
  }
  if (dbPath && dbPath !== ":memory:")
    return join(dirname(resolve(dbPath)), ".nhactoi-settings.key");
  return null;
}

function loadSettingsKey({ env, dbPath, explicitKey, db } = {}) {
  const envKey = deriveSettingsKey(explicitKey || settingKeyFromEnv(env));
  if (envKey) return envKey;
  const keyPath = settingsKeyFileFromEnv(env, dbPath);
  if ((!keyPath || !existsSync(/* turbopackIgnore: true */ keyPath))
    && db?.prepare('SELECT 1 FROM app_settings WHERE encrypted=1 LIMIT 1').get())
    throw new Error('Thiếu khóa mã hóa gốc. Cung cấp NHACTOI_SETTINGS_KEY hoặc khôi phục tệp khóa trước khi khởi động.');
  if (!keyPath) return randomBytes(SETTINGS_KEY_BYTES);
  mkdirSync(dirname(keyPath), { recursive: true });
  if (existsSync(/* turbopackIgnore: true */ keyPath)) {
    const value = readFileSync(/* turbopackIgnore: true */ keyPath);
    if (value.length !== SETTINGS_KEY_BYTES)
      throw new Error("settings encryption key file is invalid");
    chmodSync(keyPath, 0o600);
    return value;
  }
  const value = randomBytes(SETTINGS_KEY_BYTES);
  writeFileSync(keyPath, value, { mode: 0o600, flag: "wx" });
  chmodSync(keyPath, 0o600);
  return value;
}

function encryptSetting(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

function decryptSetting(value, key) {
  const [version, ivText, tagText, encryptedText] = String(value).split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText)
    throw new Error("settings encryption value is invalid");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function loadStoredSettings(db, key) {
  if (!db) return new Map();
  const rows = db
    .prepare("SELECT key, value, encrypted FROM app_settings")
    .all();
  const values = new Map();
  for (const row of rows) {
    try {
      const text = row.encrypted ? decryptSetting(row.value, key) : String(row.value);
      values.set(row.key, text);
    } catch {
      throw new Error('Không giải mã được cấu hình. Kiểm tra khóa mã hóa gốc và tính toàn vẹn bản sao; sender chưa được khởi động.');
    }
  }
  return values;
}

function parseStoredJson(values, key, fallback = null) {
  const text = values.get(key);
  if (text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`stored setting ${key} is invalid`);
  }
}

function applyStoredSettings(config, values) {
  const source = { ...config.settingsSource };
  const publicAppUrl = parseStoredJson(values, "publicAppUrl");
  if (publicAppUrl !== null) {
    config.publicAppUrl = String(publicAppUrl);
    source.publicAppUrl = "database";
  }
  const plans = parseStoredJson(values, "plans");
  if (Array.isArray(plans)) {
    config.plans = plans.map((plan) => ({
      ...plan,
      monthlyPrice: Number(plan.monthlyPrice),
      yearlyPrice: Number(plan.yearlyPrice),
      memberLimit: Number(plan.memberLimit),
      features: Array.isArray(plan.features) ? [...plan.features] : [],
    })).map(planWithSeatFeature);
    source.plans = "database";
  }
  const gatewayApiUrl = parseStoredJson(values, "billgateway.apiUrl");
  const gatewayProjectId = parseStoredJson(values, "billgateway.projectId");
  const gatewayApiKey = parseStoredJson(values, "billgateway.apiKey");
  const webhookSecret = parseStoredJson(values, "billgateway.webhookSecret");
  if (gatewayApiUrl !== null) {
    config.gatewayApiUrl = String(gatewayApiUrl).replace(/\/$/, "");
    config.gatewayUrl = config.gatewayApiUrl;
    source.billgateway = "database";
  }
  if (gatewayProjectId !== null) {
    config.gatewayProjectId = String(gatewayProjectId);
    source.billgateway = "database";
  }
  if (gatewayApiKey !== null) {
    config.gatewayApiKey = String(gatewayApiKey);
    source.billgateway = "database";
  }
  if (webhookSecret !== null) {
    config.webhookSecret = String(webhookSecret);
    source.billgateway = "database";
  }
  config.billingConfigured = Boolean(
    config.gatewayApiUrl && config.gatewayApiKey && config.webhookSecret,
  );

  const smtp = { ...(config.smtp || {}) };
  let hasSmtpOverride = false;
  for (const [key, property] of [
    ["smtp.host", "host"],
    ["smtp.port", "port"],
    ["smtp.secure", "secure"],
    ["smtp.user", "user"],
    ["smtp.from", "from"],
    ["smtp.password", "pass"],
  ]) {
    const value = parseStoredJson(values, key);
    if (value !== null) {
      smtp[property] = key === "smtp.port" ? Number(value) : value;
      hasSmtpOverride = true;
    }
  }
  const smtpEnabled = parseStoredJson(values, "smtp.enabled");
  if (smtpEnabled !== null) {
    config.smtpEnabled = Boolean(smtpEnabled);
    hasSmtpOverride = true;
  }
  if (hasSmtpOverride) {
    // Keep the SMTP object even when its host is cleared. This preserves an
    // encrypted password and other fields for an immediate host re-enable;
    // smtpTransport below still requires a host and enabled flag.
    config.smtp = smtp;
    source.smtp = "database";
  }
  config.settingsSource = source;
  config._storedSettings = values;
  return config;
}

function jsonSetting(value) {
  return JSON.stringify(value);
}

function currentDate(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function isoNow(clock) {
  return currentDate(clock).toISOString();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonthsClamped(date, months) {
  const source = new Date(date);
  const originalDay = source.getUTCDate();
  const next = new Date(
    Date.UTC(
      source.getUTCFullYear(),
      source.getUTCMonth() + months,
      1,
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      source.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(originalDay, lastDay));
  return next;
}

function nextRecurrence(dateText, recurrence, options, completedAt, anchorAt) {
  return nextTaskOccurrence(dateText, recurrence, options, completedAt, anchorAt);
}

function cleanString(
  value,
  { required = false, max = 1000, field = "field" } = {},
) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} is required`);
    return "";
  }
  const result = String(value).trim();
  if (required && !result) throw new HttpError(400, `${field} is required`);
  if (result.length > max) throw new HttpError(400, `${field} is too long`);
  return result;
}

function emailValue(value) {
  const email = cleanString(value, {
    required: true,
    max: 320,
    field: "email",
  }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "email is invalid");
  return email;
}

function passwordValue(value) {
  const password = String(value ?? "");
  if (password.length < 8 || password.length > 256) {
    throw new HttpError(400, "password must be between 8 and 256 characters");
  }
  return password;
}

function dateValue(value, field, { dateOnly = false, required = false } = {}) {
  if ((value === undefined || value === null || value === "") && !required)
    return null;
  const text = cleanString(value, { required: true, max: 80, field });
  if (dateOnly) {
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== text
    ) {
      throw new HttpError(400, `${field} is invalid`);
    }
    return text;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime()))
    throw new HttpError(400, `${field} is invalid`);
  return date.toISOString();
}

function positiveAmount(value) {
  const amount =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new HttpError(400, "amount must be a positive integer");
  return amount;
}

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function fail(res, status, message, details) {
  const payload = { error: message };
  if (details !== undefined) payload.details = details;
  return res.status(status).json(payload);
}

function rowObject(row) {
  return row ? { ...row } : null;
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        // A malformed cookie must not prevent login or other requests.
      }
    }
  }
  return cookies;
}

function parseBearer(header) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(header || ""));
  return match?.[1] || null;
}

function setSessionCookie(
  res,
  token,
  config,
  maxAgeSeconds = config.sessionDays * 86400,
) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (typeof maxAgeSeconds === "number" && Number.isFinite(maxAgeSeconds)) {
    attributes.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  if (config.cookieSecure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function clearSessionCookie(res, config) {
  setSessionCookie(res, "", config, 0);
}

function userJson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    memberType: row.member_type || "member",
    isPlatformAdmin: Boolean(row.is_platform_admin ?? row.isPlatformAdmin),
  };
}

function workspaceJson(row) {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    suspendedAt: row.suspended_at ?? row.suspendedAt ?? null,
  };
}

function taskJson(row, auth) {
  return {
    id: row.id,
    revision: recordRevision(row, "task"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    startAt: row.start_at ?? null,
    remindAt: row.remind_at,
    assigneeId: row.assignee_id,
    customerId: auth?.memberType === "guest" ? null : row.customer_id,
    category: row.category,
    recurrence: row.recurrence,
    recurrenceOptions: storedRecurrenceOptions(row),
    projectId: row.project_id ?? null,
    teamId: row.team_id ?? null,
    columnId: row.column_id ?? null,
    boardPosition: Number(row.board_position || 0),
    teamName: row.team_name ?? null,
    teamArchived:
      row.team_id === null || row.team_id === undefined
        ? false
        : Boolean(row.team_archived),
  };
}

function customerJson(row) {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    service: row.service,
  };
}

function memberJson(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

function transactionJson(row) {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    title: row.title,
    category: row.category,
    date: row.date,
    customerId: row.customer_id,
  };
}

function notificationJson(row) {
  const entityType = row.entity_type ?? null;
  const entityId = row.entity_id ?? null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    readAt: row.read_at,
    createdAt: row.created_at,
    taskId: row.task_id,
    serviceId: row.service_id || null,
    workspaceId: row.workspace_id,
    entityType,
    entityId,
    target: entityType && entityId ? { type: entityType, id: entityId } : null,
  };
}

function isRole(auth, roles) {
  return Boolean(auth && roles.includes(auth.role));
}

function memberLimit(config, subscription) {
  const plan =
    config.plans.find((item) => item.id === subscription?.plan) ||
    config.plans[0];
  return plan.memberLimit;
}

function assertWorkspacePlanSeats(db, workspaceId, plan, clock) {
  if (!plan) throw new HttpError(409, "Gói thuê bao không còn khả dụng");
  const seats = workspaceSeatCount(db, workspaceId, isoNow(clock));
  if (seats > plan.memberLimit)
    throw new HttpError(409, `Gói ${plan.name} chỉ cho phép ${plan.memberLimit} thành viên, hiện đã có ${seats} thành viên và lời mời đang chờ. Giảm số ghế rồi xác nhận thanh toán lại.`);
}

function getSubscription(db, workspaceId) {
  return rowObject(
    db
      .prepare("SELECT * FROM subscriptions WHERE workspace_id = ?")
      .get(workspaceId),
  );
}

function ensureWritable(req) {
  const workspace = req.app.locals.db
    .prepare("SELECT suspended_at FROM workspaces WHERE id = ?")
    .get(req.auth.workspaceId);
  if (workspace?.suspended_at)
    throw new HttpError(423, "workspace is suspended; contact support");
  const subscription = getSubscription(req.app.locals.db, req.auth.workspaceId);
  if (!subscription)
    throw new HttpError(402, "workspace subscription is not available");
  if (
    subscription.status === "canceled" ||
    subscription.status === "expired" ||
    new Date(subscription.current_period_end).getTime() <=
      currentDate(req.app.locals.clock).getTime()
  ) {
    throw new HttpError(
      402,
      "subscription has expired; choose a billing plan to continue",
    );
  }
  return subscription;
}

function createSession(db, userId, workspaceId, config, clock, { kind = "web", days = null } = {}) {
  const token = createToken();
  const now = currentDate(clock);
  const sessionDays =
    typeof days === "number" && Number.isFinite(days) && days > 0
      ? days
      : kind === "mobile"
        ? config.mobileSessionDays
        : config.sessionDays;
  const expires = addDays(now, sessionDays).toISOString();
  db.prepare(
    `
    INSERT INTO sessions(id, token_hash, user_id, workspace_id, expires_at, created_at, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    createId("ses_"),
    hashToken(token),
    userId,
    workspaceId,
    expires,
    now.toISOString(),
    kind === "mobile" ? "mobile" : "web",
  );
  return { token, expires };
}

function authContext(db, token, clock, expectedKind = null) {
  if (!token) return null;
  const session = db
    .prepare(
      `
    SELECT s.id AS session_id, s.user_id, s.workspace_id, s.expires_at,
           s.kind AS session_kind,
           u.id, u.name, u.email, u.is_platform_admin, u.disabled_at,
           wm.role, ${db.dialect === "postgres" ? "wm.member_type" : "'member' AS member_type"},
           w.name AS workspace_name, w.industry AS workspace_industry,
           w.suspended_at AS workspace_suspended_at,
           ${db.dialect === "postgres" ? "w.kind" : "'team'"} AS workspace_kind
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN workspace_members wm ON wm.workspace_id = s.workspace_id AND wm.user_id = s.user_id
    JOIN workspaces w ON w.id = s.workspace_id
    WHERE s.token_hash = ?
    LIMIT 1
  `,
    )
    .get(hashToken(token));
  if (!session) return null;
  if (expectedKind && session.session_kind !== expectedKind) return null;
  if (new Date(session.expires_at).getTime() <= currentDate(clock).getTime()) {
    invalidateSessions(db, { id: session.session_id });
    return null;
  }
  if (session.disabled_at) {
    // A platform admin may be disabled while a session is still present. The
    // session is invalid immediately rather than waiting for its expiry.
    invalidateSessions(db, { id: session.session_id });
    return null;
  }
  return {
    user: userJson({
      id: session.user_id,
      name: session.name,
      email: session.email,
      role: session.role,
      member_type: session.member_type,
      is_platform_admin: session.is_platform_admin,
    }),
    userId: session.user_id,
    workspaceId: session.workspace_id,
    role: session.role,
    memberType: session.member_type || "member",
    workspace: {
      id: session.workspace_id,
      name: session.workspace_name,
      industry: session.workspace_industry,
      kind: session.workspace_kind || "team",
      suspendedAt: session.workspace_suspended_at || null,
    },
    sessionId: session.session_id,
    sessionKind: session.session_kind || "web",
    expiresAt: session.expires_at,
  };
}

function assertOrigin(req, config) {
  const origin = req.get("origin");
  if (!origin) return;
  const hostOrigin = `${req.protocol}://${req.get("host")}`;
  const allowed = new Set([...config.frontendOrigins, hostOrigin]);
  if (!allowed.has(origin))
    throw new HttpError(403, "request origin is not allowed");
}

function requireAuth(req, res, next) {
  if (!req.auth) return fail(res, 401, "authentication required");
  if (req.auth.memberType === 'guest' && req.path !== '/api/ai/config' && !/^\/api\/(?:tasks(?:\/|$)|boards(?:\/|$)|projects(?:\/|$)|personal-tasks$|dashboard$|operations-dashboard$|timers(?:\/|$)|time-entries(?:\/|$)|reports\/(?:capacity|portfolio|sla)$|me(?:\/email-change(?:\/confirm)?)?$|workspaces(?:\/|$)|notifications(?:\/|$)|task-labels$|appearance(?:\/|$)|mobile\/(?:auth(?:\/|$)|notifications(?:\/|$)|devices(?:\/|$))|web-push(?:\/|$))/.test(req.path))
    return fail(res, 403, "Khách chỉ được truy cập dự án được chia sẻ");
  return next();
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth) return fail(res, 401, "authentication required");
    if (req.auth.memberType === "guest" || !isRole(req.auth, roles))
      return fail(res, 403, "you do not have permission for this action");
    return next();
  };
}

// Platform-admin access is deliberately checked against the users table on
// every request. A long-lived session must stop granting access immediately
// after a CLI revoke or an account lock, even if its auth context was created
// before that change.
function requirePlatformAdmin(req, res, next) {
  if (!req.auth) return fail(res, 401, "authentication required");
  const current = req.app.locals.db
    .prepare(
      "SELECT id, is_platform_admin, disabled_at FROM users WHERE id = ?",
    )
    .get(req.auth.userId);
  if (!current || current.disabled_at)
    return fail(res, 403, "tài khoản không có quyền quản trị nền tảng");
  if (!Boolean(current.is_platform_admin))
    return fail(res, 403, "tài khoản không có quyền quản trị nền tảng");
  req.platformAdmin = current;
  return next();
}

function authRateLimiter({ db, clock, settingsKey }) {
  return (req, res, next) => {
    // The preceding shared IP limiter also removes expired buckets. Persist
    // fixed-size keys so changing emails cannot retain unbounded strings in RAM.
    const key = `login:failure:${createHmac("sha256", settingsKey).update(JSON.stringify([
      req.ip || req.socket?.remoteAddress || "unknown",
      String(req.body?.email || "").trim().toLowerCase(),
    ])).digest("hex")}`;
    const now = currentDate(clock).getTime();
    const record = db.prepare("SELECT count, expires_at FROM auth_request_limits WHERE bucket = ?").get(key);
    if (record && record.expires_at > now && record.count >= 5) {
      res.set("Retry-After", String(Math.ceil((record.expires_at - now) / 1000)));
      return fail(
        res,
        429,
        "too many authentication attempts; try again later",
      );
    }
    req.noteAuthFailure = () => {
      db.prepare(`INSERT INTO auth_request_limits(bucket, expires_at, count) VALUES (?, ?, 1)
        ON CONFLICT(bucket) DO UPDATE SET count = auth_request_limits.count + 1`)
        .run(key, now + 60_000);
    };
    req.clearAuthFailures = () => db.prepare("DELETE FROM auth_request_limits WHERE bucket = ?").run(key);
    return next();
  };
}

function assertMemberReference(db, workspaceId, assigneeId, customerId) {
  if (assigneeId) {
    const member = db
      .prepare(
        `
      SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?
    `,
      )
      .get(workspaceId, assigneeId);
    if (!member)
      throw new HttpError(400, "assigneeId does not belong to this workspace");
  }
  if (customerId) {
    const customer = db
      .prepare(
        `
      SELECT 1 FROM customers WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
    `,
      )
      .get(workspaceId, customerId);
    if (!customer)
      throw new HttpError(400, "customerId does not belong to this workspace");
  }
}

function memberRows(db, workspaceId) {
  return db
    .prepare(
      `
    SELECT u.id, u.name, u.email, wm.role
    FROM workspace_members wm
    JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ?
    ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name
  `,
    )
    .all(workspaceId)
    .map(memberJson);
}

function taskRowById(db, taskId, workspaceId) {
  return rowObject(
    db
      .prepare(
        `
        SELECT t.*, tm.name AS team_name, tm.archived_at AS team_archived
        FROM tasks t
        LEFT JOIN teams tm ON tm.id = t.team_id
        WHERE t.id = ? AND t.workspace_id = ? AND t.deleted_at IS NULL
      `,
      )
      .get(taskId, workspaceId),
  );
}

function taskRows(db, workspaceId, userId) {
  const auth = db.dialect === "postgres" ? { memberType: db.prepare("SELECT member_type FROM workspace_members WHERE workspace_id=? AND user_id=?").get(workspaceId,userId)?.member_type } : null;
  const global = canManageAllTeams(db, workspaceId, userId);
  return db
    .prepare(
      `
    SELECT t.*, tm.name AS team_name, tm.archived_at AS team_archived
    FROM tasks t
    LEFT JOIN teams tm ON tm.id = t.team_id AND tm.workspace_id = t.workspace_id
    WHERE t.workspace_id = ? AND t.deleted_at IS NULL
      AND ${db.dialect === "postgres" ? taskAccessSql() : "? IS NOT NULL"}
      AND (
        t.team_id IS NULL
        OR (
          tm.archived_at IS NULL
          AND (${db.dialect === "postgres" ? "1" : "0"} = 1 OR ? = 1 OR EXISTS (
            SELECT 1 FROM team_members visible_tm
            WHERE visible_tm.team_id = t.team_id AND visible_tm.workspace_id = ?
              AND visible_tm.user_id = ?
          ))
        )
      )
    ORDER BY CASE t.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
             t.due_at ASC, t.created_at DESC, t.id ${db.dialect === "postgres" ? 'COLLATE "C" ' : ''}DESC
  `,
    )
    .all(workspaceId, userId, global ? 1 : 0, workspaceId, userId)
    .map(row => taskJson(row, auth));
}

function taskRowsFiltered(db, workspaceId, userId, query, clock) {
  const auth = db.dialect === "postgres" ? { memberType: db.prepare("SELECT member_type FROM workspace_members WHERE workspace_id=? AND user_id=?").get(workspaceId,userId)?.member_type } : null;
  const global = db.dialect !== "postgres" && canManageAllTeams(db, workspaceId, userId);
  // Evaluate the current project ACL once inside this statement. Keeping it
  // Keep project authorization inside the statement, separate from the
  // task projection, so only the requested page loads full task records.
  const postgres = db.dialect === 'postgres';
  const where = postgres ? [
    "t.workspace_id = ?", "t.deleted_at IS NULL",
    `t.project_id IN (SELECT readable.project_id FROM
      (SELECT id project_id, workspace_id FROM projects WHERE workspace_id=?) readable
      WHERE ${taskAccessSql('readable')} OFFSET 0)`,
    "(t.team_id IS NULL OR t.team_id NOT IN (SELECT id FROM teams WHERE workspace_id=? AND archived_at IS NOT NULL))",
  ] : [
    "t.workspace_id = ?",
    "t.deleted_at IS NULL",
    db.dialect === "postgres" ? taskAccessSql() : "? IS NOT NULL",
    `(t.team_id IS NULL OR (tm.archived_at IS NULL AND (${db.dialect === "postgres" ? "1" : "0"} = 1 OR ? = 1 OR EXISTS (SELECT 1 FROM team_members visible_tm WHERE visible_tm.team_id = t.team_id AND visible_tm.workspace_id = ? AND visible_tm.user_id = ?))) )`,
  ];
  const params = postgres ? [workspaceId, workspaceId, userId, workspaceId] : [workspaceId, userId, global ? 1 : 0, workspaceId, userId];
  if (query.status) {
    where.push("t.status = ?");
    params.push(query.status);
  }
  if (query.openOnly) where.push("t.status <> 'done'");
  if (query.customerId) { where.push("t.customer_id = ?"); params.push(query.customerId); }
  if (query.priority) {
    where.push("t.priority = ?");
    params.push(query.priority);
  }
  if (query.teamId === "common") where.push("t.team_id IS NULL");
  else if (query.teamId) {
    where.push("t.team_id = ?");
    params.push(query.teamId);
  }
  if (query.projectId) {
    where.push("t.project_id = ?");
    params.push(query.projectId);
  }
  if (query.assigneeId) {
    where.push("(t.assignee_id = ? OR EXISTS (SELECT 1 FROM task_assignees assigned WHERE assigned.task_id = t.id AND assigned.user_id = ?))");
    params.push(query.assigneeId, query.assigneeId);
  }
  if (query.q) {
    where.push("(unicode_fold(t.title) LIKE '%' || unicode_fold(?) || '%' OR unicode_fold(t.description) LIKE '%' || unicode_fold(?) || '%' OR unicode_fold(t.category) LIKE '%' || unicode_fold(?) || '%' OR unicode_fold(coalesce(tm.name, '')) LIKE '%' || unicode_fold(?) || '%')");
    params.push(query.q, query.q, query.q, query.q);
  }
  if (query.due === "overdue") {
    where.push("t.status != 'done' AND t.due_at < ?");
    params.push(isoNow(clock));
  } else if (query.due === "today") {
    const start = new Date(`${planningDay(currentDate(clock))}T00:00:00+07:00`).toISOString();
    const end = new Date(Date.parse(start) + 86400000).toISOString();
    where.push("t.due_at >= ? AND t.due_at < ?");
    params.push(start, end);
  }
  const whereSql = where.join(" AND ");
  const filterFrom = `FROM tasks t${!postgres || query.q ? ' LEFT JOIN teams tm ON tm.id=t.team_id AND tm.workspace_id=t.workspace_id' : ''}`;
  const total = Number(db.prepare(`SELECT COUNT(*) AS count ${filterFrom} WHERE ${whereSql}`).get(...params).count);
  const offset = (query.page - 1) * query.pageSize;
  // Opaque ID ties use byte order, independent of the database's locale.
  const orderBy = `CASE t.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
    t.due_at ASC, t.created_at DESC, t.id ${postgres ? 'COLLATE "C" ' : ''}DESC`;
  // Sort only keys before fetching the requested full records. Sorting wide
  // task rows spilled to disk on deep pages of the 50k fixture.
  const sql = db.dialect === 'postgres' ? `WITH page_keys AS MATERIALIZED (
     SELECT t.id ${filterFrom}
     WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?
    ) SELECT t.*,tm.name AS team_name,tm.archived_at AS team_archived
     FROM page_keys p JOIN tasks t ON t.id=p.id
     LEFT JOIN teams tm ON tm.id=t.team_id AND tm.workspace_id=t.workspace_id
     ORDER BY ${orderBy}` :
    `SELECT t.*, tm.name AS team_name, tm.archived_at AS team_archived
     FROM tasks t LEFT JOIN teams tm ON tm.id=t.team_id AND tm.workspace_id=t.workspace_id
     WHERE ${whereSql}
     ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, query.pageSize, offset).map(row => taskJson(row, auth));
  return { rows, total, offset };
}

// Bootstrap totals are calculated in PostgreSQL, never by loading every task
// into a browser. The same ACL predicate is applied before all aggregates.
function dashboardTaskSummary(db, workspaceId, userId, clock, guest = false) {
  const global = db.dialect !== "postgres" && canManageAllTeams(db, workspaceId, userId);
  const where = `t.workspace_id=? AND t.deleted_at IS NULL
    AND ${db.dialect === "postgres" ? taskAccessSql() : "? IS NOT NULL"}
    AND (t.team_id IS NULL OR (tm.archived_at IS NULL AND (${db.dialect === "postgres" ? "1" : "0"}=1 OR ?=1 OR EXISTS
      (SELECT 1 FROM team_members x WHERE x.team_id=t.team_id AND x.workspace_id=? AND x.user_id=?))))`;
  const from = `FROM tasks t LEFT JOIN teams tm ON tm.id=t.team_id AND tm.workspace_id=t.workspace_id WHERE ${where}`;
  const params = [workspaceId, userId, global ? 1 : 0, workspaceId, userId];
  const start = new Date(`${planningDay(currentDate(clock))}T00:00:00+07:00`).toISOString();
  const end = new Date(Date.parse(start) + 86400000).toISOString();
  const counts = `COUNT(*) total, SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) completed,
    SUM(CASE WHEN t.status<>'done' THEN 1 ELSE 0 END) open`;
  const total = db.prepare(`SELECT ${counts},
    SUM(CASE WHEN t.status<>'done' AND t.due_at>=? AND t.due_at<? THEN 1 ELSE 0 END) today,
    SUM(CASE WHEN t.status<>'done' AND t.due_at<? THEN 1 ELSE 0 END) overdue ${from}`)
    .get(start, end, isoNow(clock), ...params);
  const numeric = row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key,key==='id'?value:Number(value || 0)]));
  return { ...numeric(total),
    byAssignee: db.prepare(`SELECT t.assignee_id id, ${counts} ${from} AND t.assignee_id IS NOT NULL GROUP BY t.assignee_id`).all(...params).map(numeric),
    byCustomer: guest ? [] : db.prepare(`SELECT t.customer_id id, ${counts} ${from} AND t.customer_id IS NOT NULL GROUP BY t.customer_id`).all(...params).map(numeric),
  };
}

function taskListQuery(req) {
  const query = req.query || {};
  const hasQuery = Object.keys(query).length > 0;
  const status = query.status ? String(query.status).trim() : "";
  const priority = query.priority ? String(query.priority).trim() : "";
  const teamId = query.teamId ? String(query.teamId).trim() : "";
  const assigneeId = query.assigneeId ? String(query.assigneeId).trim() : "";
  const q = query.q ? String(query.q).trim() : "";
  const due = query.due ? String(query.due).trim() : "";
  if (status && !STATUSES.has(status)) throw new HttpError(400, "status is invalid");
  if (priority && !PRIORITIES.has(priority)) throw new HttpError(400, "priority is invalid");
  if (due && !new Set(["today", "overdue"]).has(due)) throw new HttpError(400, "due filter is invalid");
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? query.limit ?? 50);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new HttpError(400, "page is invalid");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new HttpError(400, "pageSize is invalid");
  return { hasQuery, status, priority, teamId, customerId: req.auth?.memberType === "guest" ? "" : String(query.customerId || ""), openOnly: query.openOnly === "true", projectId: String(query.projectId || ""), assigneeId, q: q.slice(0, 200), due, page, pageSize };
}

function customerRows(db, workspaceId) {
  return db
    .prepare(
      `
    SELECT * FROM customers WHERE workspace_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC
  `,
    )
    .all(workspaceId)
    .map(customerJson);
}

function transactionRows(db, workspaceId) {
  return db
    .prepare(
      `
    SELECT * FROM transactions WHERE workspace_id = ? AND deleted_at IS NULL
    ORDER BY date DESC, created_at DESC
  `,
    )
    .all(workspaceId)
    .map(transactionJson);
}

function calendarNotificationAccessSql() {
  // Calendar notifications are durable rows, so the event may be deleted or
  // the recipient's team membership may change before the row is read.
  // Target-less legacy rows are intentionally hidden because their event
  // ownership cannot be rechecked safely.
  return `
    (
      (
        n.type <> 'calendar_event'
        AND (n.entity_type IS NULL OR n.entity_type <> 'calendar_event')
      )
      OR EXISTS (
        SELECT 1 FROM calendar_events ce
        WHERE ce.id = n.entity_id
          AND ce.workspace_id = n.workspace_id
          AND (
            ce.team_id IS NULL
            OR EXISTS (
              SELECT 1 FROM workspace_members calendar_admin
              WHERE calendar_admin.workspace_id = n.workspace_id
                AND calendar_admin.user_id = n.user_id
                AND calendar_admin.role IN ('owner', 'admin')
            )
            OR EXISTS (
              SELECT 1 FROM team_members calendar_member
              WHERE calendar_member.team_id = ce.team_id
                AND calendar_member.workspace_id = n.workspace_id
                AND calendar_member.user_id = n.user_id
            )
          )
      )
    )`;
}

function notificationRows(db, userId, workspaceId) {
  return db
    .prepare(
      `
    SELECT n.*
    FROM notifications n
    LEFT JOIN tasks t ON t.id = n.task_id
    LEFT JOIN service_contracts sc ON sc.id = n.service_id AND sc.workspace_id = n.workspace_id
    WHERE n.user_id = ? AND n.workspace_id = ?
      AND ${db.dialect === "postgres" ? guestNotificationAccessSql() : "1=1"}
      AND (n.task_id IS NULL OR ${db.dialect === "postgres" ? taskAccessSql("t", "n.user_id") : "1=1"})
      AND (n.service_id IS NULL OR (sc.id IS NOT NULL AND sc.archived_at IS NULL AND (
        sc.team_id IS NULL
        OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=n.workspace_id AND wm.user_id=n.user_id AND wm.role IN ('owner','admin'))
        OR EXISTS (SELECT 1 FROM team_members sm WHERE sm.team_id=sc.team_id AND sm.workspace_id=n.workspace_id AND sm.user_id=n.user_id)
      )))
      AND (
        t.id IS NULL
        OR t.deleted_at IS NULL
      )
      AND (
        ${db.dialect === "postgres" ? "1" : "0"} = 1
        OR t.id IS NULL
        OR t.team_id IS NULL
        OR EXISTS (
          SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = n.workspace_id AND wm.user_id = n.user_id
            AND wm.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = t.team_id AND tm.workspace_id = n.workspace_id
          AND tm.user_id = n.user_id
        )
      )
      AND ${calendarNotificationAccessSql()}
    ORDER BY n.created_at DESC, n.id DESC LIMIT 100
  `,
    )
    .all(userId, workspaceId)
    .map(notificationJson);
}

function notificationRowsFiltered(db, userId, workspaceId, query) {
  const where = [
    "n.user_id = ?",
    "n.workspace_id = ?",
    db.dialect === "postgres" ? guestNotificationAccessSql() : "1=1",
    `(n.task_id IS NULL OR ${db.dialect === "postgres" ? taskAccessSql("t", "n.user_id") : "1=1"})`,
    "(t.id IS NULL OR t.deleted_at IS NULL)",
    db.dialect === "postgres" ? "1=1" : "(t.id IS NULL OR t.team_id IS NULL OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=n.workspace_id AND wm.user_id=n.user_id AND wm.role IN ('owner','admin')) OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id=t.team_id AND tm.workspace_id=n.workspace_id AND tm.user_id=n.user_id))",
    calendarNotificationAccessSql(),
  ];
  const params = [userId, workspaceId];
  where.push("(n.service_id IS NULL OR EXISTS (SELECT 1 FROM service_contracts sc WHERE sc.id=n.service_id AND sc.workspace_id=n.workspace_id AND sc.archived_at IS NULL AND (sc.team_id IS NULL OR EXISTS (SELECT 1 FROM workspace_members service_admin WHERE service_admin.workspace_id=n.workspace_id AND service_admin.user_id=n.user_id AND service_admin.role IN ('owner','admin')) OR EXISTS (SELECT 1 FROM team_members service_member WHERE service_member.team_id=sc.team_id AND service_member.workspace_id=n.workspace_id AND service_member.user_id=n.user_id))))");
  if (query.type) {
    where.push("n.type = ?");
    params.push(query.type);
  }
  if (query.unread !== null) where.push(query.unread ? "n.read_at IS NULL" : "n.read_at IS NOT NULL");
  const whereSql = where.join(" AND ");
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM notifications n LEFT JOIN tasks t ON t.id=n.task_id WHERE ${whereSql}`).get(...params).count);
  const offset = (query.page - 1) * query.pageSize;
  const rows = db.prepare(
    `SELECT n.* FROM notifications n LEFT JOIN tasks t ON t.id=n.task_id
     WHERE ${whereSql} ORDER BY n.created_at DESC,n.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, query.pageSize, offset).map(notificationJson);
  return { rows, total, offset };
}

function notificationListQuery(req) {
  const query = req.query || {};
  const hasQuery = Object.keys(query).length > 0;
  const type = query.type ? String(query.type).trim() : "";
  if (type && !["task_reminder", "task_update", "calendar_event", "service_renewal"].includes(type)) throw new HttpError(400, "notification type is invalid");
  let unread = null;
  if (query.unread !== undefined || query.read !== undefined) {
    const value = String(query.unread ?? query.read).toLowerCase();
    if (!["1", "true", "0", "false"].includes(value)) throw new HttpError(400, "unread filter is invalid");
    unread = ["1", "true"].includes(value);
    if (query.read !== undefined) unread = !unread;
  }
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? query.limit ?? 50);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new HttpError(400, "page is invalid");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new HttpError(400, "pageSize is invalid");
  return { hasQuery, type, unread, page, pageSize };
}

function planJson(plan) {
  return {
    id: plan.id,
    name: plan.name,
    monthlyPrice: plan.monthlyPrice,
    yearlyPrice: plan.yearlyPrice,
    memberLimit: plan.memberLimit,
    features: [...plan.features],
    entitlements: planEntitlements(plan),
  };
}

function billingOrderJson(row) {
  return {
    id: row.id,
    plan: row.plan,
    cycle: row.cycle,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    checkoutUrl: row.checkout_url || null,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

const ADMIN_PAGE_SIZE = 20;
const ADMIN_SUBSCRIPTION_STATUSES = new Set([
  "trialing",
  "active",
  "expired",
  "past_due",
  "canceled",
]);
const ADMIN_ORDER_STATUSES = new Set([
  "pending",
  "paid",
  "failed",
  "refunded",
  "expired",
]);

function adminListParams(req, allowedStatuses = null) {
  const rawPage = req.query?.page;
  const page = rawPage === undefined ? 1 : Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000)
    throw new HttpError(400, "Trang không hợp lệ");
  const q = cleanString(req.query?.q, { max: 200, field: "q" });
  const status = cleanString(req.query?.status, { max: 40, field: "status" });
  if (status && allowedStatuses && !allowedStatuses.has(status))
    throw new HttpError(400, "Trạng thái không hợp lệ");
  return {
    q: adminNormalizeSearch(q),
    status,
    page,
    pageSize: ADMIN_PAGE_SIZE,
    offset: (page - 1) * ADMIN_PAGE_SIZE,
  };
}

// Match PostgreSQL unicode_fold() when normalizing Vietnamese search input.
function adminNormalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN");
}

// Keep LIKE values bound and escape wildcard characters so a search remains a
// simple substring filter instead of becoming a user-controlled pattern.
function adminSearchLike(value) {
  return `%${String(value || "").replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function effectiveSubscriptionStatus(row, clock) {
  if (!row) return null;
  if (
    row.status !== "canceled" &&
    row.status !== "expired" &&
    new Date(row.current_period_end).getTime() <= currentDate(clock).getTime()
  ) {
    return "expired";
  }
  return row.status;
}

function parseAuditJson(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function adminWorkspaceJson(row, clock) {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    ownerName: row.owner_name || "",
    ownerEmail: row.owner_email || "",
    createdAt: row.created_at,
    suspendedAt: row.suspended_at || null,
    plan: row.plan || null,
    subscriptionStatus: effectiveSubscriptionStatus(
      row.plan
        ? {
            status: row.subscription_status,
            current_period_end: row.current_period_end,
          }
        : null,
      clock,
    ),
    currentPeriodEnd: row.current_period_end || null,
  };
}

function adminUserJson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isPlatformAdmin: Boolean(row.is_platform_admin),
    disabledAt: row.disabled_at || null,
    workspaceCount: Number(row.workspace_count || 0),
    createdAt: row.created_at,
  };
}

function adminSubscriptionJson(row, clock) {
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    plan: row.plan,
    cycle: row.cycle,
    status: effectiveSubscriptionStatus(row, clock),
    currentPeriodEnd: row.current_period_end,
    memberCount: Number(row.member_count || 0),
  };
}

function adminOrderJson(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    plan: row.plan,
    cycle: row.cycle,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    providerPaymentId: row.provider_payment_id || null,
    createdAt: row.created_at,
    paidAt: row.paid_at || null,
  };
}

function adminAuditJson(row) {
  return {
    id: row.id,
    actorName: row.actor_name || "",
    actorEmail: row.actor_email || "",
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name || null,
    reason: row.reason,
    before: parseAuditJson(row.before_json),
    after: parseAuditJson(row.after_json),
    createdAt: row.created_at,
  };
}

function adminAuditRows(db, targetType, targetId, limit = 10) {
  return db
    .prepare(
      `
      SELECT
        a.id, a.action, a.target_type, a.target_id, a.reason,
        a.before_json, a.after_json, a.created_at,
        u.name AS actor_name, u.email AS actor_email,
        CASE
          WHEN a.target_type = 'workspace' THEN (SELECT name FROM workspaces WHERE id = a.target_id)
          WHEN a.target_type = 'user' THEN (SELECT name FROM users WHERE id = a.target_id)
          ELSE NULL
        END AS target_name
      FROM admin_audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.target_type = ? AND a.target_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?
    `,
    )
    .all(targetType, targetId, limit)
    .map(adminAuditJson);
}

function adminUserDetailData(db, userId, clock) {
  const row = db
    .prepare(
      `
      SELECT u.id, u.name, u.email, u.is_platform_admin, u.disabled_at, u.created_at,
             (SELECT COUNT(*) FROM workspace_members wm WHERE wm.user_id = u.id) AS workspace_count
      FROM users u
      WHERE u.id = ?
    `,
    )
    .get(userId);
  if (!row) throw new HttpError(404, "Không tìm thấy người dùng");
  const workspaces = db
    .prepare(
      `
      SELECT
        w.id, w.name, w.industry, w.suspended_at,
        s.plan, s.status AS subscription_status, s.current_period_end
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      LEFT JOIN subscriptions s ON s.workspace_id = w.id
      WHERE wm.user_id = ?
      ORDER BY w.created_at DESC, w.id DESC
    `,
    )
    .all(userId)
    .map((item) => ({
      id: item.id,
      name: item.name,
      industry: item.industry,
      plan: item.plan || null,
      status: effectiveSubscriptionStatus(
        item.plan
          ? {
              status: item.subscription_status,
              current_period_end: item.current_period_end,
            }
          : null,
        clock,
      ),
      currentPeriodEnd: item.current_period_end || null,
      suspendedAt: item.suspended_at || null,
    }));
  return {
    user: adminUserJson(row),
    workspaces,
    audit: adminAuditRows(db, "user", userId),
  };
}

function workspaceProfileJson(row) {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    contactEmail: row.contact_email || "",
    phone: row.phone || "",
    address: row.address || "",
    website: row.website || "",
    taxCode: row.tax_code || "",
    note: row.note || "",
    createdAt: row.created_at,
    suspendedAt: row.suspended_at || null,
  };
}

function adminWorkspaceDetailData(db, workspaceId, clock) {
  const workspace = db
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(workspaceId);
  if (!workspace)
    throw new HttpError(404, "Không tìm thấy không gian làm việc");
  const ownerRow = db
    .prepare(
      `
      SELECT u.id, u.name, u.email
      FROM workspace_members wm JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = ? AND wm.role = 'owner'
      ORDER BY wm.created_at ASC
      LIMIT 1
    `,
    )
    .get(workspaceId);
  const subscriptionRow = db
    .prepare(
      `
      SELECT s.workspace_id, w.name AS workspace_name, s.plan, s.cycle,
             s.status, s.current_period_end,
             (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = s.workspace_id) AS member_count
      FROM subscriptions s JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.workspace_id = ?
    `,
    )
    .get(workspaceId);
  const orders = db
    .prepare(
      `
      SELECT o.id, o.workspace_id, w.name AS workspace_name, o.plan, o.cycle,
             o.amount, o.currency, o.status, o.provider_payment_id,
             o.created_at, o.paid_at
      FROM billing_orders o JOIN workspaces w ON w.id = o.workspace_id
      WHERE o.workspace_id = ?
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT 10
    `,
    )
    .all(workspaceId)
    .map(adminOrderJson);
  return {
    workspace: workspaceProfileJson(workspace),
    owner: ownerRow
      ? { id: ownerRow.id, name: ownerRow.name, email: ownerRow.email }
      : null,
    subscription: subscriptionRow
      ? adminSubscriptionJson(subscriptionRow, clock)
      : null,
    orders,
    audit: adminAuditRows(db, "workspace", workspaceId),
  };
}

function adminReason(value) {
  return cleanString(value, { required: true, max: 500, field: "reason" });
}

function adminBoolean(value, field) {
  if (typeof value !== "boolean")
    throw new HttpError(400, `${field} phải là true hoặc false`);
  return value;
}

function writeAdminAudit(
  db,
  { actorUserId, action, targetType, targetId, reason, before, after, createdAt },
) {
  db.prepare(
    `
    INSERT INTO admin_audit_logs
      (id, actor_user_id, action, target_type, target_id, reason, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    createId("admin_audit_"),
    actorUserId,
    action,
    targetType,
    targetId,
    reason,
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
    createdAt,
  );
}

function adminSqlPage(db, { countSql, rowsSql, values, params, map }) {
  const total = Number(db.prepare(countSql).get(...values).total || 0);
  const rows = db
    .prepare(`${rowsSql} LIMIT ? OFFSET ?`)
    .all(...values, params.pageSize, params.offset)
    .map(map);
  return { items: rows, total, page: params.page, pageSize: params.pageSize };
}

function adminWorkspacePage(db, params, clock) {
  const ownerName =
    "(SELECT u.name FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = w.id AND wm.role = 'owner' ORDER BY wm.created_at ASC LIMIT 1)";
  const ownerEmail =
    "(SELECT u.email FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = w.id AND wm.role = 'owner' ORDER BY wm.created_at ASC LIMIT 1)";
  const clauses = [];
  const values = [];
  if (params.status === "active") clauses.push("w.suspended_at IS NULL");
  if (params.status === "suspended") clauses.push("w.suspended_at IS NOT NULL");
  if (params.q) {
    const like = adminSearchLike(params.q);
    clauses.push(
      `(unicode_fold(COALESCE(w.name, '')) LIKE ? ESCAPE '\\'
        OR unicode_fold(COALESCE(w.industry, '')) LIKE ? ESCAPE '\\'
        OR unicode_fold(COALESCE(${ownerName}, '')) LIKE ? ESCAPE '\\'
        OR unicode_fold(COALESCE(${ownerEmail}, '')) LIKE ? ESCAPE '\\')`,
    );
    values.push(like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const select = `
    SELECT
      w.id, w.name, w.industry, w.created_at, w.suspended_at,
      ${ownerName} AS owner_name,
      ${ownerEmail} AS owner_email,
      s.plan, s.status AS subscription_status, s.current_period_end
    FROM workspaces w
    LEFT JOIN subscriptions s ON s.workspace_id = w.id
    ${where}
    ORDER BY w.created_at DESC, w.id DESC`;
  return adminSqlPage(db, {
    countSql: `SELECT COUNT(*) AS total FROM workspaces w ${where}`,
    rowsSql: select,
    values,
    params,
    map: (row) => adminWorkspaceJson(row, clock),
  });
}

function adminUserPage(db, params) {
  const clauses = [];
  const values = [];
  if (params.status === "disabled") clauses.push("u.disabled_at IS NOT NULL");
  if (params.status === "active") clauses.push("u.disabled_at IS NULL");
  if (params.status === "admin") clauses.push("u.is_platform_admin = 1");
  if (params.q) {
    const like = adminSearchLike(params.q);
    clauses.push(
      "(unicode_fold(COALESCE(u.name, '')) LIKE ? ESCAPE '\\' OR unicode_fold(COALESCE(u.email, '')) LIKE ? ESCAPE '\\')",
    );
    values.push(like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const select = `
    SELECT
      u.id, u.name, u.email, u.is_platform_admin, u.disabled_at, u.created_at,
      (SELECT COUNT(*) FROM workspace_members wm WHERE wm.user_id = u.id) AS workspace_count
    FROM users u
    ${where}
    ORDER BY u.created_at DESC, u.id DESC`;
  return adminSqlPage(db, {
    countSql: `SELECT COUNT(*) AS total FROM users u ${where}`,
    rowsSql: select,
    values,
    params,
    map: adminUserJson,
  });
}

function adminSubscriptionPage(db, params, clock) {
  const clauses = [];
  const values = [];
  const now = currentDate(clock).toISOString();
  if (params.status === "expired") {
    clauses.push(
      "(s.status = 'expired' OR (s.status NOT IN ('canceled', 'expired') AND s.current_period_end <= ?))",
    );
    values.push(now);
  } else if (params.status === "canceled") {
    clauses.push("s.status = 'canceled'");
  } else if (params.status) {
    clauses.push("s.status = ? AND s.current_period_end > ?");
    values.push(params.status, now);
  }
  if (params.q) {
    const like = adminSearchLike(params.q);
    clauses.push(
      "(unicode_fold(COALESCE(w.name, '')) LIKE ? ESCAPE '\\' OR unicode_fold(COALESCE(s.plan, '')) LIKE ? ESCAPE '\\' OR unicode_fold(COALESCE(s.workspace_id, '')) LIKE ? ESCAPE '\\')",
    );
    values.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const select = `
    SELECT
      s.workspace_id, w.name AS workspace_name, s.plan, s.cycle, s.status,
      s.current_period_end,
      (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = s.workspace_id) AS member_count
    FROM subscriptions s
    JOIN workspaces w ON w.id = s.workspace_id
    ${where}
    ORDER BY s.current_period_end ASC, s.workspace_id ASC`;
  return adminSqlPage(db, {
    countSql: `SELECT COUNT(*) AS total FROM subscriptions s JOIN workspaces w ON w.id = s.workspace_id ${where}`,
    rowsSql: select,
    values,
    params,
    map: (row) => adminSubscriptionJson(row, clock),
  });
}

function adminOrderPage(db, params) {
  const clauses = [];
  const values = [];
  if (params.status) {
    clauses.push("o.status = ?");
    values.push(params.status);
  }
  if (params.q) {
    const like = adminSearchLike(params.q);
    clauses.push(
      "(unicode_fold(COALESCE(o.id, '')) LIKE ? ESCAPE '\\' OR unicode_fold(COALESCE(o.workspace_id, '')) LIKE ? ESCAPE '\\' OR unicode_fold(COALESCE(w.name, '')) LIKE ? ESCAPE '\\' OR unicode_fold(COALESCE(o.provider_payment_id, '')) LIKE ? ESCAPE '\\')",
    );
    values.push(like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const select = `
    SELECT
      o.id, o.workspace_id, w.name AS workspace_name, o.plan, o.cycle,
      o.amount, o.currency, o.status, o.provider_payment_id,
      o.created_at, o.paid_at
    FROM billing_orders o
    JOIN workspaces w ON w.id = o.workspace_id
    ${where}
    ORDER BY o.created_at DESC, o.id DESC`;
  return adminSqlPage(db, {
    countSql: `SELECT COUNT(*) AS total FROM billing_orders o JOIN workspaces w ON w.id = o.workspace_id ${where}`,
    rowsSql: select,
    values,
    params,
    map: adminOrderJson,
  });
}

function adminAuditPage(db, params) {
  const clauses = [];
  const values = [];
  if (params.q) {
    const like = adminSearchLike(params.q);
    clauses.push(
      `(unicode_fold(COALESCE(a.action, '')) LIKE ? ESCAPE '\\'
        OR unicode_fold(COALESCE(a.target_type, '')) LIKE ? ESCAPE '\\'
        OR unicode_fold(COALESCE(a.target_id, '')) LIKE ? ESCAPE '\\'
        OR unicode_fold(COALESCE(a.reason, '')) LIKE ? ESCAPE '\\'
        OR unicode_fold(COALESCE(u.name, '')) LIKE ? ESCAPE '\\'
        OR unicode_fold(COALESCE(u.email, '')) LIKE ? ESCAPE '\\')`,
    );
    values.push(like, like, like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const select = `
    SELECT
      a.id, a.action, a.target_type, a.target_id, a.reason,
      a.before_json, a.after_json, a.created_at,
      u.name AS actor_name, u.email AS actor_email,
      CASE
        WHEN a.target_type = 'workspace' THEN (SELECT name FROM workspaces WHERE id = a.target_id)
        WHEN a.target_type = 'user' THEN (SELECT name FROM users WHERE id = a.target_id)
        ELSE NULL
      END AS target_name
    FROM admin_audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    ${where}
    ORDER BY a.created_at DESC, a.id DESC`;
  return adminSqlPage(db, {
    countSql: `SELECT COUNT(*) AS total FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${where}`,
    rowsSql: select,
    values,
    params,
    map: adminAuditJson,
  });
}

function adminOverviewData(db, config, clock) {
  const now = currentDate(clock).getTime();
  const subscriptions = db
    .prepare("SELECT plan, cycle, status, current_period_end FROM subscriptions")
    .all();
  const activeSubscriptions = subscriptions.filter(
    (row) =>
      row.status === "active" &&
      new Date(row.current_period_end).getTime() > now,
  );
  const planById = new Map(config.plans.map((plan) => [plan.id, plan]));
  // Annual pricing is normalized to one month for the platform MRR estimate.
  const normalizedMrr = activeSubscriptions.reduce((total, row) => {
    const plan = planById.get(row.plan);
    if (!plan) return total;
    return total +
      (row.cycle === "yearly" ? plan.yearlyPrice / 12 : plan.monthlyPrice);
  }, 0);
  const stats = {
    workspaces: Number(db.prepare("SELECT COUNT(*) AS n FROM workspaces").get().n),
    users: Number(db.prepare("SELECT COUNT(*) AS n FROM users").get().n),
    activeSubscriptions: activeSubscriptions.length,
    mrr: Math.round(normalizedMrr),
    paidRevenue: Number(
      db
        .prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM billing_orders WHERE status = 'paid'")
        .get().n,
    ),
    pendingOrders: Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM billing_orders WHERE status = 'pending'")
        .get().n,
    ),
    suspendedWorkspaces: Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM workspaces WHERE suspended_at IS NOT NULL")
        .get().n,
    ),
  };
  const workspaceRows = db
    .prepare(
      `
      SELECT
        w.id, w.name, w.industry, w.created_at, w.suspended_at,
        (SELECT u.name FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = w.id AND wm.role = 'owner' ORDER BY wm.created_at ASC LIMIT 1) AS owner_name,
        (SELECT u.email FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = w.id AND wm.role = 'owner' ORDER BY wm.created_at ASC LIMIT 1) AS owner_email,
        s.plan, s.status AS subscription_status, s.current_period_end
      FROM workspaces w LEFT JOIN subscriptions s ON s.workspace_id = w.id
      ORDER BY w.created_at DESC, w.id DESC LIMIT 5
    `,
    )
    .all()
    .map((row) => adminWorkspaceJson(row, clock));
  const orderRows = db
    .prepare(
      `
      SELECT o.id, o.workspace_id, w.name AS workspace_name, o.plan, o.cycle,
             o.amount, o.currency, o.status, o.provider_payment_id,
             o.created_at, o.paid_at
      FROM billing_orders o JOIN workspaces w ON w.id = o.workspace_id
      ORDER BY o.created_at DESC, o.id DESC LIMIT 5
    `,
    )
    .all()
    .map(adminOrderJson);
  return { stats, recentWorkspaces: workspaceRows, recentOrders: orderRows };
}

function adminSettingsData(config) {
  const smtp = config.smtp || {};
  return {
    billingConfigured: config.billingConfigured,
    smtpConfigured: Boolean(config.smtp && config.smtpEnabled && config.smtp.host),
    plans: config.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      monthly: plan.monthlyPrice,
      yearly: plan.yearlyPrice,
      seats: plan.memberLimit,
    })),
    publicAppUrl: config.publicAppUrl,
    billgateway: {
      apiUrl: config.gatewayApiUrl || "",
      projectId: config.gatewayProjectId || "",
      hasApiKey: Boolean(config.gatewayApiKey),
      hasWebhookSecret: Boolean(config.webhookSecret),
    },
    smtp: {
      host: smtp.host || "",
      port: Number(smtp.port || 587),
      secure: Boolean(smtp.secure),
      user: smtp.user || "",
      from: smtp.from || "",
      hasPassword: Boolean(smtp.pass),
      enabled: Boolean(config.smtp && config.smtpEnabled && config.smtp.host),
    },
    settingsSource: {
      publicAppUrl: config.settingsSource?.publicAppUrl || "env",
      plans: config.settingsSource?.plans || "env",
      billgateway: config.settingsSource?.billgateway || "env",
      smtp: config.settingsSource?.smtp || "env",
    },
  };
}

function httpUrlValue(value, field, { required = false, max = 500 } = {}) {
  const text = cleanString(value, { required, max, field });
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, `${field} is invalid`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol))
    throw new HttpError(400, `${field} must use http or https`);
  if (url.username || url.password)
    throw new HttpError(400, `${field} must not include credentials`);
  return text.replace(/\/$/, "");
}

function optionalEmailValue(value, field = "email") {
  if (value === undefined || value === null || value === "") return "";
  try {
    return emailValue(value);
  } catch (error) {
    if (error instanceof HttpError && field !== "email")
      throw new HttpError(error.status, `${field} is invalid`);
    throw error;
  }
}

function secretSettingValue(value, field, max = 512) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || !value.trim())
    throw new HttpError(400, `${field} is invalid`);
  return value;
}

function workspaceProfileValues(body) {
  const values = {};
  if (body.name !== undefined)
    values.name = cleanString(body.name, {
      required: true,
      max: 160,
      field: "name",
    });
  if (body.industry !== undefined)
    values.industry = cleanString(body.industry, { max: 120, field: "industry" });
  if (body.contactEmail !== undefined)
    values.contactEmail = optionalEmailValue(body.contactEmail, "contactEmail");
  if (body.phone !== undefined)
    values.phone = cleanString(body.phone, { max: 60, field: "phone" });
  if (body.address !== undefined)
    values.address = cleanString(body.address, { max: 300, field: "address" });
  if (body.website !== undefined)
    values.website = httpUrlValue(body.website, "website", { max: 500 });
  if (body.taxCode !== undefined)
    values.taxCode = cleanString(body.taxCode, { max: 80, field: "taxCode" });
  if (body.note !== undefined)
    values.note = cleanString(body.note, { max: 2000, field: "note" });
  return values;
}

function settingsSnapshot(config) {
  return { ...adminSettingsData(config), plans: config.plans.map(adminPlanJson) };
}

function planWithSeatFeature(plan) {
  const features = (Array.isArray(plan.features) ? [...plan.features] : [])
    .filter((feature) => !/^Tối đa\s+\d[\d,.]*\s+thành viên$/i.test(String(feature)))
    .concat(`Tối đa ${plan.memberLimit} thành viên`);
  return { ...plan, features };
}

function writeStoredSetting(db, key, value, { encrypted = false, keyBytes, updatedAt }) {
  const raw = jsonSetting(value);
  db.prepare(
    `
    INSERT INTO app_settings(key, value, encrypted, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value,
      encrypted = excluded.encrypted, updated_at = excluded.updated_at
  `,
  ).run(
    key,
    encrypted ? encryptSetting(raw, keyBytes) : raw,
    encrypted ? 1 : 0,
    updatedAt,
  );
}

function readStoredSetting(values, key, fallback = null) {
  const text = values.get(key);
  if (text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(500, `stored setting ${key} is invalid`);
  }
}

function adminPlanJson(plan) {
  return {
    id: plan.id, name: plan.name,
    monthly: plan.monthlyPrice, yearly: plan.yearlyPrice,
    seats: plan.memberLimit, features: [...plan.features],
    active: plan.active !== false,
    entitlements: planEntitlements(plan),
  };
}

function settingsPlanValues(config, bodyPlans) {
  if (bodyPlans === undefined) return config.plans;
  if (!Array.isArray(bodyPlans) || !bodyPlans.length || bodyPlans.length > 100)
    throw new HttpError(400, "Danh sách phải có từ 1 đến 100 gói");
  const seen = new Set();
  const plans = bodyPlans.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new HttpError(400, "Gói thuê bao không hợp lệ");
    const id = cleanString(value.id, { required: true, max: 20, field: "plan.id" });
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || seen.has(id))
      throw new HttpError(400, "Mã gói không hợp lệ hoặc bị trùng");
    seen.add(id);
    if (typeof value.name !== "string") throw new HttpError(400, "Tên gói không hợp lệ");
    const name = cleanString(value.name, { required: true, max: 80, field: "plan.name" });
    const monthly = positiveAmount(value.monthly);
    const yearly = positiveAmount(value.yearly);
    if (monthly > 1_000_000_000 || yearly > 1_000_000_000)
      throw new HttpError(400, "Giá gói tối đa là 1.000.000.000 VND");
    const seats = value.seats;
    if (!Number.isSafeInteger(seats) || seats < 1 || seats > 1_000_000)
      throw new HttpError(400, "Giới hạn thành viên phải từ 1 đến 1.000.000");
    const existing = config.plans.find((item) => item.id === id);
    const features = value.features === undefined ? existing?.features || [] : value.features;
    if (!Array.isArray(features) || features.length > 31 || features.some((feature) =>
      typeof feature !== "string" || !feature.trim() || feature.trim().length > 200))
      throw new HttpError(400, "Quyền lợi gồm tối đa 30 dòng, mỗi dòng từ 1 đến 200 ký tự");
    const descriptions = features.filter((feature) => !/^Tối đa\s+\d[\d,.]*\s+thành viên$/i.test(feature.trim()));
    if (descriptions.length > 30) throw new HttpError(400, "Tối đa 30 quyền lợi hiển thị");
    const active = value.active === undefined ? existing?.active !== false : value.active;
    if (typeof active !== "boolean") throw new HttpError(400, "Trạng thái bán không hợp lệ");
    const entitlements = value.entitlements === undefined ? planEntitlements(existing || { id }) : value.entitlements;
    if (!Array.isArray(entitlements) || entitlements.some(code => !ENTITLEMENT_CODES.includes(code))
      || new Set(entitlements).size !== entitlements.length)
      throw new HttpError(400, "Mã quyền của gói không hợp lệ hoặc bị trùng");
    return planWithSeatFeature({
      id, name, monthlyPrice: monthly, yearlyPrice: yearly,
      memberLimit: seats, features: descriptions.map((feature) => feature.trim()), active,
      entitlements: planEntitlements({ id, entitlements }),
    });
  });
  if (config.plans.some((plan) => !seen.has(plan.id)))
    throw new HttpError(400, "Không thể xóa gói đã tạo; hãy ngừng bán để giữ lịch sử");
  return plans;
}

function assertPlanSeatChanges(db, plans, clock) {
  lockPlanSeatChanges(db);
  for (const plan of plans) {
    const workspaces = db.prepare('SELECT workspace_id FROM subscriptions WHERE plan=? ORDER BY workspace_id').all(plan.id);
    for (const { workspace_id } of workspaces) {
      lockWorkspaceSeats(db, workspace_id);
      assertWorkspacePlanSeats(db, workspace_id, plan, clock);
    }
  }
}

function firstValue(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

function normalizeEventType(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/_/g, ".");
}

function isPaidEvent(eventType, payload) {
  const value = normalizeEventType(eventType);
  const status = String(
    firstValue(
      payload?.status,
      payload?.paymentStatus,
      payload?.data?.status,
    ) || "",
  ).toLowerCase();
  return (
    value === "payment.paid" ||
    value === "paid" ||
    value === "payment.success" ||
    value === "payment.succeeded" ||
    value === "payment.completed" ||
    status === "paid" ||
    status === "success" ||
    status === "succeeded" ||
    status === "completed"
  );
}

function isNonExtendingEvent(eventType, payload) {
  const value = normalizeEventType(eventType);
  const status = String(
    firstValue(
      payload?.status,
      payload?.paymentStatus,
      payload?.data?.status,
    ) || "",
  ).toLowerCase();
  return (
    value.includes("failed") ||
    value.includes("failure") ||
    value.includes("refunded") ||
    value.includes("refund") ||
    value.includes("canceled") ||
    value.includes("cancelled") ||
    value.includes("expired") ||
    [
      "failed",
      "failure",
      "refunded",
      "refund",
      "canceled",
      "cancelled",
      "expired",
    ].includes(status)
  );
}

function hmacMatches(raw, signature, secret) {
  if (!secret || !signature) return false;
  const supplied = String(signature)
    .trim()
    .replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  return safeEqualText(expected.toLowerCase(), supplied.toLowerCase());
}

function billGatewayEndpoint(config, path) {
  const base = config.gatewayApiUrl || config.gatewayUrl;
  if (!base) return null;
  if (/\/api(?:\/v1)?$/i.test(base)) return `${base}${path}`;
  return `${base}/api/v1${path}`;
}

function absoluteGatewayUrl(config, value) {
  if (!value) return null;
  try {
    const base = new URL(config.gatewayApiUrl || config.gatewayUrl);
    const target = new URL(value, `${base.protocol}//${base.host}`);
    return ["http:", "https:"].includes(target.protocol)
      ? target.toString()
      : null;
  } catch {
    return null;
  }
}

function amountFromPayload(payload) {
  const value = gatewayPaymentFromPayload(payload)?.totalAmount;
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function currencyFromPayload(payload) {
  const value = gatewayPaymentFromPayload(payload)?.currency;
  return value ? String(value).toUpperCase() : null;
}

function orderIdFromPayload(payload) {
  const value = gatewayPaymentFromPayload(payload)?.externalId;
  return value ? String(value) : null;
}

function paymentIdFromPayload(payload) {
  const value = gatewayPaymentFromPayload(payload)?.id;
  return value ? String(value) : null;
}

function eventIdFromPayload(payload, req, raw) {
  // Prefer the event identity inside the signed payload over transport headers.
  const value = payload?.id || req.get("x-billgate-delivery");
  return value ? String(value) : createHash("sha256").update(raw).digest("hex");
}

function gatewayPaymentFromPayload(payload) {
  return payload?.data?.payment || payload?.payment || null;
}

function applyBillingEvent(
  db,
  {
    eventId,
    eventType,
    orderId,
    paymentId,
    amount,
    currency,
    payload,
    raw,
    clock,
    config,
  },
) {
  return withTransaction(db, () => {
    const prior = db
      .prepare("SELECT event_id FROM billing_webhook_events WHERE event_id = ?")
      .get(eventId);
    if (prior) return { duplicate: true };
    const payment = gatewayPaymentFromPayload(payload);
    if (!payment || !payment.id || !orderId || amount === null || !currency) {
      throw new HttpError(
        400,
        "webhook must include a BillGateway payment envelope",
      );
    }
    if (currency !== "VND")
      throw new HttpError(400, "unsupported webhook currency");
    let order = db
      .prepare("SELECT * FROM billing_orders WHERE id = ?")
      .get(orderId);
    if (!order) throw new HttpError(404, "billing order was not found");
    lockWorkspaceSeats(db, order.workspace_id);
    if (db.prepare('SELECT event_id FROM billing_webhook_events WHERE event_id=?').get(eventId))
      return { duplicate: true };
    order = db.prepare('SELECT * FROM billing_orders WHERE id=?').get(orderId);
    config.plans = currentPlans(db, config.plans);
    if (order.amount !== amount || order.currency.toUpperCase() !== currency) {
      throw new HttpError(400, "webhook payment does not match billing order");
    }
    if (!paymentId || paymentId !== String(payment.id))
      throw new HttpError(400, "webhook payment id is invalid");
    if (order.provider_payment_id && order.provider_payment_id !== paymentId) {
      throw new HttpError(
        409,
        "webhook payment does not match billing order payment",
      );
    }
    db.prepare(
      `
      INSERT INTO billing_webhook_events(event_id, event_type, order_id, received_at, payload)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(
      eventId,
      String(eventType),
      order.id,
      isoNow(clock),
      raw || JSON.stringify(payload || {}),
    );
    if (paymentId && !order.provider_payment_id) {
      db.prepare(
        "UPDATE billing_orders SET provider_payment_id = ? WHERE id = ?",
      ).run(paymentId, order.id);
    }
    if (isNonExtendingEvent(eventType, payload)) {
      const normalized = normalizeEventType(eventType);
      const status = normalized.includes("refund")
        ? "refunded"
        : normalized.includes("fail")
          ? "failed"
          : "expired";
      db.prepare(
        "UPDATE billing_orders SET status = ? WHERE id = ? AND status != 'paid'",
      ).run(status, order.id);
      return { duplicate: false, extended: false, orderId: order.id };
    }
    if (!isPaidEvent(eventType, payload))
      return { duplicate: false, extended: false, orderId: order.id };
    const amountPaid = Number(payment.amountPaid ?? payment.paidAmount ?? 0);
    const paymentStatus = String(payment.status || "").toLowerCase();
    if (
      paymentStatus !== "paid" ||
      !Number.isFinite(amountPaid) ||
      amountPaid < order.amount
    ) {
      throw new HttpError(400, "paid webhook payment is not fully settled");
    }
    if (order.paid_at || order.status === "paid")
      return {
        duplicate: false,
        extended: false,
        orderId: order.id,
        alreadyPaid: true,
      };
    const subscription = db
      .prepare("SELECT * FROM subscriptions WHERE workspace_id = ?")
      .get(order.workspace_id);
    if (!subscription)
      throw new HttpError(409, "workspace subscription was not found");
    // Recheck at settlement: seats may have changed since checkout. Rejecting
    // rolls back the event too, so the same payment can be retried after cleanup.
    assertWorkspacePlanSeats(db, order.workspace_id, config.plans.find(plan => plan.id === order.plan), clock);
    const nowDate = currentDate(clock);
    const currentEnd = new Date(subscription.current_period_end);
    // Renewals carry forward time only within the same active plan. Otherwise a
    // cheap annual plan could be converted to an expensive year by buying one month.
    const sameActivePlan =
      subscription.plan === order.plan && subscription.status === "active";
    const start =
      sameActivePlan && currentEnd.getTime() > nowDate.getTime()
        ? currentEnd
        : nowDate;
    const end =
      order.cycle === "yearly"
        ? addMonthsClamped(start, 12)
        : addMonthsClamped(start, 1);
    db.prepare(
      `
      UPDATE subscriptions
      SET plan = ?, cycle = ?, status = 'active', current_period_end = ?, updated_at = ?
      WHERE workspace_id = ?
    `,
    ).run(
      order.plan,
      order.cycle,
      end.toISOString(),
      nowDate.toISOString(),
      order.workspace_id,
    );
    db.prepare(
      "UPDATE billing_orders SET status = 'paid', paid_at = ? WHERE id = ?",
    ).run(nowDate.toISOString(), order.id);
    return {
      duplicate: false,
      extended: true,
      orderId: order.id,
      currentPeriodEnd: end.toISOString(),
    };
  });
}

function smtpTransport(config) {
  if (!config.smtp || !config.smtpEnabled || !config.smtp.host) return null;
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass || "" }
      : undefined,
  });
}

export function processReminders({
  db,
  config = configFrom(),
  clock = () => new Date(),
} = {}) {
  if (!db) throw new Error("processReminders requires a database");
  const now = isoNow(clock);
  const tasks = db
    .prepare(
      `
    SELECT t.*, w.name AS workspace_name,
           tm.name AS team_name, tm.archived_at AS team_archived
    FROM tasks t
    JOIN workspaces w ON w.id = t.workspace_id
    LEFT JOIN teams tm ON tm.id = t.team_id AND tm.workspace_id = t.workspace_id
    WHERE t.deleted_at IS NULL
      AND w.suspended_at IS NULL
      AND (t.team_id IS NULL OR tm.archived_at IS NULL)
      AND t.status != 'done'
      AND t.remind_at IS NOT NULL
      AND t.remind_at <= ?
  `,
    )
    .all(now);
  const sent = [];
  for (const task of tasks) {
    const recipients = task.team_id && db.dialect !== "postgres"
      ? task.assignee_id
        ? db
            .prepare(
              `
            SELECT u.id, u.name, u.email
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id = ? AND tm.workspace_id = ?
              AND tm.user_id = ? AND u.disabled_at IS NULL
          `,
            )
            .all(task.team_id, task.workspace_id, task.assignee_id)
        : db
            .prepare(
              `
            SELECT u.id, u.name, u.email
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id = ? AND tm.workspace_id = ?
              AND u.disabled_at IS NULL
          `,
            )
            .all(task.team_id, task.workspace_id)
      : task.assignee_id
        ? db
            .prepare(
              `
            SELECT u.id, u.name, u.email
            FROM users u JOIN workspace_members wm ON wm.user_id = u.id
            WHERE wm.workspace_id = ? AND u.id = ? AND u.disabled_at IS NULL
          `,
            )
            .all(task.workspace_id, task.assignee_id)
        : db
            .prepare(
              `
            SELECT u.id, u.name, u.email
            FROM users u JOIN workspace_members wm ON wm.user_id = u.id
            WHERE wm.workspace_id = ? AND u.disabled_at IS NULL
          `,
            )
            .all(task.workspace_id);
    for(const id of extraAssigneeIds(db,task.id)){
      if(recipients.some(r=>r.id===id)||!canAccessTask(db,task.workspace_id,id,task))continue;
      const recipient=db.prepare("SELECT id,name,email FROM users WHERE id=? AND disabled_at IS NULL").get(id);if(recipient)recipients.push(recipient);
    }
    const scheduleKey = task.remind_at;
    for (const recipient of delegatedRecipients(db,task,recipients.filter(person=>canAccessTask(db,task.workspace_id,person.id,task,{action:"comment"})&&legacyReminderAllowed(db,task,person.id,now,{ignoreWorkCalendar:true})),now)) {
      if (!legacyReminderAllowed(db, task, recipient.id, now)) continue;
      const notification = withTransaction(db, () => {
        const delivery = db
          .prepare(
            `
          INSERT INTO task_reminder_deliveries
            (id, task_id, user_id, schedule_key, created_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          )
          .run(createId("delivery_"), task.id, recipient.id, scheduleKey, now);
        if (!delivery.changes) return null;
        const notificationId = createId("notification_");
        db.prepare(
          `
          INSERT INTO notifications
            (id, workspace_id, user_id, task_id, type, title, message,
             entity_type, entity_id, created_at)
          VALUES (?, ?, ?, ?, 'task_reminder', ?, ?, 'task', ?, ?)
        `,
        ).run(
          notificationId,
          task.workspace_id,
          recipient.id,
          task.id,
          "Đến hạn công việc",
          `${task.title} cần được xử lý.${task.due_at ? ` Hạn ${task.due_at}.` : ""}`,
          task.id,
          now,
        );
        db.prepare('UPDATE reminder_notice_context SET schedule_key=? WHERE notification_id=?').run(scheduleKey, notificationId);
        return notificationId;
      });
      if (!notification) continue;
      sent.push({
        taskId: task.id,
        userId: recipient.id,
        notificationId: notification,
      });

    }
  }
  const checklistItems = db
    .prepare(
      `
    SELECT i.id AS item_id, i.title AS item_title, i.remind_at, i.due_at AS item_due,
           t.id, t.workspace_id, t.team_id, ${db.dialect === "postgres" ? "t.project_id, t.imported_at," : ""} t.title, t.due_at
    FROM task_checklist_items i
    JOIN task_checklists c ON c.id = i.checklist_id
    JOIN tasks t ON t.id = c.task_id
    JOIN workspaces w ON w.id = t.workspace_id
    LEFT JOIN teams tm ON tm.id = t.team_id AND tm.workspace_id = t.workspace_id
    WHERE i.completed = 0
      AND i.remind_at IS NOT NULL
      AND i.remind_at <= ?
      AND t.deleted_at IS NULL
      AND t.status != 'done'
      AND w.suspended_at IS NULL
      AND (t.team_id IS NULL OR tm.archived_at IS NULL)
  `,
    )
    .all(now);
  for (const item of checklistItems) {
    const recipients = db
      .prepare(
        `
      SELECT u.id, u.name, u.email
      FROM task_checklist_assignees a
      JOIN users u ON u.id = a.user_id AND u.disabled_at IS NULL
      JOIN tasks t ON t.id = ?
      WHERE a.item_id = ?
        AND (t.assignee_id = a.user_id OR EXISTS (
          SELECT 1 FROM task_assignees extra
          WHERE extra.task_id = t.id AND extra.user_id = a.user_id
        ))
    `,
      )
      .all(item.id, item.item_id)
      .filter((recipient) => canAccessTask(db, item.workspace_id, recipient.id, item, {action:"comment"}));
    const scheduleKey = `checklist:${item.item_id}:${item.remind_at}`;
    for (const recipient of recipients) {
      if (!legacyReminderAllowed(db, item, recipient.id, now)) continue;
      const notification = withTransaction(db, () => {
        const delivery = db
          .prepare(
            `
          INSERT INTO task_reminder_deliveries
            (id, task_id, user_id, schedule_key, created_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          )
          .run(createId("delivery_"), item.id, recipient.id, scheduleKey, now);
        if (!delivery.changes) return null;
        const notificationId = createId("notification_");
        db.prepare(
          `
          INSERT INTO notifications
            (id, workspace_id, user_id, task_id, type, title, message,
             entity_type, entity_id, created_at)
          VALUES (?, ?, ?, ?, 'task_reminder', ?, ?, 'task', ?, ?)
        `,
        ).run(
          notificationId,
          item.workspace_id,
          recipient.id,
          item.id,
          "Đến hạn mục checklist",
          `${item.item_title} trong “${item.title}” cần được xử lý.`,
          item.id,
          now,
        );
        db.prepare('UPDATE reminder_notice_context SET schedule_key=? WHERE notification_id=?').run(scheduleKey, notificationId);
        return notificationId;
      });
      if (!notification) continue;
      sent.push({ taskId: item.id, userId: recipient.id, notificationId: notification, checklistItemId: item.item_id });

    }
  }
  sent.push(...processWorkflowReminders({db,clock}));
  return sent;
}

// All completion entrypoints create the same single successor inside their transaction.
function createRecurringSuccessor(db, task, actorUserId, now) {
  if (task.recurrence === "none") return null;
  const options = storedRecurrenceOptions(task);
  let due = nextRecurrenceDate(task.due_at, task.recurrence, options, now, task.recurrence_anchor);
  if(due && db.dialect === "postgres" && hasWorkspaceEntitlement(db,db.projectConfig,task.workspace_id,"work_calendar",()=>new Date(now))) { due=nextWorkingOccurrence(task,options,now,getWorkCalendar(db,task.workspace_id)); if(!due) throw new HttpError(409,"Lịch làm việc không có mốc hợp lệ cho kỳ tiếp theo; hãy sửa lịch trước khi hoàn thành"); }
  if (!due) return null;
  const remind = task.remind_at
    ? new Date(Date.parse(task.remind_at) + due.getTime() - Date.parse(task.due_at)).toISOString()
    : null;
  const id = createId("task_");
  const column = resolveTaskColumn(db, { workspaceId: task.workspace_id, teamId: task.team_id, projectId: task.project_id, status: "todo", clock: () => new Date(now), HttpError });
  const inserted = db.prepare(`INSERT INTO tasks
    (id,workspace_id,${task.project_id ? "project_id," : ""}title,description,status,priority,due_at,remind_at,assignee_id,customer_id,team_id,
     category,recurrence,recurrence_options,recurrence_anchor,generated_from_task_id,created_by,created_at,updated_at,column_id,board_position)
    VALUES (?, ?,${task.project_id ? ' ?,' : ''}?,?,'todo',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT DO NOTHING`)
    .run(id,task.workspace_id,...(task.project_id ? [task.project_id] : []),task.title,task.description,task.priority,due.toISOString(),remind,
      task.assignee_id,task.customer_id,task.team_id,task.category,task.recurrence,
      JSON.stringify(options),options.basis === "completion" ? due.toISOString() : task.recurrence_anchor || task.due_at,task.id,actorUserId,now,now,column.id);
  if (!inserted.changes) return null;
  copyRecurringExtras(db, task.id, id, now);
  return id;
}

// Status changes made by the board use the same completion and recurrence
// rules as the conventional task PATCH endpoint. The caller owns the outer
// transaction; this helper only performs the lifecycle work inside it.
export function applyTaskStatusTransition({
  db,
  task,
  nextStatus,
  actorUserId,
  now,
}) {
  if (task && db.dialect === 'postgres') task = db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=? AND deleted_at IS NULL FOR UPDATE').get(task.id, task.workspace_id);
  if (!task || task.status === nextStatus) return { nextTaskId: null, updatedTask: task };
  db.prepare(
    `UPDATE tasks SET status = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).run(nextStatus, now, task.id, task.workspace_id);
  const updatedTask = db
    .prepare("SELECT * FROM tasks WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL")
    .get(task.id, task.workspace_id);
  const summary = changedTaskSummary(task, updatedTask);
  if (summary)
    recordTaskActivity(db, {
      taskId: task.id,
      actorUserId,
      action: "task_updated",
      summary,
      createdAt: now,
    });
  const nextTaskId = task.status !== "done" && nextStatus === "done"
    ? createRecurringSuccessor(db, updatedTask, actorUserId, now) : null;
  return { nextTaskId, updatedTask };
}

function createApp(options = {}) {
  const config = configFrom(options);
  config.plans = config.plans.map(planWithSeatFeature);
  const dbPath =
    options.dbPath ||
    join(resolve(options.dataDir || config.env.NHACTOI_DATA_DIR || "data"), "storage");
  const db =
    options.db ||
    openDatabase(options.databaseUrl || config.env.DATABASE_URL, { env: config.env });
  let settingsKey;
  try {
    settingsKey = loadSettingsKey({ env: config.env, dbPath, explicitKey: options.settingsKey, db });
    config._settingsKey = settingsKey;
    applyStoredSettings(config, loadStoredSettings(db, settingsKey));
  } catch (error) {
    if (!options.db) db.close();
    throw error;
  }
  const clock = options.clock || (() => new Date());
  const app = express();
  // The documented EnvKit/aaPanel proxy connects over loopback. Trust only
  // that hop so public clients cannot spoof IPs and all users do not share
  // the proxy's address for registration/recovery throttling.
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  const mobilePushTransport =
    options.mobilePushTransport ||
    options.fcmTransport ||
    options.notificationTransport ||
    createFcmTransport(config);
  const browserPush = webPushConfig(config.env);
  app.locals.processWebPush = () => processWebPush({ db, clock, transport: options.webPushTransport || browserPush.transport });
  app.locals.db = db;
  db.projectConfig = config;
  db.projectClock = clock;
  app.locals.config = config;
  app.locals.clock = clock;
  app.locals.processReminders = () => processReminders({ db, config, clock });
  app.locals.processReminderEmails = () => processReminderEmails({ db, clock, transport: options.reminderEmailTransport || smtpTransport(config), from: config.smtp?.from, publicAppUrl: config.publicAppUrl });
  app.locals.processNotificationOutbox = () =>
    processNotificationOutbox({ db, clock, transport: mobilePushTransport });

  // Catalog edits apply to subsequent requests in every API process, including
  // session refresh, checkout and billing callbacks.
  app.use((req, res, next) => {
    try { config.plans = currentPlans(db, config.plans); next(); }
    catch (error) { next(error); }
  });

  // The BillGateway webhook must be authenticated against the exact raw body.
  app.post(
    "/api/billing/webhook",
    express.raw({ type: () => true, limit: "1mb" }),
    (req, res, next) => {
      try {
        const raw = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(String(req.body || ""));
        if (
          !hmacMatches(
            raw,
            req.get("x-billgate-signature") || req.get("x-billing-signature"),
            config.webhookSecret,
          )
        ) {
          return fail(res, 401, "invalid webhook signature");
        }
        let payload;
        try {
          payload = JSON.parse(raw.toString("utf8"));
        } catch {
          return fail(res, 400, "webhook body must be valid JSON");
        }
        const headerEvent = firstValue(
          req.get("x-billgate-event"),
          req.get("x-event"),
        );
        const bodyEvent = firstValue(payload.event, payload.type, payload.name);
        if (
          headerEvent &&
          bodyEvent &&
          normalizeEventType(headerEvent) !== normalizeEventType(bodyEvent)
        ) {
          return fail(
            res,
            400,
            "webhook event header does not match the signed body",
          );
        }
        const eventType = firstValue(headerEvent, bodyEvent, "unknown");
        const eventId = eventIdFromPayload(payload, req, raw);
        if (
          config.gatewayProjectId &&
          (String(payload?.project?.id || "") !== config.gatewayProjectId ||
            String(payload?.data?.payment?.projectId || "") !==
              config.gatewayProjectId)
        ) {
          return fail(
            res,
            403,
            "webhook project does not match this application",
          );
        }
        const result = applyBillingEvent(db, {
          eventId,
          eventType,
          orderId: orderIdFromPayload(payload),
          paymentId: paymentIdFromPayload(payload),
          amount: amountFromPayload(payload),
          currency: currencyFromPayload(payload),
          payload,
          raw: raw.toString("utf8"),
          clock,
          config,
        });
        return res.json({ ok: true, ...result });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.use(publicApiErrorEnvelope);
  app.use(express.json({ limit: JSON_BODY_LIMIT_BYTES, verify: (req, _res, buffer) => { if (req.path === '/api/integrations/zalo-oa/callback') req.zaloRawBody = Buffer.from(buffer); } }));
  app.use((req, res, next) => {
    try {
      if (
        req.path.startsWith("/api/") &&
        ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) &&
        req.path !== "/api/billing/webhook"
        && req.path !== "/api/integrations/google-calendar/watch"
        && req.path !== "/api/integrations/zalo-oa/callback"
      )
        assertOrigin(req, config);
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use((req, res, next) => {
    try {
      const bearer = parseBearer(req.headers.authorization);
      const cookieToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      // Bearer credentials are reserved for mobile sessions.  A cookie keeps
      // the existing web session semantics, and a malformed/expired bearer
      // never falls back to a cookie from a different browser session.
      const token = bearer || cookieToken;
      req.auth = bearer
        ? authContext(db, bearer, clock, "mobile")
        : authContext(db, cookieToken, clock, "web");
      req.sessionToken = token;
      req.mobileToken = bearer;
      next();
    } catch (error) {
      next(error);
    }
  });

  registerPublicApi(app,{db,config,clock,settingsKey,requireAuth,ensureWritable,HttpError,writeAdminAudit});
  registerWebhooks(app,{db,config,clock,requireAuth,ensureWritable,HttpError,settingsKey,loadStoredSettings,writeStoredSetting,writeAdminAudit,transport:options.webhookTransport,lookup:options.webhookLookup});
  registerTaskMutationPipeline(app, { db, clock, ensureWritable, requireAuth, HttpError });
  registerWebPushRoutes(app, { db, clock, requireAuth, HttpError, config: browserPush, withTransaction });
  registerPersonalTaskRoutes(app, { db, clock, requireAuth, ensureWritable, HttpError, taskJson });
  registerProjectRoutes(app, { db, clock, config, requireAuth, ensureWritable, HttpError, withTransaction });
  registerProjectAdvancedRoutes(app, { db, clock, config, requireAuth, ensureWritable, HttpError, withTransaction, taskJson });
  registerImportRoutes(app, { db, clock, config, requireAuth, ensureWritable, HttpError, withTransaction });
  registerReminderRoutes(app, { db, clock, requireAuth, ensureWritable, HttpError, withTransaction });
  registerAppearanceRoutes(app, { db, requireAuth, HttpError });
  registerAiAssistantRoutes(app, {
    db, clock, config, requireAuth, requirePlatformAdmin, ensureWritable, HttpError,
    withTransaction, writeStoredSetting, loadStoredSettings, settingsKey, writeAdminAudit,
    taskRowsFiltered, fetchImpl: options.aiFetch, startWorker: Boolean(options.startWorker),
    sourceReader: options.aiSourceReader, sourceOptions: options.aiSourceOptions,
    refreshAuth: req => authContext(db, req.sessionToken, clock, req.auth.sessionKind),
  });

  registerTicketRoutes(app, {
    db,
    clock,
    withTransaction,
    requireAuth,
    requirePlatformAdmin,
    HttpError,
    fail,
    isoNow,
    writeAdminAudit,
  });

  registerTeamRoutes(app, {
    db,
    clock,
    withTransaction,
    requireAuth,
    ensureWritable,
    HttpError,
    fail,
    taskJson,
  });

  registerBoardRoutes(app, {
    db,
    clock,
    withTransaction,
    requireAuth,
    ensureWritable,
    HttpError,
    fail,
    taskJson,
    transitionTaskStatus: applyTaskStatusTransition,
    recordTaskActivity,
  });

  registerRemoteStorageRoutes(app,{db,clock,requirePlatformAdmin,HttpError,withTransaction,writeAdminAudit,settingsKey,writeStoredSetting,loadStoredSettings,adapter:options.remoteStorageAdapter});
  registerTaskFileRoutes(app, {
    db, dbPath, clock, isoNow, withTransaction, requireAuth,
    requirePlatformAdmin, ensureWritable, HttpError, fail,
    canAccessTeamTask, writeAdminAudit,
  });

  registerBackupRoutes(app,{db,dbPath,clock,requirePlatformAdmin,withTransaction,writeAdminAudit,HttpError});
  registerGoogleRoutes(app,{db,config,clock,requirePlatformAdmin,requireAuth,HttpError,withTransaction,writeStoredSetting,loadStoredSettings,settingsKey,writeAdminAudit,createSession,setSessionCookie});
  registerGoogleCalendar(app,{db,config,clock,requireAuth,requirePlatformAdmin,ensureWritable,HttpError,writeStoredSetting,loadStoredSettings,settingsKey,recordTaskActivity,writeAdminAudit,transport:options.googleCalendarTransport});
  registerZaloOa(app,{db,config,clock,requireAuth,ensureWritable,HttpError,writeStoredSetting,loadStoredSettings,settingsKey,transport:options.zaloOaTransport,liveSendEnabled:(options.env?.ZALO_OA_LIVE_SEND_ENABLED??process.env.ZALO_OA_LIVE_SEND_ENABLED)==='true',fetchImpl:options.zaloOaFetch});
  registerEventRoutes(app,{db,clock,requireAuth,ensureWritable,withTransaction,HttpError});
  registerBoardTransferRoutes(app,{db,clock,requireAuth,ensureWritable,withTransaction,HttpError});
  app.locals.processEventReminders=()=>processEventReminders({db,clock});
  registerCollaborationRoutes(app,{db,clock,requireAuth,ensureWritable,withTransaction,HttpError});
  registerServiceRoutes(app,{db,clock,requireAuth,ensureWritable,withTransaction,HttpError});
  if(db.dialect==='postgres')registerOperationsDashboard(app,{db,clock,requireAuth,HttpError});
  if(db.dialect==='postgres'){registerWorkCalendarRoutes(app,{db,clock,config,requireAuth,ensureWritable,HttpError,withTransaction});registerTimeRoutes(app,{db,clock,config,requireAuth,ensureWritable,HttpError});registerWorkReports(app,{db,clock,config,requireAuth,ensureWritable,HttpError});}
  registerAutomationRoutes(app,{db,clock,requireAuth,ensureWritable,withTransaction,HttpError,transitionTaskStatus:applyTaskStatusTransition});
  app.locals.processServiceReminders = () => processServiceReminders({db,clock});

  registerTaskExtrasRoutes(app,{db,clock,isoNow,withTransaction,requireAuth,ensureWritable,HttpError,fail,recordTaskActivity});
  registerTaskDetailRoutes(app, {
    db,
    clock,
    isoNow,
    withTransaction,
    requireAuth,
    ensureWritable,
    HttpError,
    fail,
    cleanString,
    taskJson,
    canAccessTeamTask,
  });

  registerTrashRoutes(app, {
    requireAuth,
    ensureWritable,
    withTransaction,
    HttpError,
    fail,
    isoNow,
  });

  const limitAuthRequests = authRequestLimiter({ db, clock, settingsKey, withTransaction, HttpError });
  const limitLogin = [
    // The per-email bucket spans IPs, so a distributed guesser gets at most
    // 20 attempts per account every 15 minutes.
    limitAuthRequests("login", { ipLimit: 30, windowMs: 60_000, emailLimits: [{ limit: 20, windowMs: 15 * 60_000 }] }),
    authRateLimiter({ db, clock, settingsKey }),
  ];
  registerMobileRoutes(app, {
    db,
    config,
    clock,
    requireAuth,
    authRateLimiter: limitLogin,
    HttpError,
    withTransaction,
    authContext,
    setSessionCookie,
  });

  // Recovery and email-change codes share one mailer so tests can read both.
  const accountMailTransport = () => options.passwordResetTransport || smtpTransport(config);
  registerPasswordResetRoutes(app, {
    db, clock, config, settingsKey, withTransaction, HttpError,
    emailValue, passwordValue, clearSessionCookie,
    limit: limitAuthRequests,
    transport: accountMailTransport,
  });
  registerEmailChangeRoutes(app, {
    db, clock, config, settingsKey, withTransaction, HttpError,
    requireAuth, emailValue,
    limit: limitAuthRequests,
    transport: accountMailTransport,
  });

  app.post(["/api/auth/register", "/api/mobile/auth/register"],
    limitAuthRequests("register", { ipLimit: 20, windowMs: 60 * 60_000 }), (req, res, next) => {
    try {
      const mobile = req.path === "/api/mobile/auth/register";
      // Older web/mobile clients omit accountType and keep creating a team workspace.
      const accountType = req.body?.accountType ?? "team";
      if (!["personal", "team"].includes(accountType))
        throw new HttpError(400, "Loại tài khoản không hợp lệ.");
      if (accountType === "personal" && db.dialect !== "postgres")
        throw new HttpError(400, "Không gian cá nhân cần PostgreSQL.");
      const personal = accountType === "personal";
      if (["name", "email", "password", ...(personal ? [] : ["workspaceName"])].some((key) => typeof req.body?.[key] !== "string"))
        throw new HttpError(400, personal
          ? "Vui lòng nhập đầy đủ họ tên, email và mật khẩu."
          : "Vui lòng nhập đầy đủ họ tên, email, mật khẩu và tên không gian.");
      const name = cleanString(req.body?.name, {
        required: true,
        max: 120,
        field: "name",
      });
      const email = emailValue(req.body?.email);
      const password = passwordValue(req.body?.password);
      const workspaceName = personal ? null : cleanString(req.body?.workspaceName, {
        required: true,
        max: 160,
        field: "workspaceName",
      });
      const industry = personal ? "" : cleanString(req.body?.industry, {
        max: 120,
        field: "industry",
      });
      const now = isoNow(clock);
      const expires = addDays(currentDate(clock), 14).toISOString();
      let created;
      withTransaction(db, () => {
        if (db.prepare("SELECT id FROM users WHERE email = ?").get(email))
          throw new HttpError(409, "email is already registered");
        const userId = createId("user_");
        db.prepare(
          "INSERT INTO users(id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(userId, name, email, hashPassword(password), now);
        if (personal) {
          created = { userId, workspaceId: createPersonalWorkspace(db, { userId, now, createId }) };
          return;
        }
        const workspaceId = createId("workspace_");
        db.prepare(
          "INSERT INTO workspaces(id, name, industry, created_at) VALUES (?, ?, ?, ?)",
        ).run(workspaceId, workspaceName, industry, now);
        db.prepare(
          `INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
        ).run(workspaceId, userId, now);
        db.prepare(
          `
          INSERT INTO subscriptions(workspace_id, plan, cycle, status, current_period_end, updated_at)
          VALUES (?, 'starter', 'monthly', 'trialing', ?, ?)
        `,
        ).run(workspaceId, expires, now);
        created = { userId, workspaceId };
      });
      const session = createSession(
        db,
        created.userId,
        created.workspaceId,
        config,
        clock,
        { kind: mobile ? "mobile" : "web" },
      );
      if (!mobile) setSessionCookie(res, session.token, config);
      const auth = authContext(db, session.token, clock);
      return res.status(201).json({
        ...(mobile ? { token: session.token, expiresAt: session.expires } : {}),
        user: auth.user,
        workspace: auth.workspace,
        subscription: subscriptionJson(
          getSubscription(db, created.workspaceId),
          clock,
          config.plans,
        ),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    "/api/auth/login",
    limitLogin,
    (req, res, next) => {
      try {
        const email = emailValue(req.body?.email);
        const password = String(req.body?.password ?? "");
        const user = db
          .prepare("SELECT * FROM users WHERE email = ?")
          .get(email);
        if (!user || !verifyPassword(password, user.password_hash)) {
          req.noteAuthFailure?.();
          return fail(res, 401, "email or password is incorrect");
        }
        if (user.disabled_at) {
          req.clearAuthFailures?.();
          return fail(res, 403, "user account is disabled");
        }
        const membership = db
          .prepare(
            `
        SELECT wm.workspace_id FROM workspace_members wm
        WHERE wm.user_id = ? ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
        LIMIT 1
      `,
          )
          .get(user.id);
        if (!membership)
          return fail(res, 403, "user has no workspace membership");
        const remember =
          req.body?.remember === false ||
          req.body?.remember === "false" ||
          req.body?.remember === 0
            ? false
            : true;
        const session = createSession(
          db,
          user.id,
          membership.workspace_id,
          config,
          clock,
          { kind: "web", days: remember ? null : 1 },
        );
        req.clearAuthFailures?.();
        setSessionCookie(
          res,
          session.token,
          config,
          remember ? config.sessionDays * 86400 : null,
        );
        const auth = authContext(db, session.token, clock);
        return res.json({
          user: auth.user,
          workspace: auth.workspace,
          subscription: subscriptionJson(
            getSubscription(db, membership.workspace_id),
            clock,
          config.plans,
          ),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post("/api/auth/logout", (req, res, next) => {
    try {
      if (req.sessionToken)
        invalidateSessions(db, { tokenHash: hashToken(req.sessionToken) });
      clearSessionCookie(res, config);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/auth/dev-accounts", (req, res, next) => {
    try {
      if (!config.devLoginEnabled) {
        return res.json({ enabled: false, accounts: [] });
      }
      try {
        seedDemo({ db, clock });
      } catch {}
      const accounts = [
        {
          name: "Lê Dũng",
          email: DEMO_EMAILS[0],
          role: "Chủ không gian",
          roleKey: "owner",
          badge: "Owner",
        },
        {
          name: "Nguyễn An",
          email: DEMO_EMAILS[1],
          role: "Quản trị viên",
          roleKey: "admin",
          badge: "Admin",
        },
        {
          name: "Trần Minh",
          email: DEMO_EMAILS[2],
          role: "Thành viên",
          roleKey: "member",
          badge: "Member",
        },
      ];
      return res.json({
        enabled: true,
        accounts,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/auth/dev-login", (req, res, next) => {
    try {
      if (!config.devLoginEnabled) {
        return fail(res, 404, "not found");
      }
      const email = emailValue(req.body?.email || DEMO_EMAILS[0]);
      if (!DEMO_EMAILS.includes(email)) {
        return fail(res, 404, "dev user not found");
      }
      try {
        seedDemo({ db, clock });
      } catch {}
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
      if (!user) {
        return fail(res, 404, "dev user not found");
      }
      if (user.disabled_at) {
        return fail(res, 403, "user account is disabled");
      }
      const membership = db
        .prepare(
          `
        SELECT wm.workspace_id FROM workspace_members wm
        WHERE wm.user_id = ? ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
        LIMIT 1
      `,
        )
        .get(user.id);
      if (!membership) {
        return fail(res, 403, "user has no workspace membership");
      }
      const session = createSession(
        db,
        user.id,
        membership.workspace_id,
        config,
        clock,
        { kind: "web", days: config.sessionDays },
      );
      setSessionCookie(
        res,
        session.token,
        config,
        config.sessionDays * 86400,
      );
      const auth = authContext(db, session.token, clock);
      return res.json({
        user: auth.user,
        workspace: auth.workspace,
        subscription: subscriptionJson(
          getSubscription(db, membership.workspace_id),
          clock,
          config.plans,
        ),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/me", requireAuth, (req, res, next) => {
    try {
      return res.json({
        user: req.auth.user,
        workspace: req.auth.workspace,
        subscription: subscriptionJson(
          getSubscription(db, req.auth.workspaceId),
          clock,
          config.plans,
        ),
        billingConfigured: config.billingConfigured,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/me", requireAuth, (req, res, next) => {
    try {
      const body = req.body;
      if (body && typeof body === "object" && !Array.isArray(body) && "email" in body)
        throw new HttpError(400, "Email được đổi qua bước xác nhận riêng trong mục Tài khoản.");
      if (
        !body || typeof body !== "object" || Array.isArray(body) ||
        !Object.keys(body).length ||
        Object.keys(body).some((key) => key !== "name")
      ) {
        throw new HttpError(400, "Chỉ có thể cập nhật họ tên.");
      }
      if (typeof body.name !== "string")
        throw new HttpError(400, "Họ tên phải là văn bản.");
      const name = cleanString(body.name, { required: true, max: 120, field: "name" });
      db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.auth.userId);
      return res.json({ user: { ...req.auth.user, name } });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/overview", requirePlatformAdmin, (req, res, next) => {
    try {
      return res.json(adminOverviewData(db, config, clock));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/workspaces", requirePlatformAdmin, (req, res, next) => {
    try {
      const params = adminListParams(req, new Set(["active", "suspended"]));
      return res.json(adminWorkspacePage(db, params, clock));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/workspaces/:id", requirePlatformAdmin, (req, res, next) => {
    try {
      return res.json(adminWorkspaceDetailData(db, req.params.id, clock));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/users", requirePlatformAdmin, (req, res, next) => {
    try {
      const params = adminListParams(req, new Set(["active", "disabled", "admin"]));
      return res.json(adminUserPage(db, params));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/users/:id", requirePlatformAdmin, (req, res, next) => {
    try {
      return res.json(adminUserDetailData(db, req.params.id, clock));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/subscriptions", requirePlatformAdmin, (req, res, next) => {
    try {
      const params = adminListParams(req, ADMIN_SUBSCRIPTION_STATUSES);
      return res.json(adminSubscriptionPage(db, params, clock));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/orders", requirePlatformAdmin, (req, res, next) => {
    try {
      const params = adminListParams(req, ADMIN_ORDER_STATUSES);
      return res.json(adminOrderPage(db, params));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/audit", requirePlatformAdmin, (req, res, next) => {
    try {
      const params = adminListParams(req, new Set());
      return res.json(adminAuditPage(db, params));
    } catch (error) {
      return next(error);
    }
  });

  function adminPlansData() {
    const counts = new Map(db.prepare(
      "SELECT plan, COUNT(*) AS total FROM subscriptions GROUP BY plan",
    ).all().map((row) => [row.plan, Number(row.total)]));
    return { plans: config.plans.map((plan) => ({
      ...adminPlanJson(plan), subscriptionCount: counts.get(plan.id) || 0,
    })) };
  }
  app.get("/api/admin/plans", requirePlatformAdmin, (req, res, next) => {
    try { return res.json(adminPlansData()); } catch (error) { return next(error); }
  });
  function saveAdminPlan(req, res, next) {
    try {
      const body = req.body || {};
      const reason = adminReason(body.reason);
      const creating = req.method === "POST";
      const id = creating
        ? cleanString(body.id, { required: true, max: 20, field: "plan.id" })
        : req.params.id;
      let plans;
      const updatedAt = isoNow(clock);
      withTransaction(db, () => {
      lockPlanSeatChanges(db);
      config.plans = currentPlans(db, config.plans);
      const current = config.plans.find((plan) => plan.id === id);
      if (creating && current) throw new HttpError(409, "Mã gói đã tồn tại");
      if (!creating && !current) throw new HttpError(404, "Không tìm thấy gói thuê bao");
      if (!creating && body.id !== undefined && body.id !== id)
        throw new HttpError(400, "Không thể đổi mã gói đã tạo");
      const input = { ...(current ? adminPlanJson(current) : {}), ...body, id };
      const values = config.plans.map((plan) => plan.id === id ? input : adminPlanJson(plan));
      if (creating) values.push(input);
      plans = settingsPlanValues(config, values);
      const saved = plans.find((plan) => plan.id === id);
        assertPlanSeatChanges(db, [saved], clock);
        writeStoredSetting(db, "plans", plans, { updatedAt });
        writeAdminAudit(db, {
          actorUserId: req.auth.userId,
          action: creating ? "plan.create" : "plan.update",
          targetType: "plan", targetId: id, reason,
          before: current ? adminPlanJson(current) : {},
          after: adminPlanJson(saved), createdAt: updatedAt,
        });
      });
      config.plans = plans;
      config.settingsSource.plans = "database";
      config._storedSettings.set("plans", jsonSetting(plans));
      return res.status(creating ? 201 : 200).json(adminPlansData());
    } catch (error) { return next(error); }
  }
  app.post("/api/admin/plans", requirePlatformAdmin, saveAdminPlan);
  app.patch("/api/admin/plans/:id", requirePlatformAdmin, saveAdminPlan);

  app.get("/api/admin/settings", requirePlatformAdmin, (req, res, next) => {
    try {
      return res.json(adminSettingsData(config));
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/admin/settings", requirePlatformAdmin, (req, res, next) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const reason = adminReason(body.reason);
      const hasPublicAppUrl = body.publicAppUrl !== undefined;
      const hasPlans = body.plans !== undefined;
      const hasGateway = body.billgateway !== undefined;
      const hasSmtp = body.smtp !== undefined;
      if (!hasPublicAppUrl && !hasPlans && !hasGateway && !hasSmtp)
        throw new HttpError(400, "no settings changes were supplied");
      if (hasGateway && (!body.billgateway || typeof body.billgateway !== "object" || Array.isArray(body.billgateway)))
        throw new HttpError(400, "billgateway is invalid");
      if (hasSmtp && (!body.smtp || typeof body.smtp !== "object" || Array.isArray(body.smtp)))
        throw new HttpError(400, "smtp is invalid");

      const previous = settingsSnapshot(config);
      const stored = new Map(config._storedSettings || []);
      const source = { ...config.settingsSource };
      const next = {
        publicAppUrl: config.publicAppUrl,
        plans: config.plans.map((plan) => ({
          ...plan,
          features: Array.isArray(plan.features) ? [...plan.features] : [],
        })),
        gatewayApiUrl: config.gatewayApiUrl,
        gatewayUrl: config.gatewayUrl,
        gatewayProjectId: config.gatewayProjectId,
        gatewayApiKey: config.gatewayApiKey,
        webhookSecret: config.webhookSecret,
        smtp: config.smtp ? { ...config.smtp } : null,
        smtpEnabled: config.smtpEnabled,
      };
      const plainWrites = [];
      const secretWrites = [];

      if (hasPublicAppUrl) {
        next.publicAppUrl = httpUrlValue(body.publicAppUrl, "publicAppUrl", {
          required: true,
          max: 500,
        });
        plainWrites.push(["publicAppUrl", next.publicAppUrl]);
        source.publicAppUrl = "database";
      }
      if (hasPlans) {
        next.plans = settingsPlanValues(config, body.plans);
        plainWrites.push(["plans", next.plans]);
        source.plans = "database";
      }
      if (hasGateway) {
        const gateway = body.billgateway;
        if (gateway.apiUrl !== undefined) {
          next.gatewayApiUrl = httpUrlValue(gateway.apiUrl, "billgateway.apiUrl", {
            max: 500,
          });
          next.gatewayUrl = next.gatewayApiUrl;
          plainWrites.push(["billgateway.apiUrl", next.gatewayApiUrl]);
        }
        if (gateway.projectId !== undefined) {
          next.gatewayProjectId = cleanString(gateway.projectId, {
            max: 160,
            field: "billgateway.projectId",
          });
          plainWrites.push(["billgateway.projectId", next.gatewayProjectId]);
        }
        for (const [field, clearField, settingKey] of [
          ["apiKey", "clearApiKey", "billgateway.apiKey"],
          ["webhookSecret", "clearWebhookSecret", "billgateway.webhookSecret"],
        ]) {
          const hasValue = gateway[field] !== undefined && gateway[field] !== "";
          const clear = gateway[clearField] === true;
          if (gateway[clearField] !== undefined && typeof gateway[clearField] !== "boolean")
            throw new HttpError(400, `${clearField} must be true or false`);
          if (hasValue && clear)
            throw new HttpError(400, `${field} and ${clearField} cannot be used together`);
          if (hasValue) {
            const value = secretSettingValue(
              gateway[field],
              `billgateway.${field}`,
              500,
            );
            next[field === "apiKey" ? "gatewayApiKey" : "webhookSecret"] = value;
            secretWrites.push([settingKey, value]);
          } else if (clear) {
            next[field === "apiKey" ? "gatewayApiKey" : "webhookSecret"] = "";
            secretWrites.push([settingKey, ""]);
          }
        }
        source.billgateway = "database";
      }
      if (hasSmtp) {
        const smtp = body.smtp;
        if (!next.smtp) next.smtp = {};
        if (smtp.host !== undefined)
          next.smtp.host = cleanString(smtp.host, { max: 255, field: "smtp.host" });
        if (smtp.port !== undefined) {
          const port = Number(smtp.port);
          if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
            throw new HttpError(400, "smtp.port is invalid");
          next.smtp.port = port;
        }
        if (smtp.secure !== undefined) {
          if (typeof smtp.secure !== "boolean")
            throw new HttpError(400, "smtp.secure must be true or false");
          next.smtp.secure = smtp.secure;
        }
        if (smtp.user !== undefined)
          next.smtp.user = cleanString(smtp.user, { max: 320, field: "smtp.user" });
        if (smtp.from !== undefined)
          next.smtp.from = cleanString(smtp.from, {
            max: 320,
            field: "smtp.from",
          });
        if (smtp.enabled !== undefined) {
          if (typeof smtp.enabled !== "boolean")
            throw new HttpError(400, "smtp.enabled must be true or false");
          next.smtpEnabled = smtp.enabled;
        }
        if (next.smtp.host && next.smtpEnabled && !next.smtp.from)
          throw new HttpError(400, "smtp.from is required when SMTP is enabled");
        const hasPassword = smtp.password !== undefined && smtp.password !== "";
        const clearPassword = smtp.clearPassword === true;
        if (smtp.clearPassword !== undefined && typeof smtp.clearPassword !== "boolean")
          throw new HttpError(400, "clearPassword must be true or false");
        if (hasPassword && clearPassword)
          throw new HttpError(400, "password and clearPassword cannot be used together");
        if (hasPassword) {
          const password = secretSettingValue(smtp.password, "smtp.password");
          next.smtp.pass = password;
          secretWrites.push(["smtp.password", password]);
        } else if (clearPassword) {
          next.smtp.pass = "";
          secretWrites.push(["smtp.password", ""]);
        }
        if (smtp.host !== undefined)
          plainWrites.push(["smtp.host", next.smtp.host || ""]);
        if (smtp.port !== undefined) plainWrites.push(["smtp.port", next.smtp.port]);
        if (smtp.secure !== undefined) plainWrites.push(["smtp.secure", next.smtp.secure]);
        if (smtp.user !== undefined) plainWrites.push(["smtp.user", next.smtp.user || ""]);
        if (smtp.from !== undefined) plainWrites.push(["smtp.from", next.smtp.from || ""]);
        if (smtp.enabled !== undefined) plainWrites.push(["smtp.enabled", next.smtpEnabled]);
        source.smtp = "database";
      }
      next.billingConfigured = Boolean(
        next.gatewayApiUrl && next.gatewayApiKey && next.webhookSecret,
      );
      const projectedConfig = {
        ...config,
        ...next,
        settingsSource: source,
      };
      const after = settingsSnapshot(projectedConfig);
      const afterAudit = {
        publicAppUrl: after.publicAppUrl,
        plans: after.plans,
        billgateway: after.billgateway,
        smtp: after.smtp,
      };
      if (secretWrites.length)
        afterAudit.changedSecretFields = secretWrites.map(([key]) => key);
      withTransaction(db, () => {
        if (hasPlans) {
          lockPlanSeatChanges(db);
          config.plans = currentPlans(db, config.plans);
          next.plans = settingsPlanValues(config, body.plans);
          assertPlanSeatChanges(db, next.plans, clock);
          plainWrites.find(([key]) => key === 'plans')[1] = next.plans;
          afterAudit.plans = next.plans.map(adminPlanJson);
        }
        const updatedAt = isoNow(clock);
        for (const [key, value] of plainWrites)
          writeStoredSetting(db, key, value, { updatedAt });
        for (const [key, value] of secretWrites)
          writeStoredSetting(db, key, value, {
            encrypted: true,
            keyBytes: settingsKey,
            updatedAt,
          });
        writeAdminAudit(db, {
          actorUserId: req.auth.userId,
          action: "settings.update",
          targetType: "settings",
          targetId: "global",
          reason,
          before: {
            publicAppUrl: previous.publicAppUrl,
            plans: previous.plans,
            billgateway: previous.billgateway,
            smtp: previous.smtp,
          },
          after: afterAudit,
          createdAt: updatedAt,
        });
      });
      for (const [key, value] of plainWrites) stored.set(key, jsonSetting(value));
      for (const [key, value] of secretWrites) stored.set(key, jsonSetting(value));
      Object.assign(config, next, { settingsSource: source, _storedSettings: stored });
      return res.json(adminSettingsData(config));
    } catch (error) {
      return next(error);
    }
  });

  app.patch(
    "/api/admin/users/:id/profile",
    requirePlatformAdmin,
    (req, res, next) => {
      try {
        const reason = adminReason(req.body?.reason);
        let user;
        withTransaction(db, () => {
          const current = db
            .prepare("SELECT * FROM users WHERE id = ?")
            .get(req.params.id);
          if (!current) throw new HttpError(404, "Không tìm thấy người dùng");
          if (Boolean(current.is_platform_admin) && current.id !== req.auth.userId)
            throw new HttpError(403, "Không thể sửa hồ sơ admin SaaS khác; dùng CLI admin");
          const name =
            req.body?.name === undefined
              ? current.name
              : cleanString(req.body.name, {
                  required: true,
                  max: 120,
                  field: "name",
                });
          const email =
            req.body?.email === undefined
              ? current.email
              : emailValue(req.body.email);
          if (email !== current.email) {
            const duplicate = db
              .prepare("SELECT id FROM users WHERE email = ? AND id != ?")
              .get(email, current.id);
            if (duplicate) throw new HttpError(409, "email is already registered");
          }
          if (name === current.name && email === current.email)
            throw new HttpError(400, "no profile changes were supplied");
          const before = { name: current.name, email: current.email };
          const after = { name, email };
          db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(
            name,
            email,
            current.id,
          );
          // The old address may belong to someone else now; sign the account
          // out everywhere except the admin's own current session.
          if (email !== current.email)
            invalidateSessions(db, {
              userId: current.id,
              ...(current.id === req.auth.userId ? { exceptId: req.auth.sessionId } : {}),
            });
          writeAdminAudit(db, {
            actorUserId: req.auth.userId,
            action: "user.profile.update",
            targetType: "user",
            targetId: current.id,
            reason,
            before,
            after,
            createdAt: isoNow(clock),
          });
          user = adminUserJson(
            db
              .prepare(
                `
                SELECT u.id, u.name, u.email, u.is_platform_admin, u.disabled_at, u.created_at,
                       (SELECT COUNT(*) FROM workspace_members wm WHERE wm.user_id = u.id) AS workspace_count
                FROM users u WHERE u.id = ?
              `,
              )
              .get(current.id),
          );
        });
        return res.json({ user });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.patch(
    "/api/admin/workspaces/:id/profile",
    requirePlatformAdmin,
    (req, res, next) => {
      try {
        const reason = adminReason(req.body?.reason);
        let workspace;
        withTransaction(db, () => {
          const current = db
            .prepare("SELECT * FROM workspaces WHERE id = ?")
            .get(req.params.id);
          if (!current)
            throw new HttpError(404, "Không tìm thấy không gian làm việc");
          const values = workspaceProfileValues(req.body || {});
          if (!Object.keys(values).length)
            throw new HttpError(400, "no profile changes were supplied");
          const before = {
            name: current.name,
            industry: current.industry,
            contactEmail: current.contact_email || "",
            phone: current.phone || "",
            address: current.address || "",
            website: current.website || "",
            taxCode: current.tax_code || "",
            note: current.note || "",
          };
          const after = { ...before };
          const columns = {
            name: "name",
            industry: "industry",
            contactEmail: "contact_email",
            phone: "phone",
            address: "address",
            website: "website",
            taxCode: "tax_code",
            note: "note",
          };
          const assignments = [];
          const parameters = [];
          for (const [field, value] of Object.entries(values)) {
            assignments.push(`${columns[field]} = ?`);
            parameters.push(value);
            after[field] = value;
          }
          parameters.push(current.id);
          db.prepare(
            `UPDATE workspaces SET ${assignments.join(", ")} WHERE id = ?`,
          ).run(...parameters);
          writeAdminAudit(db, {
            actorUserId: req.auth.userId,
            action: "workspace.profile.update",
            targetType: "workspace",
            targetId: current.id,
            reason,
            before,
            after,
            createdAt: isoNow(clock),
          });
          workspace = workspaceProfileJson(
            db.prepare("SELECT * FROM workspaces WHERE id = ?").get(current.id),
          );
        });
        return res.json({ workspace });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.patch(
    "/api/admin/workspaces/:id",
    requirePlatformAdmin,
    (req, res, next) => {
      try {
        const suspended = adminBoolean(req.body?.suspended, "suspended");
        const reason = adminReason(req.body?.reason);
        let workspace;
        withTransaction(db, () => {
          const current = db
            .prepare("SELECT * FROM workspaces WHERE id = ?")
            .get(req.params.id);
          if (!current) throw new HttpError(404, "Không tìm thấy không gian làm việc");
          const before = { suspendedAt: current.suspended_at || null };
          const suspendedAt = suspended ? isoNow(clock) : null;
          db.prepare("UPDATE workspaces SET suspended_at = ? WHERE id = ?").run(
            suspendedAt,
            current.id,
          );
          writeAdminAudit(db, {
            actorUserId: req.auth.userId,
            action: suspended ? "workspace.suspend" : "workspace.reactivate",
            targetType: "workspace",
            targetId: current.id,
            reason,
            before,
            after: { suspendedAt },
            createdAt: isoNow(clock),
          });
          workspace = db
            .prepare(
              `
              SELECT
                w.id, w.name, w.industry, w.created_at, w.suspended_at,
                (SELECT u.name FROM workspace_members wm JOIN users u ON u.id = wm.user_id
                 WHERE wm.workspace_id = w.id AND wm.role = 'owner' ORDER BY wm.created_at ASC LIMIT 1) AS owner_name,
                (SELECT u.email FROM workspace_members wm JOIN users u ON u.id = wm.user_id
                 WHERE wm.workspace_id = w.id AND wm.role = 'owner' ORDER BY wm.created_at ASC LIMIT 1) AS owner_email,
                s.plan, s.status AS subscription_status, s.current_period_end
              FROM workspaces w LEFT JOIN subscriptions s ON s.workspace_id = w.id
              WHERE w.id = ?
            `,
            )
            .get(current.id);
        });
        return res.json({ workspace: adminWorkspaceJson(workspace, clock) });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.patch("/api/admin/users/:id", requirePlatformAdmin, (req, res, next) => {
    try {
      const disabled = adminBoolean(req.body?.disabled, "disabled");
      const reason = adminReason(req.body?.reason);
      let user;
      withTransaction(db, () => {
        const current = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
        if (!current) throw new HttpError(404, "Không tìm thấy người dùng");
        if (current.id === req.auth.userId)
          throw new HttpError(403, "Không thể khóa tài khoản đang đăng nhập");
        if (Boolean(current.is_platform_admin))
          throw new HttpError(403, "Không thể thay đổi trạng thái admin SaaS");
        const before = { disabledAt: current.disabled_at || null };
        const disabledAt = disabled ? isoNow(clock) : null;
        db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(
          disabledAt,
          current.id,
        );
        if (disabled) invalidateSessions(db, { userId: current.id });
        writeAdminAudit(db, {
          actorUserId: req.auth.userId,
          action: disabled ? "user.disable" : "user.reactivate",
          targetType: "user",
          targetId: current.id,
          reason,
          before,
          after: { disabledAt },
          createdAt: isoNow(clock),
        });
        user = adminUserJson(
          db
            .prepare(
              `
              SELECT u.id, u.name, u.email, u.is_platform_admin, u.disabled_at, u.created_at,
                     (SELECT COUNT(*) FROM workspace_members wm WHERE wm.user_id = u.id) AS workspace_count
              FROM users u WHERE u.id = ?
            `,
            )
            .get(current.id),
        );
      });
      return res.json({ user });
    } catch (error) {
      return next(error);
    }
  });

  app.patch(
    "/api/admin/subscriptions/:workspaceId",
    requirePlatformAdmin,
    (req, res, next) => {
      try {
        const reason = adminReason(req.body?.reason);
        let subscription;
        withTransaction(db, () => {
          lockWorkspaceSeats(db, req.params.workspaceId);
          config.plans = currentPlans(db, config.plans);
          const current = db
            .prepare("SELECT * FROM subscriptions WHERE workspace_id = ?")
            .get(req.params.workspaceId);
          if (!current) throw new HttpError(404, "Không tìm thấy thuê bao");
          const workspace = db
            .prepare("SELECT id, name FROM workspaces WHERE id = ?")
            .get(req.params.workspaceId);
          if (!workspace) throw new HttpError(404, "Không tìm thấy không gian làm việc");
          const plan =
            req.body?.plan === undefined
              ? current.plan
              : cleanString(req.body.plan, { required: true, max: 20, field: "plan" });
          const cycle =
            req.body?.cycle === undefined
              ? current.cycle
              : cleanString(req.body.cycle, { required: true, max: 20, field: "cycle" });
          const status =
            req.body?.status === undefined
              ? current.status
              : cleanString(req.body.status, { required: true, max: 20, field: "status" });
          if (!config.plans.some((item) => item.id === plan))
            throw new HttpError(400, "Gói dịch vụ không hợp lệ");
          if (plan !== current.plan && config.plans.find((item) => item.id === plan).active === false)
            throw new HttpError(409, "Gói thuê bao đã ngừng bán");
          if (!["monthly", "yearly"].includes(cycle))
            throw new HttpError(400, "Chu kỳ thuê bao không hợp lệ");
          if (!ADMIN_SUBSCRIPTION_STATUSES.has(status))
            throw new HttpError(400, "Trạng thái thuê bao không hợp lệ");
          const currentPeriodEnd =
            req.body?.currentPeriodEnd === undefined
              ? current.current_period_end
              : dateValue(req.body.currentPeriodEnd, "currentPeriodEnd", {
                  required: true,
                });
          const planConfig = config.plans.find((item) => item.id === plan);
          assertWorkspacePlanSeats(db, req.params.workspaceId, planConfig, clock);
          const before = {
            plan: current.plan,
            cycle: current.cycle,
            status: current.status,
            currentPeriodEnd: current.current_period_end,
          };
          const after = { plan, cycle, status, currentPeriodEnd };
          db.prepare(
            `
            UPDATE subscriptions
               SET plan = ?, cycle = ?, status = ?, current_period_end = ?, updated_at = ?
             WHERE workspace_id = ?
          `,
          ).run(plan, cycle, status, currentPeriodEnd, isoNow(clock), req.params.workspaceId);
          writeAdminAudit(db, {
            actorUserId: req.auth.userId,
            action: "subscription.update",
            targetType: "workspace",
            targetId: req.params.workspaceId,
            reason,
            before,
            after,
            createdAt: isoNow(clock),
          });
          const row = db
            .prepare(
              `
              SELECT s.workspace_id, w.name AS workspace_name, s.plan, s.cycle,
                     s.status, s.current_period_end,
                     (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = s.workspace_id) AS member_count
                FROM subscriptions s JOIN workspaces w ON w.id = s.workspace_id
               WHERE s.workspace_id = ?
            `,
            )
            .get(req.params.workspaceId);
          subscription = adminSubscriptionJson(row, clock);
        });
        return res.json({ subscription });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get("/api/dashboard", requireAuth, (req, res, next) => {
    try {
      const subscription = getSubscription(db, req.auth.workspaceId);
      const query = taskListQuery(req);
      const result = req.query.tasks === 'none' ? null : taskRowsFiltered(db, req.auth.workspaceId, req.auth.userId, query, clock);
      return res.json({
        tasks: result?.rows || [],
        taskPage: result ? { page: query.page, pageSize: query.pageSize, total: result.total, hasMore: result.offset + result.rows.length < result.total } : null,
        taskSummary: dashboardTaskSummary(db, req.auth.workspaceId, req.auth.userId, clock, req.auth.memberType === 'guest'),
        teams: req.auth.memberType === "guest" ? [] : visibleTeamRows(db, req.auth.workspaceId, req.auth.userId),
        customers: req.auth.memberType === "guest" ? [] : customerRows(db, req.auth.workspaceId),
        members: req.auth.memberType === "guest" ? [] : memberRows(db, req.auth.workspaceId),
        transactions: isRole(req.auth, ["owner", "admin"])
          ? transactionRows(db, req.auth.workspaceId)
          : [],
        notifications: notificationRows(
          db,
          req.auth.userId,
          req.auth.workspaceId,
        ),
        subscription: subscriptionJson(subscription, clock, config.plans),
        workspace: req.auth.workspace,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/tasks", requireAuth, (req, res, next) => {
    try {
      const query = taskListQuery(req);
      if (query.hasQuery) {
        const result = taskRowsFiltered(db, req.auth.workspaceId, req.auth.userId, query, clock);
        return res.json({
          tasks: result.rows,
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          hasMore: result.offset + result.rows.length < result.total,
        });
      }
      return res.json({
        tasks: taskRows(db, req.auth.workspaceId, req.auth.userId),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/workspaces", requireAuth, (req, res, next) => {
    try {
      const workspaces = db
        .prepare(
          `
        SELECT w.id, w.name, w.industry, wm.role,
               ${db.dialect === "postgres" ? "w.kind" : "'team'"} AS kind
        FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.user_id = ? ORDER BY w.kind = 'personal' DESC, w.name
      `,
        )
        .all(req.auth.userId)
        .map((row) => ({
          id: row.id,
          name: row.name,
          industry: row.industry,
          role: row.role,
          kind: row.kind,
        }));
      const canCreatePersonal = db.dialect === "postgres" && !personalWorkspaceId(db, req.auth.userId);
      return res.json({ workspaces, canCreatePersonal });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/workspaces/switch", requireAuth, (req, res, next) => {
    try {
      const workspaceId = cleanString(req.body?.workspaceId, {
        required: true,
        max: 100,
        field: "workspaceId",
      });
      const membership = db
        .prepare(
          `
        SELECT w.id, w.name, w.industry, wm.role
        FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.user_id = ? AND wm.workspace_id = ?
      `,
        )
        .get(req.auth.userId, workspaceId);
      if (!membership)
        return fail(res, 403, "you are not a member of this workspace");
      return enterWorkspace(req, res, () => workspaceId);
    } catch (error) {
      return next(error);
    }
  });

  // Creates the caller's single personal workspace and moves the session there.
  app.post("/api/workspaces/personal", requireAuth, (req, res, next) => {
    try {
      if (db.dialect !== "postgres")
        throw new HttpError(400, "Không gian cá nhân cần PostgreSQL.");
      return enterWorkspace(req, res, () => {
        if (personalWorkspaceId(db, req.auth.userId))
          throw new HttpError(409, "Bạn đã có không gian cá nhân");
        return createPersonalWorkspace(db, { userId: req.auth.userId, now: isoNow(clock), createId });
      }, 201);
    } catch (error) {
      return next(error);
    }
  });

  function enterWorkspace(req, res, resolveWorkspaceId, status = 200) {
    let session, auth, workspaceId;
    withTransaction(db, () => {
      workspaceId = resolveWorkspaceId();
      session = createSession(db, req.auth.userId, workspaceId, config, clock);
      auth = authContext(db, session.token, clock);
      if (req.sessionToken) {
        // Workspace switching rotates the cookie, while browser push belongs
        // to this browser login across all accessible workspaces.
        db.prepare('UPDATE web_push_subscriptions SET session_id=? WHERE session_id=? AND user_id=?')
          .run(auth.sessionId, req.auth.sessionId, req.auth.userId);
        invalidateSessions(db, { id: req.auth.sessionId });
      }
    });
    setSessionCookie(res, session.token, config);
    return res.status(status).json({
      user: auth.user,
      workspace: auth.workspace,
      subscription: subscriptionJson(getSubscription(db, workspaceId), clock, config.plans),
      billingConfigured: config.billingConfigured,
    });
  }

  registerTaskMutationCommand(app, "POST", "/api/tasks", requireAuth, (req) => {
      ensureWritable(req);
      const title = cleanString(req.body?.title, {
        required: true,
        max: 240,
        field: "title",
      });
      const description = cleanString(req.body?.description, {
        max: 5000,
        field: "description",
      });
      const status = cleanString(req.body?.status || "todo", {
        max: 20,
        field: "status",
      });
      const priority = cleanString(req.body?.priority || "medium", {
        max: 20,
        field: "priority",
      });
      const recurrence = cleanString(req.body?.recurrence || "none", {
        max: 20,
        field: "recurrence",
      });
      if (!STATUSES.has(status)) throw new HttpError(400, "status is invalid");
      if (!PRIORITIES.has(priority))
        throw new HttpError(400, "priority is invalid");
      if (!RECURRENCES.has(recurrence))
        throw new HttpError(400, "recurrence is invalid");
      const dueAt = dateValue(req.body?.dueAt, "dueAt");
      if (!dueAt && recurrence !== "none") throw new HttpError(400, "Công việc lặp cần có hạn hoàn thành.");
      const recurrenceOptions = validateRecurrenceOptions(recurrence, req.body?.recurrenceOptions, HttpError);
      const remindAt = dateValue(req.body?.remindAt, "remindAt");
      const assigneeId = req.body?.assigneeId
        ? cleanString(req.body.assigneeId, { max: 100, field: "assigneeId" })
        : null;
      const customerId = req.body?.customerId
        ? cleanString(req.body.customerId, { max: 100, field: "customerId" })
        : null;
      let teamId =
        req.body?.teamId === undefined ||
        req.body?.teamId === null ||
        req.body?.teamId === ""
          ? null
          : cleanString(req.body.teamId, { max: 100, field: "teamId" });
      const project = db.dialect === 'postgres' ? resolveTaskProject(db, req.auth.workspaceId, req.auth.userId, {
        projectId: req.body?.projectId, teamId, config, clock,
      }) : null;
      if (db.dialect === 'postgres' && !project) throw new HttpError(403, 'Không có quyền tạo công việc trong dự án');
      if (project) {
        if (req.body?.teamId && req.body.teamId !== project.team_id) throw new HttpError(400, 'Đội nhóm không khớp dự án');
        teamId = project.team_id;
        if (assigneeId && !canAccessTask(db, req.auth.workspaceId, assigneeId, { workspace_id: req.auth.workspaceId, project_id: project.id }))
          throw new HttpError(400, 'Người phụ trách không có quyền với dự án');
      }
      if (req.auth.memberType === 'guest' && customerId) throw new HttpError(403, 'Khách không được liên kết dữ liệu khách hàng');
      assertMemberReference(db, req.auth.workspaceId, assigneeId, customerId);
      if (teamId && !project) {
        const access = getTeamAccess(
          db,
          req.auth.workspaceId,
          req.auth.userId,
          teamId,
        );
        if (!access || !access.visible)
          throw new HttpError(403, "Bạn không có quyền truy cập đội nhóm này");
        if (access.team.archived_at)
          throw new HttpError(409, "Đội nhóm đã lưu trữ và chỉ được đọc");
        if (
          assigneeId &&
          !db
            .prepare(
              "SELECT 1 FROM team_members WHERE team_id = ? AND workspace_id = ? AND user_id = ?",
            )
            .get(teamId, req.auth.workspaceId, assigneeId)
        )
          throw new HttpError(400, "assigneeId phải thuộc đội nhóm");
      }
      const explicitColumnId =
        req.body?.columnId === undefined || req.body?.columnId === null || req.body?.columnId === ""
          ? undefined
          : cleanString(req.body.columnId, { max: 160, field: "columnId" });
      const column = resolveTaskColumn(db, {
        workspaceId: req.auth.workspaceId,
        teamId,
        projectId: project?.id,
        status,
        columnId: explicitColumnId,
        clock,
        HttpError,
      });
      if (explicitColumnId !== undefined && req.body?.status !== undefined && column.status !== status)
        throw new HttpError(400, "columnId does not match status");
      const taskStatus = column.status;
      const now = isoNow(clock);
      const id = createId("task_");
      withTransaction(db,()=> {
      if (project) {
        db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? FOR SHARE').get(project.id, req.auth.workspaceId);
        if (!resolveTaskProject(db, req.auth.workspaceId, req.auth.userId, { projectId: project.id, config, clock })) throw new HttpError(403, 'Quyền dự án đã thay đổi');
      }
      db.prepare(
        `
        INSERT INTO tasks
          (id, workspace_id, ${project ? "project_id," : ""} title, description, status, priority, due_at, remind_at,
           assignee_id, customer_id, team_id, column_id, board_position, category,
           recurrence, recurrence_options, recurrence_anchor, created_by, created_at, updated_at)
        VALUES (?, ?, ${project ? "?," : ""} ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        req.auth.workspaceId,
        ...(project ? [project.id] : []),
        title,
        description,
        taskStatus,
        priority,
        dueAt,
        remindAt,
        assigneeId,
        customerId,
        teamId,
        column.id,
        cleanString(req.body?.category, { max: 120, field: "category" }),
        recurrence,
        JSON.stringify(recurrenceOptions),
        recurrence === "none" ? null : dueAt,
        req.auth.userId,
        now,
        now,
      );
      recordTaskActivity(db,{taskId:id,actorUserId:req.auth.userId,action:"task_created",summary:"đã tạo công việc",createdAt:now});
      });
      return {
          task: taskJson(
            taskRowById(db, id, req.auth.workspaceId), req.auth,
          ),
        };
  }, 201);

  app.get("/api/tasks/:id", requireAuth, (req, res, next) => {
    try {
      const task = taskRowById(db, req.params.id, req.auth.workspaceId);
      if (!task) return fail(res, 404, "task was not found");
      if (!canAccessTask(db, req.auth.workspaceId, req.auth.userId, task))
        return fail(res, 404, "task was not found");
      return res.json({ task: taskJson(task, req.auth) });
    } catch (error) {
      return next(error);
    }
  });

  registerTaskMutationCommand(app, "PATCH", "/api/tasks/:id", requireAuth, (req) => {
      const result = withTransaction(db, () => {
      ensureWritable(req);
      const task = db
        .prepare(
          `SELECT * FROM tasks WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL${db.dialect === "postgres" ? " FOR UPDATE" : ""}`,
        )
        .get(req.params.id, req.auth.workspaceId);
      if (!task) throw new HttpError(404, "task was not found");
      if (!canAccessTask(db, req.auth.workspaceId, req.auth.userId, task))
        throw new HttpError(404, "task was not found");
      if (!canAccessTask(db, req.auth.workspaceId, req.auth.userId, task, { write: true }))
        throw new HttpError(409, "Đội nhóm đã lưu trữ và chỉ được đọc");
      const body = req.body || {};
      assertRevision(body, task, "task", HttpError);
      const fields = [];
      const values = [];
      const set = (column, value) => {
        fields.push(`${column} = ?`);
        values.push(value);
      };
      const legacyMove = body.projectId === undefined && body.teamId !== undefined && (body.teamId || null) !== (task.team_id || null)
        && task.project_id === defaultProjectId(req.auth.workspaceId, task.team_id);
      const project = db.dialect === 'postgres' ? resolveTaskProject(db, req.auth.workspaceId, req.auth.userId, {
        projectId: body.projectId || (legacyMove ? defaultProjectId(req.auth.workspaceId, body.teamId || null) : undefined), task, config, clock,
      }) : null;
      if (db.dialect === 'postgres' && !project) throw new HttpError(403, 'Không có quyền ghi dự án');
      if (body.teamId !== undefined && (body.teamId || null) !== (task.team_id || null) && !canManageAllTeams(db, req.auth.workspaceId, req.auth.userId))
        throw new HttpError(403, 'Chỉ quản trị workspace được chuyển công việc giữa các đội nhóm');
      if (project && body.teamId !== undefined && (body.teamId || null) !== (project.team_id || null))
        throw new HttpError(400, 'Đổi đội nhóm cần chọn project đích phù hợp');
      const projectChanged = project && project.id !== task.project_id;
      if (projectChanged) {
        const linkConflict = taskScopeLinkConflict(db, task, project.id);
        if (linkConflict) throw new HttpError(409, linkConflict);
        if (db.prepare('SELECT 1 FROM task_dependencies WHERE predecessor_id=? OR successor_id=? LIMIT 1').get(task.id,task.id)
          || db.prepare('SELECT 1 FROM task_field_values WHERE task_id=? LIMIT 1').get(task.id))
          throw new HttpError(409, 'Cần xử lý phụ thuộc và trường tùy chỉnh trước khi chuyển dự án');
        if (!canAccessTask(db, req.auth.workspaceId, req.auth.userId, task, { action: 'move' })) throw new HttpError(403, 'Không có quyền chuyển dự án');
        set('project_id', project.id);
      }
      const hasTeamId = body.teamId !== undefined || projectChanged;
      const nextTeamId = project ? project.team_id : hasTeamId
        ? body.teamId === null || body.teamId === ""
          ? null
          : cleanString(body.teamId, { max: 100, field: "teamId" })
        : task.team_id || null;
      if (hasTeamId && nextTeamId !== (task.team_id || null)) {
        if (!canManageAllTeams(db, req.auth.workspaceId, req.auth.userId))
          throw new HttpError(403, "Chỉ quản trị workspace được chuyển công việc giữa các đội nhóm");
      }
      if (nextTeamId && !project) {
        const targetTeam = getTeamAccess(
          db,
          req.auth.workspaceId,
          req.auth.userId,
          nextTeamId,
        );
        if (!targetTeam || !targetTeam.visible)
          throw new HttpError(403, "Bạn không có quyền truy cập đội nhóm này");
        if (targetTeam.team.archived_at)
          throw new HttpError(409, "Đội nhóm đã lưu trữ và chỉ được đọc");
      }
      if (hasTeamId) set("team_id", nextTeamId);
      if (body.title !== undefined)
        set(
          "title",
          cleanString(body.title, { required: true, max: 240, field: "title" }),
        );
      if (body.description !== undefined)
        set(
          "description",
          cleanString(body.description, { max: 5000, field: "description" }),
        );
      if (body.status !== undefined) {
        const status = cleanString(body.status, { max: 20, field: "status" });
        if (!STATUSES.has(status))
          throw new HttpError(400, "status is invalid");
        set("status", status);
      }
      if (body.priority !== undefined) {
        const priority = cleanString(body.priority, {
          max: 20,
          field: "priority",
        });
        if (!PRIORITIES.has(priority))
          throw new HttpError(400, "priority is invalid");
        set("priority", priority);
      }
      if (body.dueAt !== undefined)
        set("due_at", dateValue(body.dueAt, "dueAt"));
      if (body.remindAt !== undefined)
        set("remind_at", dateValue(body.remindAt, "remindAt"));
      if (body.assigneeId !== undefined) {
        const value = body.assigneeId
          ? cleanString(body.assigneeId, { max: 100, field: "assigneeId" })
          : null;
        assertMemberReference(db, req.auth.workspaceId, value, null);
        set("assignee_id", value);
      }
      const nextAssigneeId =
        body.assigneeId === undefined
          ? task.assignee_id
          : body.assigneeId
            ? cleanString(body.assigneeId, { max: 100, field: "assigneeId" })
            : null;
      if (project && nextAssigneeId && !(task.status === "done" && (body.status === undefined || body.status === "done") && !projectChanged && nextAssigneeId === task.assignee_id) && !canAccessTask(db, req.auth.workspaceId, nextAssigneeId, { workspace_id: req.auth.workspaceId, project_id: project.id }))
        throw new HttpError(400, 'Người phụ trách không có quyền với dự án');
      if (req.auth.memberType === 'guest' && body.customerId !== undefined) throw new HttpError(403, 'Khách không được sửa liên kết khách hàng');
      if (body.customerId !== undefined) {
        const value = body.customerId
          ? cleanString(body.customerId, { max: 100, field: "customerId" })
          : null;
        assertMemberReference(db, req.auth.workspaceId, null, value);
        set("customer_id", value);
      }
      if (body.category !== undefined)
        set(
          "category",
          cleanString(body.category, { max: 120, field: "category" }),
        );
      if (body.recurrence !== undefined) {
        const recurrence = cleanString(body.recurrence, {
          max: 20,
          field: "recurrence",
        });
        if (!RECURRENCES.has(recurrence))
          throw new HttpError(400, "recurrence is invalid");
        set("recurrence", recurrence);
      }
      const nextStatus =
        body.status === undefined
          ? task.status
          : cleanString(body.status, { max: 20, field: "status" });
      const hasColumnId = body.columnId !== undefined;
      const explicitColumnId =
        !hasColumnId || body.columnId === null || body.columnId === ""
          ? undefined
          : cleanString(body.columnId, { max: 160, field: "columnId" });
      const teamChanged = nextTeamId !== (task.team_id || null);
      const statusChanged = nextStatus !== task.status;
      let nextColumn = null;
      if (hasColumnId || teamChanged || statusChanged || projectChanged) {
        nextColumn = resolveTaskColumn(db, {
          workspaceId: req.auth.workspaceId,
          teamId: nextTeamId,
          projectId: project?.id,
          status: nextStatus,
          columnId: explicitColumnId,
          clock,
          HttpError,
        });
        if (explicitColumnId !== undefined && body.status !== undefined && nextColumn.status !== nextStatus)
          throw new HttpError(400, "columnId does not match status");
        if (body.status === undefined && nextColumn.status !== nextStatus) {
          set("status", nextColumn.status);
        }
        set("column_id", nextColumn.id);
        set("board_position", 0);
      }
      if (!fields.length)
        throw new HttpError(400, "no task changes were supplied");
      const preserveHistoricalAssignee =
        task.status === "done" &&
        nextStatus === "done" &&
        nextTeamId === (task.team_id || null) &&
        nextAssigneeId === task.assignee_id;
      if (
        !project &&
        nextTeamId &&
        nextAssigneeId &&
        !preserveHistoricalAssignee &&
        !db
          .prepare(
            "SELECT 1 FROM team_members WHERE team_id = ? AND workspace_id = ? AND user_id = ?",
          )
          .get(nextTeamId, req.auth.workspaceId, nextAssigneeId)
      )
        throw new HttpError(400, "assigneeId phải thuộc đội nhóm");
      const effectiveNextStatus = nextColumn?.status || nextStatus;
      const nextRecurrence =
        body.recurrence === undefined
          ? task.recurrence
          : cleanString(body.recurrence, { max: 20, field: "recurrence" });
      const nextDue =
        body.dueAt === undefined
          ? task.due_at
          : dateValue(body.dueAt, "dueAt");
      if (task.start_at && nextDue && Date.parse(task.start_at) > Date.parse(nextDue))
        throw new HttpError(400, 'Hạn hoàn thành phải sau ngày bắt đầu');
      if (!nextDue && nextRecurrence !== "none") throw new HttpError(400, "Công việc lặp cần có hạn hoàn thành.");
      const nextOptions = validateRecurrenceOptions(nextRecurrence, body.recurrenceOptions === undefined
        ? (nextRecurrence === task.recurrence ? storedRecurrenceOptions(task) : undefined)
        : body.recurrenceOptions, HttpError);
      const ruleChanged = nextRecurrence !== task.recurrence || JSON.stringify(nextOptions) !== JSON.stringify(storedRecurrenceOptions(task));
      if (body.recurrenceOptions !== undefined || ruleChanged) set("recurrence_options", JSON.stringify(nextOptions));
      if (ruleChanged || nextDue !== task.due_at) set("recurrence_anchor", nextRecurrence === "none" ? null : nextDue);

      const now = isoNow(clock);
      let nextTaskId = null;
      let updatedTask = null;
        set("updated_at", now);
        values.push(req.params.id, req.auth.workspaceId);
        db.prepare(
          `UPDATE tasks SET ${fields.join(", ")} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        ).run(...values);
        updatedTask = db
          .prepare("SELECT * FROM tasks WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL")
          .get(req.params.id, req.auth.workspaceId);
        reconcileTaskAssignees(db,updatedTask);
        const summary = changedTaskSummary(task, updatedTask);
        if (summary)
          recordTaskActivity(db, {
            taskId: req.params.id,
            actorUserId: req.auth.userId,
            action: "task_updated",
            summary,
            createdAt: now,
          });
        if (task.status !== "done" && effectiveNextStatus === "done")
          nextTaskId = createRecurringSuccessor(db, updatedTask, req.auth.userId, now);
        if(task.status!==updatedTask.status)emitTaskEvent(db,{taskId:task.id,actorUserId:req.auth.userId,action:"task_updated",summary:"trạng thái"});
      return {
        task: taskJson(
          taskRowById(db, req.params.id, req.auth.workspaceId), req.auth,
        ),
        nextTask: nextTaskId
          ? taskJson(
              taskRowById(db, nextTaskId, req.auth.workspaceId), req.auth,
            )
          : null,
      };
      });
      return result;
  });

  app.delete("/api/tasks/:id", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = db
        .prepare(
          "SELECT * FROM tasks WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
        )
        .get(req.params.id, req.auth.workspaceId);
      if (!task) return fail(res, 404, "task was not found");
      if (!canAccessTask(db, req.auth.workspaceId, req.auth.userId, task))
        return fail(res, 404, "task was not found");
      if (!canAccessTask(db, req.auth.workspaceId, req.auth.userId, task, { action: "delete" }))
        throw new HttpError(409, "Đội nhóm đã lưu trữ và chỉ được đọc");
      const now = isoNow(clock);
      withTransaction(db, () => {
        const result = db
          .prepare(
            `
          UPDATE tasks SET deleted_at = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
        `,
          )
          .run(now, now, req.params.id, req.auth.workspaceId);
        if (!result.changes) throw new HttpError(404, "task was not found");
        recordTrashItem(db, {
          workspaceId: req.auth.workspaceId,
          entityType: "task",
          entityId: req.params.id,
          title: db
            .prepare("SELECT title FROM tasks WHERE id = ? AND workspace_id = ?")
            .get(req.params.id, req.auth.workspaceId)?.title,
          deletedBy: req.auth.userId,
          deletedAt: now,
        });
      });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/customers", requireAuth, (req, res, next) => {
    try {
      return res.json({ customers: customerRows(db, req.auth.workspaceId) });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/customers/:id", requireAuth, (req, res, next) => {
    try {
      const customer = db
        .prepare(
          "SELECT * FROM customers WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
        )
        .get(req.params.id, req.auth.workspaceId);
      if (!customer) return fail(res, 404, "customer was not found");
      return res.json({ customer: customerJson(customer) });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/customers", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const name = cleanString(req.body?.name, {
        required: true,
        max: 180,
        field: "name",
      });
      const now = isoNow(clock);
      const id = createId("customer_");
      db.prepare(
        `
        INSERT INTO customers(id, workspace_id, name, company, email, phone, service, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        req.auth.workspaceId,
        name,
        cleanString(req.body?.company, { max: 180, field: "company" }),
        req.body?.email ? emailValue(req.body.email) : "",
        cleanString(req.body?.phone, { max: 60, field: "phone" }),
        cleanString(req.body?.service, { max: 180, field: "service" }),
        now,
        now,
      );
      return res
        .status(201)
        .json({
          customer: customerJson(
            db.prepare("SELECT * FROM customers WHERE id = ?").get(id),
          ),
        });
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/customers/:id", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const customer = db
        .prepare(
          "SELECT * FROM customers WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
        )
        .get(req.params.id, req.auth.workspaceId);
      if (!customer) return fail(res, 404, "customer was not found");
      const fields = [];
      const values = [];
      const set = (column, value) => {
        fields.push(`${column} = ?`);
        values.push(value);
      };
      for (const [key, column, max] of [
        ["name", "name", 180],
        ["company", "company", 180],
        ["phone", "phone", 60],
        ["service", "service", 180],
      ]) {
        if (req.body?.[key] !== undefined)
          set(
            column,
            cleanString(req.body[key], {
              required: key === "name",
              max,
              field: key,
            }),
          );
      }
      if (req.body?.email !== undefined)
        set("email", req.body.email ? emailValue(req.body.email) : "");
      if (!fields.length)
        return fail(res, 400, "no customer changes were supplied");
      set("updated_at", isoNow(clock));
      values.push(req.params.id, req.auth.workspaceId);
      db.prepare(
        `UPDATE customers SET ${fields.join(", ")} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      ).run(...values);
      return res.json({
        customer: customerJson(
          db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id),
        ),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.delete(
    "/api/customers/:id",
    requireRoles("owner", "admin"),
    (req, res, next) => {
      try {
        ensureWritable(req);
        const now = isoNow(clock);
        withTransaction(db, () => {
          const customer = db
            .prepare(
              `
                SELECT id, name FROM customers
                WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
              `,
            )
            .get(req.params.id, req.auth.workspaceId);
          if (!customer) throw new HttpError(404, "customer was not found");
          const result = db
            .prepare(
              `
                UPDATE customers SET deleted_at = ?, updated_at = ?
                WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
              `,
            )
            .run(now, now, req.params.id, req.auth.workspaceId);
          if (!result.changes) throw new HttpError(404, "customer was not found");
          recordTrashItem(db, {
            workspaceId: req.auth.workspaceId,
            entityType: "customer",
            entityId: customer.id,
            title: customer.name,
            deletedBy: req.auth.userId,
            deletedAt: now,
          });
        });
        return res.json({ ok: true });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get("/api/members", requireAuth, (req, res, next) => {
    try {
      return res.json({ members: memberRows(db, req.auth.workspaceId) });
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    "/api/invitations",
    requireRoles("owner", "admin"),
    (req, res, next) => {
      try {
        const invitation = withTransaction(db, () => {
        lockWorkspaceSeats(db, req.auth.workspaceId);
        config.plans = currentPlans(db, config.plans);
        if (req.auth.workspace.kind === "personal")
          throw new HttpError(409, "Không gian cá nhân không thể mời thêm thành viên");
        if (!canManageAllTeams(db, req.auth.workspaceId, req.auth.userId))
          throw new HttpError(403, 'Bạn không có quyền mời thành viên');
        const subscription = ensureWritable(req);
        const email = emailValue(req.body?.email);
        const role = cleanString(req.body?.role || "member", {
          max: 20,
          field: "role",
        });
        if (!["admin", "member"].includes(role))
          throw new HttpError(400, "role must be admin or member");
        const memberType = req.body?.memberType || 'member';
        if (!['member','guest'].includes(memberType)) throw new HttpError(400,'Loại thành viên không hợp lệ');
        const projectId = memberType === 'guest' ? cleanString(req.body?.projectId,{required:true,max:160,field:'projectId'}) : null;
        const projectRole = memberType === 'guest' ? (req.body?.projectRole || 'viewer') : null;
        if (memberType === 'guest') {
          if (role !== 'member' || !['viewer','commenter','editor'].includes(projectRole)) throw new HttpError(400,'Vai trò guest không hợp lệ');
          if (!hasWorkspaceEntitlement(db,config,req.auth.workspaceId,'guests',clock)) throw new HttpError(403,'Gói hiện tại không cho mời guest');
          if (!resolveTaskProject(db,req.auth.workspaceId,req.auth.userId,{projectId,action:'manage',config,clock})) throw new HttpError(403,'Không có quyền mời vào project');
        }
        const limit = memberLimit(config, subscription);
        if (workspaceSeatCount(db, req.auth.workspaceId, isoNow(clock)) >= limit)
          throw new HttpError(409, `plan allows at most ${limit} members`);
        const existing = db
          .prepare(
            `
        SELECT id FROM workspace_members wm JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ? AND u.email = ?
      `,
          )
          .get(req.auth.workspaceId, email);
        if (existing)
          throw new HttpError(409, "email is already a workspace member");
        if (db.prepare('SELECT id FROM invitations WHERE workspace_id=? AND email=? AND accepted_at IS NULL AND expires_at>?')
          .get(req.auth.workspaceId, email, isoNow(clock)))
          throw new HttpError(409, "email already has a pending invitation");
        const rawToken = createToken(32);
        const now = currentDate(clock);
        const expires = addDays(now, config.inviteDays).toISOString();
        db.prepare(
          `
        INSERT INTO invitations(id, workspace_id, email, role, token_hash, expires_at, invited_by, created_at, member_type, project_id, project_role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        ).run(
          createId("invite_"),
          req.auth.workspaceId,
          email,
          role,
          hashToken(rawToken),
          expires,
          req.auth.userId,
          now.toISOString(),
          memberType, projectId, projectRole,
        );
        return {
          // The SPA reads the query parameter while preserving the token in a
          // normal browser URL that can be pasted into a new session.
          inviteUrl: `${config.publicAppUrl}/?invite=${encodeURIComponent(rawToken)}`,
          expiresAt: expires,
        };
        });
        return res.status(201).json(invitation);
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post("/api/invitations/accept", (req, res, next) => {
    try {
      const token = cleanString(req.body?.token, {
        required: true,
        max: 200,
        field: "token",
      });
      const invite = db
        .prepare(
          `
        SELECT i.*, w.name AS workspace_name, w.industry AS workspace_industry,
               w.suspended_at AS workspace_suspended_at
        FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
        WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?
      `,
        )
        .get(hashToken(token), isoNow(clock));
      if (!invite) return fail(res, 404, "invitation is invalid or expired");
      if (db.dialect === "postgres" && isPersonalWorkspace(db, invite.workspace_id))
        return fail(res, 409, "Không gian cá nhân không thể mời thêm thành viên");
      if (invite.workspace_suspended_at)
        return fail(
          res,
          423,
          "Không thể chấp nhận lời mời khi không gian đang tạm ngưng",
        );
      const currentUserMatches = Boolean(
        req.auth && req.auth.user.email === invite.email,
      );
      const existingUser = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(invite.email);
      if (existingUser?.disabled_at)
        return fail(res, 403, "user account is disabled");
      if (existingUser && !currentUserMatches) {
        // An invitation token must never let an owner or an arbitrary visitor
        // take over somebody else's existing account. They must log in as the
        // invited address first, then accept the token in that session.
        return fail(
          res,
          401,
          "sign in as the invited email before accepting this invitation",
        );
      }
      const subscription = getSubscription(db, invite.workspace_id);
      if (
        !subscription ||
        subscription.status === "expired" ||
        subscription.status === "canceled" ||
        new Date(subscription.current_period_end).getTime() <=
          currentDate(clock).getTime()
      ) {
        return fail(res, 402, "workspace subscription has expired");
      }
      const targetExistingUserId = currentUserMatches
        ? req.auth.userId
        : existingUser?.id;
      const membership = targetExistingUserId
        ? db
            .prepare(
              "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
            )
            .get(invite.workspace_id, targetExistingUserId)
        : null;
      if (!membership) {
        const currentCount = Number(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ?",
            )
            .get(invite.workspace_id).count,
        );
        if (currentCount >= memberLimit(config, subscription))
          return fail(res, 409, "workspace member limit has been reached");
      }
      let userId = currentUserMatches ? req.auth.userId : existingUser?.id;
      let createdUser = false;
      if (!userId) {
        userId = createId("user_");
        createdUser = true;
      }
      withTransaction(db, () => {
        lockWorkspaceSeats(db, invite.workspace_id);
        config.plans = currentPlans(db, config.plans);
        const liveInvite = db.prepare('SELECT * FROM invitations WHERE id=? AND accepted_at IS NULL AND expires_at>?')
          .get(invite.id, isoNow(clock));
        if (!liveInvite) throw new HttpError(409, 'invitation is no longer valid');
        const liveWorkspace = db.prepare('SELECT suspended_at FROM workspaces WHERE id=?').get(invite.workspace_id);
        if (liveWorkspace?.suspended_at) throw new HttpError(423, 'workspace is suspended');
        const liveSubscription = getSubscription(db, invite.workspace_id);
        if (db.prepare('SELECT disabled_at FROM users WHERE id=?').get(userId)?.disabled_at)
          throw new HttpError(403, 'user account is disabled');
        if (!liveSubscription || ['expired', 'canceled'].includes(liveSubscription.status)
          || Date.parse(liveSubscription.current_period_end) <= currentDate(clock).getTime())
          throw new HttpError(402, 'workspace subscription has expired');
        assertWorkspacePlanSeats(db, invite.workspace_id, config.plans.find(plan => plan.id === liveSubscription.plan), clock);
        if (liveInvite.member_type === 'guest') {
          if (!hasWorkspaceEntitlement(db,config,invite.workspace_id,'guests',clock)) throw new HttpError(403,'Gói hiện tại không còn quyền guest');
          const inviter = db.prepare('SELECT role,member_type FROM workspace_members WHERE workspace_id=? AND user_id=?').get(invite.workspace_id,liveInvite.invited_by);
          if (inviter?.member_type!=='member' || !['owner','admin'].includes(inviter.role)
            || !resolveTaskProject(db,invite.workspace_id,liveInvite.invited_by,{projectId:liveInvite.project_id,action:'manage',config,clock})) throw new HttpError(403,'Lời mời không còn quyền với project');
        }
        if (createdUser) {
          db.prepare(
            "INSERT INTO users(id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
          ).run(
            userId,
            cleanString(req.body?.name, {
              required: true,
              max: 120,
              field: "name",
            }),
            invite.email,
            hashPassword(passwordValue(req.body?.password)),
            isoNow(clock),
          );
        }
        db.prepare(
          `INSERT INTO workspace_members(workspace_id, user_id, role, created_at, member_type) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        ).run(invite.workspace_id, userId, invite.role, isoNow(clock),liveInvite.member_type);
        if(liveInvite.project_id) db.prepare(`INSERT INTO project_members(project_id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?) ON CONFLICT(project_id,user_id) DO NOTHING`).run(liveInvite.project_id,invite.workspace_id,userId,liveInvite.project_role,isoNow(clock));
        const accepted = db
          .prepare(
            "UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL",
          )
          .run(isoNow(clock), invite.id);
        if (!accepted.changes)
          throw new HttpError(409, "invitation was already accepted");
      });
      const member = db
        .prepare(
          `
        SELECT u.id, u.name, u.email, wm.role
        FROM workspace_members wm JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ? AND wm.user_id = ?
      `,
        )
        .get(invite.workspace_id, userId);
      // New invitees and existing invited users receive a session scoped to
      // the workspace they just joined. A signed-in invited user therefore
      // also lands in the correct workspace after accepting.
      const session = createSession(
        db,
        userId,
        invite.workspace_id,
        config,
        clock,
      );
      setSessionCookie(res, session.token, config);
      const joinedAuth = authContext(db, session.token, clock);
      return res.json({
        user: joinedAuth.user,
        workspace: joinedAuth.workspace,
        subscription: subscriptionJson(getSubscription(db, invite.workspace_id), clock, config.plans),
        member: memberJson(member),
        createdAccount: createdUser,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/invitations', requireRoles('owner', 'admin'), (req, res, next) => {
    try {
      const invitations = db.prepare(`SELECT id,email,role,member_type AS "memberType",project_id AS "projectId",project_role AS "projectRole",expires_at AS "expiresAt",created_at AS "createdAt"
        FROM invitations WHERE workspace_id=? AND accepted_at IS NULL AND expires_at>?
        ORDER BY created_at,id`).all(req.auth.workspaceId, isoNow(clock));
      return res.json({ invitations });
    } catch (error) { next(error); }
  });
  app.delete('/api/invitations/:id', requireRoles('owner', 'admin'), (req, res, next) => {
    try {
      withTransaction(db, () => {
        lockWorkspaceSeats(db, req.auth.workspaceId);
        if (!canManageAllTeams(db, req.auth.workspaceId, req.auth.userId))
          throw new HttpError(403, 'Bạn không có quyền thu hồi lời mời');
        const invitation = db.prepare('SELECT id,accepted_at FROM invitations WHERE id=? AND workspace_id=?')
          .get(req.params.id, req.auth.workspaceId);
        if (!invitation) throw new HttpError(404, 'Không tìm thấy lời mời');
        if (invitation.accepted_at) throw new HttpError(409, 'Lời mời đã được chấp nhận');
        db.prepare('DELETE FROM invitations WHERE id=? AND workspace_id=?').run(req.params.id, req.auth.workspaceId);
      });
      return res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get(
    "/api/transactions",
    requireRoles("owner", "admin"),
    (req, res, next) => {
      try {
        return res.json({
          transactions: transactionRows(db, req.auth.workspaceId),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    "/api/transactions",
    requireRoles("owner", "admin"),
    (req, res, next) => {
      try {
        ensureWritable(req);
        const type = cleanString(req.body?.type, {
          required: true,
          max: 20,
          field: "type",
        });
        if (!["income", "expense"].includes(type))
          throw new HttpError(400, "type must be income or expense");
        const title = cleanString(req.body?.title, {
          required: true,
          max: 240,
          field: "title",
        });
        const category = cleanString(req.body?.category, {
          max: 120,
          field: "category",
        });
        const date = dateValue(req.body?.date, "date", {
          dateOnly: true,
          required: true,
        });
        const customerId = req.body?.customerId
          ? cleanString(req.body.customerId, { max: 100, field: "customerId" })
          : null;
        assertMemberReference(db, req.auth.workspaceId, null, customerId);
        const id = createId("transaction_");
        db.prepare(
          `
        INSERT INTO transactions(id, workspace_id, type, amount, title, category, date, customer_id, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        ).run(
          id,
          req.auth.workspaceId,
          type,
          positiveAmount(req.body?.amount),
          title,
          category,
          date,
          customerId,
          req.auth.userId,
          isoNow(clock),
        );
        return res
          .status(201)
          .json({
            transaction: transactionJson(
              db.prepare("SELECT * FROM transactions WHERE id = ?").get(id),
            ),
          });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.delete(
    "/api/transactions/:id",
    requireRoles("owner", "admin"),
    (req, res, next) => {
      try {
        ensureWritable(req);
        const now = isoNow(clock);
        withTransaction(db, () => {
          const transaction = db
            .prepare(
              `
                SELECT id, title FROM transactions
                WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
              `,
            )
            .get(req.params.id, req.auth.workspaceId);
          if (!transaction)
            throw new HttpError(404, "transaction was not found");
          const result = db
            .prepare(
              `UPDATE transactions SET deleted_at = ?
               WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
            )
            .run(now, req.params.id, req.auth.workspaceId);
          if (!result.changes)
            throw new HttpError(404, "transaction was not found");
          recordTrashItem(db, {
            workspaceId: req.auth.workspaceId,
            entityType: "transaction",
            entityId: transaction.id,
            title: transaction.title,
            deletedBy: req.auth.userId,
            deletedAt: now,
          });
        });
        return res.json({ ok: true });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get("/api/notifications", requireAuth, (req, res, next) => {
    try {
      const query = notificationListQuery(req);
      if (query.hasQuery) {
        const result = notificationRowsFiltered(db, req.auth.userId, req.auth.workspaceId, query);
        return res.json({
          notifications: result.rows,
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          hasMore: result.offset + result.rows.length < result.total,
        });
      }
      return res.json({
        notifications: notificationRows(
          db,
          req.auth.userId,
          req.auth.workspaceId,
        ),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/notifications/:id/read", requireAuth, (req, res, next) => {
    try {
      const readAt = req.body?.read === false ? null : isoNow(clock);
      const existing = db
        .prepare(
          `
          SELECT n.id, COALESCE(sc.team_id, t.team_id) team_id, n.service_id, sc.id existing_service_id, sc.archived_at service_archived
          FROM notifications n
          LEFT JOIN tasks t ON t.id = n.task_id
          LEFT JOIN service_contracts sc ON sc.id=n.service_id AND sc.workspace_id=n.workspace_id
          WHERE n.id = ? AND n.user_id = ? AND n.workspace_id = ?
            AND ${calendarNotificationAccessSql()}
        `,
        )
        .get(req.params.id, req.auth.userId, req.auth.workspaceId);
      if (
        !existing ||
        (existing.service_id && (!existing.existing_service_id || existing.service_archived)) ||
        !canAccessTeamTask(
          db,
          req.auth.workspaceId,
          req.auth.userId,
          existing.team_id,
        )
      )
        return fail(res, 404, "notification was not found");
      const result = db
        .prepare(
          `UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND workspace_id = ?`,
        )
        .run(readAt, req.params.id, req.auth.userId, req.auth.workspaceId);
      if (!result.changes) return fail(res, 404, "notification was not found");
      return res.json({
        notification: notificationJson(
          db
            .prepare("SELECT * FROM notifications WHERE id = ?")
            .get(req.params.id),
        ),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/billing", requireAuth, (req, res, next) => {
    try {
      const orders = db
        .prepare(
          `SELECT * FROM billing_orders WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 30`,
        )
        .all(req.auth.workspaceId)
        .map(billingOrderJson);
      return res.json({
        plans: config.plans.filter((plan) => plan.active !== false).map(planJson),
        subscription: subscriptionJson(
          getSubscription(db, req.auth.workspaceId),
          clock,
          config.plans,
        ),
        orders,
        configured: config.billingConfigured,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    "/api/billing/checkout",
    requireRoles("owner"),
    async (req, res, next) => {
      try {
        const planId = cleanString(req.body?.plan, {
          required: true,
          max: 20,
          field: "plan",
        });
        const cycle = cleanString(req.body?.cycle, {
          required: true,
          max: 20,
          field: "cycle",
        });
        let plan = config.plans.find((item) => item.id === planId);
        if (!plan || !["monthly", "yearly"].includes(cycle))
          throw new HttpError(400, "plan or cycle is invalid");
        if (req.auth.workspace.kind === "personal")
          throw new HttpError(409, "Không gian cá nhân miễn phí, không cần mua gói");
        if (plan.active === false) throw new HttpError(409, "Gói thuê bao đã ngừng bán; vui lòng chọn gói khác");
        assertWorkspacePlanSeats(db, req.auth.workspaceId, plan, clock);
        if (
          !config.billingConfigured ||
          !config.gatewayApiUrl ||
          !config.gatewayApiKey
        ) {
          throw new HttpError(
            503,
            "billing is not configured; set BILLGATE_API_URL, BILLGATE_API_KEY and BILLGATE_WEBHOOK_SECRET",
          );
        }
        const orderId = createId("order_");
        const amount = withTransaction(db, () => {
        lockWorkspaceSeats(db, req.auth.workspaceId);
        config.plans = currentPlans(db, config.plans);
        plan = config.plans.find(item => item.id === planId);
        if (!plan || plan.active === false) throw new HttpError(409, 'Gói thuê bao đã ngừng bán');
        assertWorkspacePlanSeats(db, req.auth.workspaceId, plan, clock);
        const quotedAmount = cycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
        db.prepare(
          `
        INSERT INTO billing_orders(id, workspace_id, plan, cycle, amount, currency, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'VND', 'pending', ?)
      `,
        ).run(
          orderId,
          req.auth.workspaceId,
          planId,
          cycle,
          quotedAmount,
          isoNow(clock),
        );
        return quotedAmount;
        });
        const endpoint = billGatewayEndpoint(config, "/integration/payments");
        let response;
        try {
          response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": config.gatewayApiKey,
            },
            body: JSON.stringify({
              externalId: orderId,
              description: `Nhắc Tôi ${plan.name} (${cycle})`,
              currency: "VND",
              totalAmount: amount,
              metadata: { nhacToiOrderId: orderId, plan: planId, cycle },
              customer: {
                name: req.auth.user.name,
                email: req.auth.user.email,
              },
            }),
            signal: AbortSignal.timeout(15000),
          });
        } catch (error) {
          db.prepare(
            "UPDATE billing_orders SET status = 'failed' WHERE id = ? AND paid_at IS NULL",
          ).run(orderId);
          throw new HttpError(
            502,
            `billing gateway is unavailable: ${error?.message || "request failed"}`,
          );
        }
        let gatewayBody = null;
        try {
          gatewayBody = await response.json();
        } catch {}
        if (!response.ok || gatewayBody?.success === false) {
          db.prepare(
            "UPDATE billing_orders SET status = 'failed' WHERE id = ? AND paid_at IS NULL",
          ).run(orderId);
          throw new HttpError(
            502,
            gatewayBody?.error ||
              gatewayBody?.message ||
              "billing gateway rejected the order",
          );
        }
        const payment =
          gatewayBody?.data || gatewayBody?.payment || gatewayBody || {};
        if (
          payment.externalId !== orderId ||
          Number(payment.totalAmount) !== amount ||
          payment.currency !== "VND" ||
          (config.gatewayProjectId &&
            payment.projectId !== config.gatewayProjectId)
        ) {
          db.prepare(
            "UPDATE billing_orders SET status = 'failed' WHERE id = ? AND paid_at IS NULL",
          ).run(orderId);
          throw new HttpError(
            502,
            "billing gateway returned a different invoice",
          );
        }
        const providerPaymentId = payment.id || null;
        if (!providerPaymentId) {
          db.prepare(
            "UPDATE billing_orders SET status = 'failed' WHERE id = ? AND paid_at IS NULL",
          ).run(orderId);
          throw new HttpError(
            502,
            "billing gateway did not return a payment id",
          );
        }
        db.prepare(
          "UPDATE billing_orders SET provider_payment_id = ? WHERE id = ?",
        ).run(String(providerPaymentId), orderId);
        const hostedPath =
          payment.hostedPath ||
          (payment.hostedToken ? `/pay/${payment.hostedToken}` : null);
        const rawHosted =
          payment.hostedUrl || payment.checkoutUrl || payment.url || hostedPath;
        const hosted = absoluteGatewayUrl(config, rawHosted);
        if (!hosted) {
          db.prepare(
            "UPDATE billing_orders SET status = 'failed' WHERE id = ? AND paid_at IS NULL",
          ).run(orderId);
          throw new HttpError(
            502,
            "billing gateway did not return a checkout URL",
          );
        }
        db.prepare(
          "UPDATE billing_orders SET checkout_url = ? WHERE id = ?",
        ).run(hosted, orderId);
        return res
          .status(201)
          .json({
            checkoutUrl: hosted,
            orderId,
            providerPaymentId: String(providerPaymentId),
          });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    "/api/billing/orders/:id/refresh",
    requireRoles("owner"),
    async (req, res, next) => {
      try {
        if (
          !config.billingConfigured ||
          !config.gatewayApiUrl ||
          !config.gatewayApiKey
        ) {
          throw new HttpError(503, "billing is not configured");
        }
        const order = db
          .prepare(
            "SELECT * FROM billing_orders WHERE id = ? AND workspace_id = ?",
          )
          .get(req.params.id, req.auth.workspaceId);
        if (!order) return fail(res, 404, "billing order was not found");
        const paymentId = order.provider_payment_id;
        if (!paymentId)
          throw new HttpError(409, "billing order has no provider payment id");
        const response = await fetch(
          billGatewayEndpoint(
            config,
            `/integration/payments/${encodeURIComponent(paymentId)}`,
          ),
          {
            headers: { "x-api-key": config.gatewayApiKey },
            signal: AbortSignal.timeout(15000),
          },
        );
        let body = null;
        try {
          body = await response.json();
        } catch {}
        if (!response.ok || body?.success === false)
          throw new HttpError(
            502,
            body?.error || "billing gateway rejected the refresh",
          );
        const payment = body?.data || body?.payment || body || {};
        const payload = {
          event:
            payment.status === "paid"
              ? "payment.paid"
              : `payment.${payment.status || "unknown"}`,
          orderId: order.id,
          paymentId,
          amount: payment.totalAmount ?? payment.amount,
          currency: payment.currency,
          data: { payment },
        };
        const result = applyBillingEvent(db, {
          eventId: `refresh:${paymentId}:${payment.status || "unknown"}:${payment.updatedAt || payment.paidAt || ""}`,
          eventType: payload.event,
          orderId: order.id,
          paymentId,
          amount: amountFromPayload(payload),
          currency: currencyFromPayload(payload),
          payload,
          raw: JSON.stringify(payload),
          clock,
          config,
        });
        return res.json({ ok: true, ...result });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.use((req, res) => fail(res, 404, "route was not found"));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError)
      return fail(res, error.status, error.message, error.details);
    if (error?.type === "entity.parse.failed" && error.status === 400)
      return fail(res, 400, "Nội dung JSON không hợp lệ");
    if (error?.type === "entity.too.large" && error.status === 413)
      return fail(res, 413, "Dữ liệu gửi lên vượt quá dung lượng cho phép");
    if (error?.code === "23505")
      return fail(res, 409, "a record with those values already exists");
    if (error?.code === '23514' && error.constraint === 'tasks_timeline_order')
      return fail(res, 400, 'Ngày bắt đầu phải trước hạn hoàn thành');
    if (error?.code === '23514' && error.message === 'Resolve dependencies and custom fields before moving project')
      return fail(res, 409, 'Cần xử lý phụ thuộc và trường tùy chỉnh trước khi chuyển dự án');
    console.error("[nhactoi] request failed:", error);
    return fail(res, 500, "internal server error");
  });

  if (options.startWorker) {
    const intervalMs = Number(
      options.reminderIntervalMs || config.env.REMINDER_INTERVAL_MS || 30000,
    );
    const interval = setInterval(
      () => {
        try {
          processReminders({ db, config, clock });
          app.locals.processServiceReminders();
          app.locals.processAutomations?.();
          void app.locals.processAiComments?.().catch(()=>console.warn('[nhactoi] assistant worker failed'));
          app.locals.processWorkTimers?.();
          void app.locals.processWebhooks?.().catch(()=>console.error("[nhactoi] webhook worker failed"));
          void app.locals.processGoogleCalendar?.().catch(()=>console.error("[nhactoi] calendar sync failed"));
          void app.locals.processZaloOa?.().catch(()=>console.error("[nhactoi] OA worker failed"));
          void app.locals.processReminderEmails().catch(error=>console.error("[nhactoi] email worker failed",error));
          processEventReminders({db,clock});
          void app.locals.processWebPush().catch(error=>console.error("[nhactoi] web push worker failed", error));
          void app.locals.processNotificationOutbox?.().catch(error=>console.error("[nhactoi] notification outbox failed", error));
          void app.locals.processBackups?.().catch(error=>console.error("[nhactoi] backup failed",error));
          void app.locals.processRemoteCleanup?.().catch(error=>console.error("[nhactoi] remote cleanup failed",error));
        } catch (error) {
          console.error("[nhactoi] reminder worker failed:", error);
        }
      },
      Math.max(1000, intervalMs),
    );
    interval.unref?.();
    app.locals.reminderInterval = interval;
  }
  app.locals.close = () => {
    app.locals.stopCommentAssistant?.();
    if (app.locals.reminderInterval) clearInterval(app.locals.reminderInterval);
    if (!options.db && db?.close) db.close();
  };
  return app;
}

// Kept as a named helper to make the recurrence operation easy to exercise in
// isolated tests without duplicating date arithmetic.
function nextRecurrenceDate(dueAt, recurrence, options, completedAt, anchorAt) {
  return nextRecurrence(dueAt, recurrence, options, completedAt, anchorAt);
}

export { createApp, configFrom, nextRecurrenceDate };
