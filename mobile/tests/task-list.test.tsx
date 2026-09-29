import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
} from "@testing-library/react-native";
import { router } from "expo-router";
import { projectWorkItems, TaskList } from "../src/features/TaskList";
let mockTaskState: any;
let mockEventState: any;
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../src/core/session", () => ({
  useSession: () => ({
    session: { user: { id: "u" }, workspace: { name: "Demo" } },
    writable: true,
    online: true,
  }),
  useResource: (path: string) =>
    path === "/tasks"
      ? mockTaskState
      : path === "/calendar-events"
        ? mockEventState
      : { data: { value: { teams: [], members: [] } } },
}));
jest.mock("../src/ui/frames", () => ({
  HingeSafe: ({ children }: { children: React.ReactNode }) => children,
}));
beforeEach(() => {
  mockTaskState = {
    isPending: false,
    isRefetching: false,
    refetch: jest.fn(),
    data: { value: { tasks: [] } },
  };
  mockEventState = {
    isPending: false,
    isRefetching: false,
    refetch: jest.fn(),
    data: { value: { events: [] } },
  };
  jest.mocked(router.push).mockClear();
});
afterEach(cleanup);
test('undated tasks stay out of date filters and sort after dated tasks', () => {
  const base = { title: 'Task', description: '', status: 'todo' as const, priority: 'medium' as const, remindAt: null, recurrence: 'none' as const, assigneeId: 'u', teamId: null };
  const tasks = [{ ...base, id: 'inbox', dueAt: null }, { ...base, id: 'later', dueAt: '2030-01-02T10:00:00Z' }, { ...base, id: 'earlier', dueAt: '2030-01-01T10:00:00Z' }];
  const filters = { search: '', team: 'all', status: 'all', assignee: 'all', due: 'all' };
  expect(projectWorkItems(tasks, [], filters).map(item => item.value.id)).toEqual(['earlier', 'later', 'inbox']);
  expect(projectWorkItems([tasks[0]], [], { ...filters, due: 'overdue' })).toHaveLength(0);
  expect(projectWorkItems([tasks[0]], [], { ...filters, due: 'today' })).toHaveLength(0);
});
test("pending tasks show loading instead of an empty section shell", async () => {
  mockTaskState = { ...mockTaskState, isPending: true, data: undefined };
  await render(<TaskList onSelect={() => {}} />);
  expect(screen.getByText("Đang tải…")).toBeTruthy();
});
test("empty filter results show a recovery message", async () => {
  mockTaskState.data.value.tasks = [
    {
      id: "t",
      title: "Known task",
      description: "",
      status: "todo",
      dueAt: "2099-01-01",
      priority: "medium",
      teamId: null,
    },
  ];
  await render(<TaskList onSelect={() => {}} />);
  await fireEvent.changeText(
    screen.getByLabelText("Tìm công việc hoặc lịch hẹn"),
    "unmatched",
  );
  expect(screen.getByText("Chưa có nội dung phù hợp")).toBeTruthy();
});

test("projects tasks and appointments into the same status stream", () => {
  const task = {
    id: "t",
    title: "Task",
    description: "",
    status: "todo" as const,
    priority: "medium" as const,
    dueAt: "2030-01-01T10:00:00.000Z",
    remindAt: null,
    recurrence: "none" as const,
    assigneeId: "u",
    teamId: "team",
  };
  const event = {
    id: "e",
    title: "Appointment",
    description: "",
    status: "doing" as const,
    starts_at: "2030-01-01T11:00:00.000Z",
    ends_at: "2030-01-01T12:00:00.000Z",
    remind_at: "2030-01-01T10:30:00.000Z",
    team_id: "team",
    canEdit: true,
  };
  const projected = projectWorkItems(
    [task],
    [event, { ...event, id: "service:s", service_id: "s" }],
    { search: "", team: "team", status: "doing", assignee: "all", due: "all" },
    Date.parse("2029-12-31T00:00:00.000Z"),
  );
  expect(projected).toHaveLength(1);
  expect(projected[0]).toMatchObject({ kind: "event", value: { id: "e" } });
});

test("opens an appointment detail route from the mixed list", async () => {
  mockEventState.data.value.events = [
    {
      id: "event-1",
      title: "Demo appointment",
      description: "",
      status: "todo",
      starts_at: "2099-01-01T10:00:00.000Z",
      ends_at: "2099-01-01T11:00:00.000Z",
      remind_at: null,
      team_id: null,
      canEdit: true,
    },
  ];
  await render(<TaskList onSelect={() => {}} />);
  fireEvent.press(screen.getByTestId("event-event-1"));
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/event/[id]",
    params: { id: "event-1" },
  });
});
