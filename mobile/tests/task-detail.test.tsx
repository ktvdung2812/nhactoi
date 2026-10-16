import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { TaskDetail } from "../src/features/TaskDetail";
import { refreshData, useResource, useSession } from "../src/core/session";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../src/core/session", () => ({ refreshData: jest.fn(), useResource: jest.fn(), useSession: jest.fn() }));
jest.mock("../src/core/files", () => ({ pickFiles: jest.fn(), uploadFile: jest.fn(), openAttachment: jest.fn() }));
jest.mock("../src/ui/frames", () => ({ HingeSafe: ({ children }: { children: React.ReactNode }) => children }));

const api = jest.fn();
const resource = jest.mocked(useResource);
const task = { id: "task-1", title: "Task", description: "", status: "todo", priority: "medium", dueAt: "2030-01-01T10:00:00Z", remindAt: null, recurrence: "weekly", teamId: null, assigneeId: "lead" };
let canWrite = true;
let cachedExtras = false;

beforeEach(() => {
  jest.clearAllMocks();
  canWrite = true;
  cachedExtras = false;
  api.mockReset().mockResolvedValue({ task: { id: "copy-1" } });
  jest.mocked(useSession).mockReturnValue({ api, writable: true, online: true, session: { user: { id: "lead" } } } as unknown as ReturnType<typeof useSession>);
  resource.mockImplementation((path: string) => {
    const value = path.endsWith("/detail") ? { task, canWrite, checklists: [], comments: [], attachments: [], activity: [] }
      : path.endsWith("/extras") ? { assigneeIds: ["existing"], labelIds: ["selected"], labels: [{ id: "selected", name: "Đang dùng", color: "green" }], members: [{ id: "lead", name: "Chính" }, { id: "existing", name: "Lan" }, { id: "new", name: "An" }] }
      : path === "/task-labels" ? { labels: [{ id: "selected", name: "Đang dùng", color: "green" }, { id: "next", name: "Mới", color: "blue" }] }
      : path.endsWith("/collaboration") ? { watching: false, members: [], comments: [] }
      : path.endsWith("/upload-policy") ? { enabled: false }
      : path.endsWith("/reminders") ? { canRespond: false, recipients: [{ id: "lead", name: "Chính" }], history: [{ id: "notice", name: "Chính", created_at: "2026-10-16T03:00:00Z", email_status: "sent", push_status: "failed", web_push_statuses: { sent: 1, pending: 2 } }] }
      : { columns: [] };
    return { data: { value, cached: path.endsWith("/extras") && cachedExtras }, refetch: jest.fn(), isPending: false } as never;
  });
});
afterEach(cleanup);

test("adding a collaborator preserves labels and excludes the primary assignee from the picker", async () => {
  await render(<TaskDetail id="task-1" onBack={() => {}} />);
  expect(screen.queryByLabelText("Thêm người phối hợp Chính")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Thêm người phối hợp An"));
  expect(api).toHaveBeenCalledWith("/tasks/task-1/extras", { method: "PUT", body: JSON.stringify({ assigneeIds: ["existing", "new"], labelIds: ["selected"] }) });
  await waitFor(() => expect(refreshData).toHaveBeenCalledTimes(1));
});

test("removing a label preserves collaborating assignees", async () => {
  await render(<TaskDetail id="task-1" onBack={() => {}} />);
  await fireEvent.press(screen.getByLabelText("Bỏ nhãn Đang dùng"));
  expect(api).toHaveBeenCalledWith("/tasks/task-1/extras", { method: "PUT", body: JSON.stringify({ assigneeIds: ["existing"], labelIds: [] }) });
});

test.each(["read-only", "cached"])("%s extras cannot be written", async (mode) => {
  canWrite = mode !== "read-only";
  cachedExtras = mode === "cached";
  await render(<TaskDetail id="task-1" onBack={() => {}} />);
  await fireEvent.press(screen.getByLabelText("Thêm người phối hợp An"));
  await fireEvent.press(screen.getByLabelText("Bỏ nhãn Đang dùng"));
  if (mode === "read-only") await fireEvent.press(screen.getByLabelText("Sao chép công việc"));
  expect(api).not.toHaveBeenCalled();
});

test("failed extras mutation reports the error and preserves the displayed selection", async () => {
  api.mockRejectedValueOnce(new Error("Quyền đã thay đổi"));
  await render(<TaskDetail id="task-1" onBack={() => {}} />);
  await fireEvent.press(screen.getByLabelText("Bỏ nhãn Đang dùng"));
  await waitFor(() => expect(screen.getByText("Quyền đã thay đổi")).toBeTruthy());
  expect(screen.getByLabelText("Bỏ nhãn Đang dùng")).toBeTruthy();
  expect(refreshData).not.toHaveBeenCalled();
});

test("copy uses the source deadline and opens the newly created task", async () => {
  await render(<TaskDetail id="task-1" onBack={() => {}} />);
  await fireEvent.press(screen.getByLabelText("Sao chép công việc"));
  expect(api).toHaveBeenCalledWith("/tasks/task-1/copy", { method: "POST", body: JSON.stringify({ dueAt: task.dueAt }) });
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: "/task/[id]", params: { id: "copy-1" } }));
});

test("reminder delivery acceptance is shown separately from work acknowledgement", async () => {
  await render(<TaskDetail id="task-1" onBack={() => {}} />);
  expect(screen.getByText("Email: Nhà cung cấp đã tiếp nhận")).toBeTruthy();
  expect(screen.getByText("FCM: Gửi thất bại")).toBeTruthy();
  expect(screen.getByText("Web Push: Nhà cung cấp đã tiếp nhận (1); Đang chờ gửi (2)")).toBeTruthy();
  expect(screen.getByText("Chính: chưa xác nhận")).toBeTruthy();
  expect(screen.getAllByText("Checklist")).toHaveLength(1);
});
