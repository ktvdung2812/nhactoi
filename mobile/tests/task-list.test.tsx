import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
} from "@testing-library/react-native";
import { TaskList } from "../src/features/TaskList";
let mockTaskState: any;
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../src/core/session", () => ({
  useSession: () => ({
    session: { user: { id: "u" }, workspace: { name: "Demo" } },
    writable: true,
  }),
  useResource: (path: string) =>
    path === "/tasks"
      ? mockTaskState
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
});
afterEach(cleanup);
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
    screen.getByLabelText("Tìm công việc"),
    "unmatched",
  );
  expect(screen.getByText("Chưa có công việc phù hợp")).toBeTruthy();
});
