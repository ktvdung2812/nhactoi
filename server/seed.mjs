import { resolve } from "node:path";
import { openDatabase, withTransaction } from "./db.mjs";
import { createId, hashPassword } from "./auth.mjs";

const DEMO_EMAIL = "demo@nhactoi.local";
const DEMO_PASSWORD = "NhacToi2026!";

function dateAt(base, days, hour = 9) {
  const value = new Date(base);
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

export function seedDemo({
  db: explicitDb,
  databaseUrl = process.env.DATABASE_URL,
  clock = () => new Date(),
} = {}) {
  const shouldClose = !explicitDb;
  const db = explicitDb || openDatabase(databaseUrl);
  const now = new Date(typeof clock === "function" ? clock() : clock);
  const nowIso = now.toISOString();
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(DEMO_EMAIL);
  if (existing) {
    if (shouldClose) db.close();
    return { created: false, email: DEMO_EMAIL, password: DEMO_PASSWORD };
  }

  const userId = createId("user_");
  const adminId = createId("user_");
  const memberId = createId("user_");
  const workspaceId = createId("workspace_");
  const customerA = createId("customer_");
  const customerB = createId("customer_");
  const taskIds = [
    createId("task_"),
    createId("task_"),
    createId("task_"),
    createId("task_"),
  ];
  withTransaction(db, () => {
    db.prepare(
      "INSERT INTO users(id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, "Lê Dũng", DEMO_EMAIL, hashPassword(DEMO_PASSWORD), nowIso);
    db.prepare(
      "INSERT INTO users(id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      adminId,
      "Nguyễn An",
      "an@nhactoi.local",
      hashPassword("NhacToi2026!"),
      nowIso,
    );
    db.prepare(
      "INSERT INTO users(id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      memberId,
      "Trần Minh",
      "minh@nhactoi.local",
      hashPassword("NhacToi2026!"),
      nowIso,
    );
    db.prepare(
      "INSERT INTO workspaces(id, name, industry, created_at) VALUES (?, ?, ?, ?)",
    ).run(workspaceId, "Nhắc Tôi Demo", "Dịch vụ tư vấn", nowIso);
    const memberInsert = db.prepare(
      `INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
    );
    memberInsert.run(workspaceId, userId, "owner", nowIso);
    memberInsert.run(workspaceId, adminId, "admin", nowIso);
    memberInsert.run(workspaceId, memberId, "member", nowIso);
    db.prepare(
      `
      INSERT INTO subscriptions(workspace_id, plan, cycle, status, current_period_end, updated_at)
      VALUES (?, 'team', 'yearly', 'active', ?, ?)
    `,
    ).run(workspaceId, dateAt(now, 365, 23), nowIso);
    const customerInsert = db.prepare(`
      INSERT INTO customers(id, workspace_id, name, company, email, phone, service, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    customerInsert.run(
      customerA,
      workspaceId,
      "Phạm Hương",
      "Mộc Studio",
      "huong@moc.example",
      "0901234567",
      "Tư vấn thương hiệu",
      nowIso,
      nowIso,
    );
    customerInsert.run(
      customerB,
      workspaceId,
      "Đỗ Nam",
      "Nam & Co",
      "nam@nam.example",
      "0907654321",
      "Thiết kế website",
      nowIso,
      nowIso,
    );
    const taskInsert = db.prepare(`
      INSERT INTO tasks
        (id, workspace_id, title, description, status, priority, due_at, remind_at,
         assignee_id, customer_id, category, recurrence, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    taskInsert.run(
      taskIds[0],
      workspaceId,
      "Gửi proposal cho Mộc Studio",
      "Rà lại phạm vi và gửi bản đề xuất cuối.",
      "doing",
      "high",
      dateAt(now, 1, 10),
      dateAt(now, 0, 10),
      adminId,
      customerA,
      "Bán hàng",
      "none",
      userId,
      nowIso,
      nowIso,
    );
    taskInsert.run(
      taskIds[1],
      workspaceId,
      "Họp cập nhật dự án Nam & Co",
      "Chuẩn bị agenda và các mốc cần chốt.",
      "todo",
      "medium",
      dateAt(now, 3, 14),
      dateAt(now, 2, 14),
      memberId,
      customerB,
      "Dự án",
      "weekly",
      userId,
      nowIso,
      nowIso,
    );
    taskInsert.run(
      taskIds[2],
      workspaceId,
      "Đối soát thu chi tháng",
      "Kiểm tra hóa đơn, doanh thu và chi phí vận hành.",
      "todo",
      "high",
      dateAt(now, 5, 16),
      dateAt(now, 4, 16),
      userId,
      null,
      "Tài chính",
      "monthly",
      userId,
      nowIso,
      nowIso,
    );
    taskInsert.run(
      taskIds[3],
      workspaceId,
      "Gọi lại khách hàng tiềm năng",
      "Hỏi nhu cầu và thời gian bắt đầu.",
      "done",
      "low",
      dateAt(now, -1, 11),
      null,
      memberId,
      null,
      "Bán hàng",
      "none",
      userId,
      nowIso,
      nowIso,
    );
    const transactionInsert = db.prepare(`
      INSERT INTO transactions(id, workspace_id, type, amount, title, category, date, customer_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    transactionInsert.run(
      createId("transaction_"),
      workspaceId,
      "income",
      18500000,
      "Đợt 1 Mộc Studio",
      "Dịch vụ",
      now.toISOString().slice(0, 10),
      customerA,
      userId,
      nowIso,
    );
    transactionInsert.run(
      createId("transaction_"),
      workspaceId,
      "income",
      12000000,
      "Thanh toán Nam & Co",
      "Dịch vụ",
      dateAt(now, -7, 12).slice(0, 10),
      customerB,
      userId,
      nowIso,
    );
    transactionInsert.run(
      createId("transaction_"),
      workspaceId,
      "expense",
      3200000,
      "Phần mềm và công cụ",
      "Vận hành",
      dateAt(now, -4, 12).slice(0, 10),
      null,
      userId,
      nowIso,
    );
    db.prepare(
      `
      INSERT INTO notifications(id, workspace_id, user_id, task_id, type, title, message, created_at)
      VALUES (?, ?, ?, ?, 'task_reminder', ?, ?, ?)
    `,
    ).run(
      createId("notification_"),
      workspaceId,
      userId,
      taskIds[0],
      "Nhắc việc sắp đến hạn",
      "Gửi proposal cho Mộc Studio sẽ đến hạn ngày mai.",
      nowIso,
    );
  });
  if (shouldClose) db.close();
  return {
    created: true,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    workspaceId,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  const result = seedDemo();
  console.log(
    result.created
      ? `Demo workspace created. Login: ${result.email} / ${result.password}`
      : "Demo workspace already exists.",
  );
}
