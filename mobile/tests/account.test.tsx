import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
// The CommonJS module itself: a namespace import is an interop copy that spyOn cannot patch.
const ReactNative = jest.requireActual<typeof import("react-native")>("react-native");
import { Alert, Linking, StyleSheet, type AlertButton } from "react-native";
import { Account } from "../src/features/Account";
import { useResource, useSession } from "../src/core/session";

jest.mock("react-native-safe-area-context", () =>
  jest.requireActual("react-native-safe-area-context/jest/mock").default,
);
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../src/core/session", () => ({ useResource: jest.fn(), useSession: jest.fn() }));
jest.mock("../src/core/push", () => ({ unregisterPush: jest.fn(async () => undefined) }));
jest.mock("../src/features/OfflineQueue", () => ({ OfflineQueue: () => null }));
jest.mock("../src/core/api", () => ({
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Có lỗi xảy ra."),
}));

const logout = jest.fn(async () => undefined);
const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useSession).mockReturnValue({
    session: {
      user: { id: "u1", name: "Nguyễn An", email: "an@example.com", role: "owner", memberType: "member" },
      workspace: { id: "w1", name: "Đội Nhắc Tôi" },
      subscription: { plan: "pro", planName: "Pro", currentPeriodEnd: null },
    },
    switchWorkspace: jest.fn(),
    logout,
    online: true,
    writable: true,
    api: jest.fn(),
  } as unknown as ReturnType<typeof useSession>);
  jest.mocked(useResource).mockReturnValue({ data: undefined, error: null, refetch: jest.fn() } as never);
});
afterEach(cleanup);

test("the iOS sign-out alert can be cancelled without signing out", async () => {
  await render(<Account />);
  await fireEvent.press(screen.getByLabelText("Đăng xuất"));
  const buttons = alert.mock.calls[0][2] as AlertButton[];
  // `cancelable` is Android-only; iOS needs an explicit cancel action or every button signs out.
  expect(buttons.map((button) => [button.text, button.style ?? "default"])).toEqual([
    ["Đồng bộ trước", "default"],
    ["Giữ nháp mã hóa", "default"],
    ["Xóa nháp và thoát", "destructive"],
    ["Hủy", "cancel"],
  ]);
  expect(buttons[3].onPress).toBeUndefined();
  await act(async () => buttons[1].onPress?.());
  await waitFor(() => expect(logout).toHaveBeenCalledWith("keep"));
});

test("the notification settings action is not labelled Android on iOS", async () => {
  await render(<Account />);
  expect(screen.queryByLabelText("Cài đặt thông báo Android")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Cài đặt thông báo"));
  expect(openSettings).toHaveBeenCalledTimes(1);
});

const windowWith = (fontScale: number) =>
  jest
    .spyOn(ReactNative, "useWindowDimensions")
    .mockReturnValue({ width: 1032, height: 1376, scale: 2, fontScale });

test("account content keeps a readable width on iPad and insets itself for the keyboard", async () => {
  windowWith(1);
  await render(<Account />);
  const scroll = screen.getByTestId("account-scroll");
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    maxWidth: 760,
    width: "100%",
    alignSelf: "center",
  });
  expect(scroll.props).toMatchObject({
    automaticallyAdjustKeyboardInsets: true,
    keyboardDismissMode: "interactive",
    keyboardShouldPersistTaps: "handled",
  });
  expect(screen.getByLabelText("Liên kết mời").props).toMatchObject({
    keyboardType: "url",
    textContentType: "URL",
    autoCorrect: false,
  });
});

test("the readable column widens with Dynamic Type instead of wrapping word by word", async () => {
  windowWith(3.1); // AX5
  await render(<Account />);
  expect(
    StyleSheet.flatten(screen.getByTestId("account-scroll").props.contentContainerStyle).maxWidth,
  ).toBe(1330);
});
