import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { TaskForm } from "../src/features/TaskForm";
import { EventForm } from "../src/features/EventForm";
import { useResource, useSession } from "../src/core/session";
import type { NhactoiFoldingFeature } from "../modules/nhactoi-window";

jest.mock("react-native-safe-area-context", () =>
  jest.requireActual("react-native-safe-area-context/jest/mock").default,
);
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), push: jest.fn(), replace: jest.fn() },
}));
jest.mock("../src/core/session", () => ({
  refreshData: jest.fn(),
  useResource: jest.fn(),
  useSession: jest.fn(),
}));
// The real FormPage and HingeSafe lay out against this window; changing it is what iOS does when
// iPad multitasking resizes the scene or the iPhone Duo is unfolded, folded or bent.
jest.mock("../src/ui/adaptive", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  type MockWindow = { width: number; height: number; foldingFeatures: unknown[] };
  let state: MockWindow = { width: 382, height: 644, foldingFeatures: [] };
  const listeners = new Set<() => void>();
  return {
    __setWindow(next: Partial<MockWindow>) {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener());
    },
    useAdaptiveWindow: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => state,
      ),
  };
});

type WindowChange = { width?: number; height?: number; foldingFeatures?: NhactoiFoldingFeature[] };
const setWindow = (jest.requireMock("../src/ui/adaptive") as {
  __setWindow: (next: WindowChange) => void;
}).__setWindow;

const fold = (orientation: "VERTICAL" | "HORIZONTAL", width: number, height: number): NhactoiFoldingFeature => ({
  // UIKit's division region on iPhone Duo is about 40 pt including its margins.
  bounds:
    orientation === "VERTICAL"
      ? { left: width / 2 - 20, top: 0, right: width / 2 + 20, bottom: height }
      : { left: 0, top: height / 2 - 20, right: width, bottom: height / 2 + 20 },
  state: "HALF_OPENED",
  orientation,
  occlusionType: "NONE",
  isSeparating: true,
});

/** Cover display → iPad Split View (narrow) → unfolded → book → laptop (tabletop) → closed. */
const POSTURES: WindowChange[] = [
  { width: 320, height: 1000, foldingFeatures: [] },
  { width: 669, height: 951, foldingFeatures: [] },
  { width: 669, height: 951, foldingFeatures: [fold("VERTICAL", 669, 951)] },
  { width: 951, height: 669, foldingFeatures: [fold("HORIZONTAL", 951, 669)] },
  { width: 382, height: 644, foldingFeatures: [] },
];

const regionClearsFold = (change: WindowChange) => {
  const region = StyleSheet.flatten(screen.getByTestId("form-hinge-safe").props.style);
  for (const feature of change.foldingFeatures ?? []) {
    const b = feature.bounds;
    if (feature.orientation === "VERTICAL")
      expect(region.left + region.width <= b.left || region.left >= b.right).toBe(true);
    else expect(region.top + region.height <= b.top || region.top >= b.bottom).toBe(true);
  }
};

const api = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  api.mockResolvedValue({ ok: true });
  setWindow({ width: 382, height: 644, foldingFeatures: [] });
  jest.mocked(useSession).mockReturnValue({
    api,
    writable: true,
    session: { user: { role: "owner", memberType: "member" } },
  } as unknown as ReturnType<typeof useSession>);
});
afterEach(cleanup);

test("a new task keeps what was typed through resizes and every fold posture", async () => {
  jest.mocked(useResource).mockImplementation((path: string, enabled = true) => {
    // A disabled query (the task lookup for a new task) has no data, like react-query.
    if (!enabled) return { isPending: true, data: undefined } as never;
    const value =
      path === "/teams" ? { teams: [] } : path === "/members" ? { members: [] } : { projects: [] };
    return { isPending: false, data: { value } } as never;
  });
  await render(<TaskForm />);
  await fireEvent.changeText(screen.getByLabelText("Tên công việc"), "Gọi khách hàng");
  await fireEvent.changeText(screen.getByLabelText("Mô tả"), "Xác nhận lịch giao hàng");
  const title = screen.getByLabelText("Tên công việc");

  for (const change of POSTURES) {
    await act(async () => setWindow(change));
    regionClearsFold(change);
    // Same native input: the form was re-laid out, not remounted.
    expect(screen.getByLabelText("Tên công việc")).toBe(title);
    expect(screen.getByLabelText("Tên công việc").props.value).toBe("Gọi khách hàng");
    expect(screen.getByLabelText("Mô tả").props.value).toBe("Xác nhận lịch giao hàng");
  }

  await fireEvent.press(screen.getByLabelText("Lưu công việc"));
  expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({
    title: "Gọi khách hàng",
    description: "Xác nhận lịch giao hàng",
  });
});

test("an appointment being edited keeps its draft through resizes and every fold posture", async () => {
  jest.mocked(useResource).mockImplementation((path: string) => {
    if (path === "/teams") return { data: { value: { teams: [] } } } as never;
    return {
      isPending: false,
      error: undefined,
      data: {
        value: {
          event: {
            id: "event-1",
            revision: "r1",
            title: "Họp đội",
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
  await render(<EventForm id="event-1" />);
  await fireEvent.changeText(screen.getByLabelText("Tên lịch hẹn"), "Họp đội (dời giờ)");
  await fireEvent.changeText(screen.getByLabelText("Ghi chú"), "Mang báo cáo quý");
  const title = screen.getByLabelText("Tên lịch hẹn");

  for (const change of POSTURES) {
    await act(async () => setWindow(change));
    regionClearsFold(change);
    expect(screen.getByLabelText("Tên lịch hẹn")).toBe(title);
    expect(screen.getByLabelText("Tên lịch hẹn").props.value).toBe("Họp đội (dời giờ)");
    expect(screen.getByLabelText("Ghi chú").props.value).toBe("Mang báo cáo quý");
  }

  await fireEvent.press(screen.getByLabelText("Lưu lịch hẹn"));
  expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({
    expectedRevision: "r1",
    title: "Họp đội (dời giờ)",
    description: "Mang báo cáo quý",
  });
});
