export type Session = {
  token: string;
  expiresAt: string;
  verifiedAt: number;
  user: { id: string; name: string; email: string; role: string };
  workspace: { id: string; name: string; suspendedAt?: string | null };
  subscription: { status: string; currentPeriodEnd: string; plan: string };
};
export type Member = {
  id: string;
  name: string;
  email?: string;
  role?: string;
};
export type Team = {
  id: string;
  name: string;
  description?: string;
  archivedAt?: string | null;
};
export type Task = {
  id: string;
  title: string;
  description: string;
  status: "todo" | "doing" | "done";
  priority: "low" | "medium" | "high";
  dueAt: string | null;
  remindAt: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly" | "yearly";
  recurrenceOptions?: { interval: number; weekdays: number[]; basis: "due" | "completion" };
  assigneeId: string | null;
  customerId?: string | null;
  teamId: string | null;
  teamName?: string | null;
  teamArchived?: boolean;
  columnId?: string;
  category?: string;
  assigneeName?: string;
  updatedAt?: string;
};
export type Attachment = {
  id: string;
  title: string;
  kind: "file" | "link";
  url?: string;
  originalName?: string;
  sizeBytes?: number;
  mimeType?: string;
  downloadUrl?: string;
};
export type Detail = {
  task: Task;
  canWrite: boolean;
  checklists: {
    id: string;
    title: string;
    items: { id: string; title: string; completed: boolean }[];
  }[];
  comments: {
    id: string;
    body: string;
    authorName: string;
    createdAt: string;
    attachments: Attachment[];
  }[];
  attachments: Attachment[];
  activity: {
    id: string;
    actorName: string;
    summary: string;
    createdAt: string;
  }[];
};
export type CalendarEvent = {
  service_id?: string;
  id: string;
  title: string;
  description: string;
  status?: Task["status"] | null;
  starts_at: string;
  ends_at: string;
  remind_at: string | null;
  team_id: string | null;
  canEdit: boolean;
};
export type Notice = {
  id: string;
  title: string;
  message: string;
  type: string;
  readAt: string | null;
  createdAt: string;
  taskId?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  workspaceId?: string;
};
export type Column = {
  id: string;
  name: string;
  status: Task["status"];
  archivedAt?: string | null;
};
