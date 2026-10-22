import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { EventForm } from "../src/features/EventForm";
import { router } from "expo-router";
import { refreshData, useResource, useSession } from "../src/core/session";

jest.mock("expo-router", () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    push: jest.fn(),
    replace: jest.fn(),
  },
}));
jest.mock("../src/core/session", () => ({
  refreshData: jest.fn(),
  useResource: jest.fn(),
  useSession: jest.fn(),
}));
jest.mock("../src/core/api", () => ({
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Có lỗi xảy ra.",
}));
jest.mock("../src/ui/frames", () => ({
  HingeSafe: ({ children }: { children: React.ReactNode }) => children,
}));

const api = jest.fn();
const resource = jest.mocked(useResource);
const session = jest.mocked(useSession);

beforeEach(() => {
  jest.clearAllMocks();
  api.mockResolvedValue({ ok: true });
  session.mockReturnValue({ api, writable: true } as unknown as ReturnType<typeof useSession>);
  resource.mockImplementation((path: string) => {
    if (path === "/teams") return { data: { value: { teams: [] } } } as never;
    return {
      isPending: false,
      error: undefined,
      data: {
        value: {
          event: {
            id: "event-1",
            revision: "original-event",
            title: "Demo appointment",
            description: "",
            status: "todo",
            starts_at: "2099-01-01T10:00:00.000Z",
            ends_at: "2099-01-01T11:00:00.000Z",
            remind_at: null,
            team_id: null,
            canEdit: true,
          },
        },
      },
    } as never;
  });
});

afterEach(cleanup);

test("saves the appointment status with the existing event payload", async () => {
  await render(<EventForm id="event-1" />);
  await fireEvent.press(screen.getByLabelText("Trạng thái: Cần làm"));
  await fireEvent.press(screen.getByText("Đang làm"));
  await fireEvent.press(screen.getByLabelText("Lưu lịch hẹn"));

  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(api).toHaveBeenCalledWith("/calendar-events/event-1", {
    method: "PUT",
    body: JSON.stringify({
      expectedRevision: "original-event",
      title: "Demo appointment",
      description: "",
      startsAt: "2099-01-01T10:00:00.000Z",
      endsAt: "2099-01-01T11:00:00.000Z",
      remindAt: null,
      status: "doing",
      teamId: null,
    }),
  });
  expect(refreshData).toHaveBeenCalledTimes(1);
  expect(router.back).toHaveBeenCalledTimes(1);
});

test("an appointment draft retains its original revision when another client updates it", async () => {
  const view = await render(<EventForm id="event-1" />);
  await fireEvent.changeText(screen.getByLabelText("Tên lịch hẹn"), "Phone draft");
  const original = resource.getMockImplementation()!;
  resource.mockImplementation((path: string) => {
    const result = original(path) as any;
    if (result.data?.value.event) result.data.value.event = { ...result.data.value.event, revision: "new-event", status: "done" };
    return result;
  });
  await view.rerender(<EventForm id="event-1" />);
  await fireEvent.press(screen.getByLabelText("Lưu lịch hẹn"));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({ expectedRevision: "original-event", title: "Phone draft" });
});
