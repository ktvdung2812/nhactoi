import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import type { AiRun, Detail } from "../src/core/types";
import { TaskDetail } from "../src/features/TaskDetail";
import { refreshData, useResource, useSession } from "../src/core/session";

jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "comment-operation-1") }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../src/core/session", () => ({ refreshData: jest.fn(), useResource: jest.fn(), useSession: jest.fn() }));
jest.mock("../src/core/files", () => ({ pickFiles: jest.fn(), uploadFile: jest.fn(), openAttachment: jest.fn() }));
jest.mock("../src/ui/frames", () => ({ HingeSafe: ({ children }: { children: React.ReactNode }) => children }));

const api = jest.fn();
const resource = jest.mocked(useResource);
const task = { id: "task-1", title: "Task", description: "", status: "todo", priority: "medium", dueAt: "2030-01-01T10:00:00Z", remindAt: null, recurrence: "weekly", teamId: null, assigneeId: "lead" };
let canWrite = true;
let cachedExtras = false;
let canComment: boolean | undefined;
let aiRuns: AiRun[] = [];
let comments: Detail["comments"] = [];
let commentPermissions: { id: string; canEdit: boolean; canDelete: boolean; reactions: [] }[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  canWrite = true;
  cachedExtras = false;
  canComment = undefined; aiRuns = []; comments = []; commentPermissions = [];
  api.mockReset().mockResolvedValue({ task: { id: "copy-1" } });
  jest.mocked(useSession).mockReturnValue({ api, writable: true, online: true, session: { user: { id: "lead" } } } as unknown as ReturnType<typeof useSession>);
  resource.mockImplementation((path: string) => {
    const value = path.endsWith("/detail") ? { task, canWrite, canComment, checklists: [], comments, attachments: [], activity: [] }
      : path === "/ai/config" ? { ready: true, assistant: { name: "Vyvy", handle: "vyvy", enabled: true } }
      : path.endsWith("/ai-runs") ? { runs: aiRuns }
      : path.endsWith("/extras") ? { assigneeIds: ["existing"], labelIds: ["selected"], labels: [{ id: "selected", name: "Đang dùng", color: "green" }], members: [{ id: "lead", name: "Chính" }, { id: "existing", name: "Lan" }, { id: "new", name: "An" }] }
      : path === "/task-labels" ? { labels: [{ id: "selected", name: "Đang dùng", color: "green" }, { id: "next", name: "Mới", color: "blue" }] }
      : path.endsWith("/collaboration") ? { watching: false, members: [], comments: commentPermissions }
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


test("comment-only members can mention the assistant without gaining task editing rights", async () => {
  canWrite = false; canComment = true;
  await render(<TaskDetail id="task-1" onBack={() => {}} />);
  await fireEvent.changeText(screen.getByLabelText("Bình luận"), "@VY");
  await fireEvent.press(screen.getByLabelText("@vyvy · Vyvy · Trợ lý AI"));
  expect(screen.getByLabelText("Bình luận").props.value).toBe("@vyvy ");
  await fireEvent.press(screen.getByLabelText("Gửi bình luận"));
  const request = api.mock.calls.find(([path]) => path.endsWith("/comments"));
  expect(JSON.parse(request![1].body)).toEqual({ body: "@vyvy", mentionIds: [], attachmentIds: [], operationId: "comment-operation-1" });
  await fireEvent.press(screen.getByLabelText("Sao chép công việc"));
  expect(api.mock.calls.some(([path]) => path.endsWith("/copy"))).toBe(false);
});

test("retrying a failed comment send reuses its operation id and retains the text", async () => {
  api.mockRejectedValueOnce(new Error("Mất kết nối"));
  await render(<TaskDetail id="task-1" onBack={() => {}} />);
  await fireEvent.changeText(screen.getByLabelText("Bình luận"), "@vyvy tóm tắt");
  await fireEvent.press(screen.getByLabelText("Gửi bình luận"));
  expect(screen.getByText("Mất kết nối")).toBeTruthy();
  expect(screen.getByLabelText("Bình luận").props.value).toBe("@vyvy tóm tắt");
  await fireEvent.press(screen.getByLabelText("Gửi bình luận"));
  const calls = api.mock.calls.filter(([path]) => path.endsWith("/comments"));
  expect(calls).toHaveLength(2);
  expect(calls[1][1].body).toBe(calls[0][1].body);
});

test("assistant replies identify sources, partial reads and failed-run retry", async () => {
  aiRuns = [{ id: "run-1", commentId: "comment-1", status: "failed", error: "Nhà cung cấp tạm thời lỗi", canRetry: true, actions: [{ name: "update_task", summary: "Đã cập nhật người phụ trách", status: "completed" }] }];
  comments = [{ id: "reply-1", body: "Đã tạo checklist", authorName: "Vyvy", authorType: "assistant", replyToCommentId: "comment-1", createdAt: "2026-10-18T03:00:00Z", attachments: [], sources: [{ title: "Tài liệu dài", status: "partial", detail: "Chưa đọc đủ" }], actions: [{ name: "create_checklist", summary: "Tạo checklist", status: "completed" }] }];
  await render(<TaskDetail id="task-1" onBack={() => {}} />);
  expect(screen.getByText(/Vyvy · AI/)).toBeTruthy();
  expect(screen.getByText("Đã cập nhật người phụ trách · Hoàn tất")).toBeTruthy();
  expect(screen.getByText("Tài liệu dài · Đọc một phần · Chưa đọc đủ")).toBeTruthy();
  expect(screen.getByLabelText("Trả lời bình luận gốc")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Thử lại yêu cầu AI"));
  expect(api).toHaveBeenCalledWith("/tasks/task-1/ai-runs/run-1/retry", { method: "POST" });
});

test("assistant task sources navigate inside the app and deletion is independent from editing", async () => {
  comments = [{ id: "reply-1", body: "Xem công việc liên quan", authorName: "Vyvy", authorType: "assistant", createdAt: "2026-10-18T03:00:00Z", attachments: [], sources: [{ title: "Công việc liên quan", kind: "task", taskId: "task-2", url: "/tasks/task-2", status: "partial", note: "Chỉ đọc kết quả tìm kiếm" }] }];
  commentPermissions = [{ id: "reply-1", canEdit: false, canDelete: true, reactions: [] }];
  await render(<TaskDetail id="task-1" onBack={() => {}} />);
  expect(screen.queryByLabelText("Sửa bình luận")).toBeNull();
  expect(screen.getByLabelText("Xóa bình luận")).toBeTruthy();
  expect(screen.getByText("Công việc liên quan · Đọc một phần · Chỉ đọc kết quả tìm kiếm")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Mở nguồn Công việc liên quan"));
  expect(router.push).toHaveBeenCalledWith({ pathname: "/task/[id]", params: { id: "task-2" } });
});
