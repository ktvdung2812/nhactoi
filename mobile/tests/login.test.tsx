import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
// The CommonJS module itself: a namespace import is an interop copy that spyOn cannot patch.
const ReactNative = jest.requireActual<typeof import("react-native")>("react-native");
import { StyleSheet, TextInput } from "react-native";
import { Login } from "../src/features/Login";
import { useSession } from "../src/core/session";
import type { NhactoiFoldingFeature } from "../modules/nhactoi-window";

jest.mock("react-native-safe-area-context", () =>
  jest.requireActual("react-native-safe-area-context/jest/mock").default,
);
jest.mock("../src/core/session", () => ({ useSession: jest.fn() }));
jest.mock("../src/core/api", () => ({
  request: jest.fn(),
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Có lỗi xảy ra.",
}));
// A controllable window: the real HingeSafe re-lays out when the store changes, exactly as it
// does when iOS resizes the scene or the iPhone Duo fold becomes active.
jest.mock("../src/ui/adaptive", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  type MockWindow = { width: number; height: number; foldingFeatures: NhactoiFoldingFeature[]; fontScale?: number };
  let state: MockWindow = { width: 382, height: 644, foldingFeatures: [] };
  const listeners = new Set<() => void>();
  return {
    __setWindow(next: Partial<MockWindow>) {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener());
    },
    useAdaptiveWindow: () => {
      const dimensions = jest.requireActual<typeof import("react-native")>("react-native").useWindowDimensions();
      const current: MockWindow = useSyncExternalStore(
        (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => state,
      );
      return { ...current, fontScale: current.fontScale ?? dimensions.fontScale, layout: { posture: current.foldingFeatures.some((f) => f.orientation === "HORIZONTAL" && f.isSeparating) ? "tabletop" : "flat" } };
    },
  };
});

const setWindow = (jest.requireMock("../src/ui/adaptive") as {
  __setWindow: (next: {
    width?: number;
    height?: number;
    foldingFeatures?: NhactoiFoldingFeature[];
    fontScale?: number;
  }) => void;
}).__setWindow;
const login = jest.fn();
const focus = TextInput.prototype.focus as jest.Mock;
const focusedTestIDs = () =>
  focus.mock.contexts.map((input) => (input as TextInput & { props: { testID?: string } }).props.testID);

beforeEach(() => {
  jest.clearAllMocks();
  login.mockResolvedValue(undefined);
  jest
    .mocked(useSession)
    .mockReturnValue({ login, error: "" } as unknown as ReturnType<typeof useSession>);
  setWindow({ width: 382, height: 644, foldingFeatures: [], fontScale: undefined });
});
afterEach(cleanup);

test("the email return key moves to the password and the password return key signs in", async () => {
  await render(<Login />);
  await fireEvent.changeText(screen.getByTestId("login-email"), " an@example.com ");
  await fireEvent(screen.getByTestId("login-email"), "submitEditing");
  expect(focusedTestIDs()).toEqual(["login-password"]);

  await fireEvent.changeText(screen.getByTestId("login-password"), "password123");
  await fireEvent(screen.getByTestId("login-password"), "submitEditing");
  await waitFor(() => expect(login).toHaveBeenCalledWith("an@example.com", "password123"));
});

test("sign-in fields use the iOS Password AutoFill content types and keyboard keys", async () => {
  await render(<Login />);
  const email = screen.getByTestId("login-email");
  const password = screen.getByTestId("login-password");
  expect(email.props).toMatchObject({
    textContentType: "username",
    keyboardType: "email-address",
    returnKeyType: "next",
    submitBehavior: "submit",
    autoCorrect: false,
  });
  expect(password.props).toMatchObject({
    textContentType: "password",
    secureTextEntry: true,
    returnKeyType: "go",
  });
});

test("on iOS the scroll view brings a focused field above the keyboard", async () => {
  await render(<Login />);
  expect(screen.getByTestId("login-scroll").props).toMatchObject({
    automaticallyAdjustKeyboardInsets: true,
    keyboardDismissMode: "interactive",
    keyboardShouldPersistTaps: "handled",
  });
});

test("decorative hero text stops growing so the form stays reachable at accessibility sizes", async () => {
  await render(<Login />);
  expect(screen.getByRole("header").props.maxFontSizeMultiplier).toBe(1.4);
  expect(screen.getByLabelText("Nhắc tôi").props.maxFontSizeMultiplier).toBe(1.4);
  // Labels, inputs and buttons keep the full Dynamic Type range.
  // The visible label is accessibility-hidden (the input carries the accessible label).
  expect(
    screen.getByText("Mật khẩu", { includeHiddenElements: true }).props.maxFontSizeMultiplier,
  ).toBeUndefined();
  expect(screen.getByTestId("login-email").props.maxFontSizeMultiplier).toBeUndefined();
});

test("typed credentials survive an iPhone Duo fold, a book posture and a resize without a remount", async () => {
  await render(<Login />);
  await fireEvent.changeText(screen.getByTestId("login-email"), "an@example.com");
  await fireEvent.changeText(screen.getByTestId("login-password"), "password123");
  const emailBefore = screen.getByTestId("login-email");

  // Unfolded inner display, then partially folded like a book: a 40 pt division at the center.
  await act(async () => setWindow({ width: 669, height: 951 }));
  await act(async () =>
    setWindow({
      foldingFeatures: [
        {
          bounds: { left: 314.5, top: 0, right: 354.5, bottom: 951 },
          state: "HALF_OPENED",
          orientation: "VERTICAL",
          occlusionType: "NONE",
          isSeparating: true,
        },
      ],
    }),
  );
  const region = StyleSheet.flatten(screen.getByTestId("login-hinge-safe").props.style);
  // The form sits wholly on one side of the fold, clear of the hinge margin.
  expect(region.left + region.width <= 314.5 || region.left >= 354.5).toBe(true);

  // Closed again: the cover display.
  await act(async () => setWindow({ width: 382, height: 644, foldingFeatures: [] }));
  expect(screen.getByTestId("login-email")).toBe(emailBefore);
  expect(screen.getByTestId("login-email").props.value).toBe("an@example.com");
  expect(screen.getByTestId("login-password").props.value).toBe("password123");
});

test("the sign-in column widens at accessibility text sizes on iPad", async () => {
  const dims = jest.spyOn(ReactNative, "useWindowDimensions");
  dims.mockReturnValue({ width: 756, height: 1158, scale: 2, fontScale: 1 });
  const view = await render(<Login />);
  const column = () => StyleSheet.flatten(screen.getByTestId("login-column").props.style);
  expect(column().maxWidth).toBe(460);
  dims.mockReturnValue({ width: 756, height: 1158, scale: 2, fontScale: 3.1 });
  await view.rerender(<Login />);
  expect(column().maxWidth).toBe(805);
  dims.mockRestore();
});

test("tabletop places independently scrollable hero and controls on opposite sides without remounting inputs", async () => {
  await render(<Login />);
  await fireEvent.changeText(screen.getByTestId("login-email"), "demo@example.com");
  const input = screen.getByTestId("login-email");
  await act(async () => setWindow({ width: 850, height: 880, foldingFeatures: [{
    bounds: { left: 0, top: 430, right: 850, bottom: 450 },
    state: "HALF_OPENED", orientation: "HORIZONTAL", occlusionType: "FULL", isSeparating: true,
  }] }));
  const hero = screen.getByTestId("login-hero-scroll");
  const controls = screen.getByTestId("login-controls-scroll");
  const heroStyle = StyleSheet.flatten(hero.props.style);
  const controlsStyle = StyleSheet.flatten(controls.props.style);
  expect(hero.props.scrollEnabled).toBe(true);
  expect(controls.props.scrollEnabled).toBe(true);
  expect(heroStyle.height).toBeLessThanOrEqual(430);
  expect(heroStyle.height + controlsStyle.marginTop).toBeGreaterThanOrEqual(450);
  expect(screen.getByTestId("login-email")).toBe(input);
  expect(input.props.value).toBe("demo@example.com");
});

test("native font scale updates the readable login width before React Native dimensions catch up", async () => {
  await render(<Login />);
  await act(async () => setWindow({ fontScale: 1.3 }));
  expect(StyleSheet.flatten(screen.getByTestId("login-column").props.style).maxWidth).toBe(598);
});
