import React from "react";
import { act, render, waitFor, cleanup } from "@testing-library/react-native";
import { Providers, useSession, queryClient } from "../src/core/session";
import { request, ApiError } from "../src/core/api";
import { cacheWrite, cacheClear } from "../src/core/cache";
import * as SecureStore from "expo-secure-store";
import type { Session } from "../src/core/types";
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: () => () => {} },
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("../src/core/cache", () => ({
  cacheRead: jest.fn(async () => null),
  cacheWrite: jest.fn(async () => {}),
  cacheClear: jest.fn(async () => {}),
}));
jest.mock("../src/core/files", () => ({
  clearTemporaryFiles: jest.fn(async () => {}),
}));
jest.mock("../src/core/api", () => ({
  API_URL: "https://test.local",
  request: jest.fn(),
  ApiError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
const fixture: Session = {
  token: "bearer",
  expiresAt: "2099-01-01T00:00:00Z",
  verifiedAt: Date.now(),
  user: { id: "u", name: "User", email: "test@test.local", role: "owner" },
  workspace: { id: "a", name: "A" },
  subscription: {
    status: "active",
    plan: "team",
    currentPeriodEnd: "2099-01-01T00:00:00Z",
  },
};
let context: ReturnType<typeof useSession>;
function Probe() {
  context = useSession();
  return null;
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const transport = jest.mocked(request);
beforeEach(() => {
  transport.mockReset();
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});
async function signedIn() {
  await render(
    <Providers>
      <Probe />
    </Providers>,
  );
  await waitFor(() => expect(context.loading).toBe(false));
  transport.mockResolvedValueOnce(fixture);
  await act(async () => context.login("user", "password"));
}

test("mobile registration stores the returned bearer session", async () => {
  await render(
    <Providers>
      <Probe />
    </Providers>,
  );
  await waitFor(() => expect(context.loading).toBe(false));
  const registered = { ...fixture, token: "registered-bearer" };
  transport.mockResolvedValueOnce(registered);

  await act(async () =>
    context.register({
      name: "Người dùng mới",
      email: "new@example.local",
      password: "password123",
      workspaceName: "Không gian mới",
      industry: "Dịch vụ",
    }),
  );

  expect(transport).toHaveBeenCalledWith("/mobile/auth/register", undefined, {
    method: "POST",
    body: JSON.stringify({
      name: "Người dùng mới",
      email: "new@example.local",
      password: "password123",
      workspaceName: "Không gian mới",
      industry: "Dịch vụ",
    }),
  });
  expect(context.session?.token).toBe("registered-bearer");
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    "nhactoi.session",
    expect.stringContaining('"token":"registered-bearer"'),
  );
});

test("workspace transition blocks new reads and ignores an old /me response", async () => {
  await signedIn();
  const oldMe = deferred<Session>(),
    switchResponse = deferred<Session>();
  transport.mockImplementation((path) => {
    if (path === "/me") return oldMe.promise;
    if (path === "/mobile/workspaces/switch") return switchResponse.promise;
    return Promise.resolve({ tasks: [{ id: "task-b" }] });
  });
  let refresh!: Promise<void>, switching!: Promise<void>;
  await act(async () => {
    refresh = context.refresh();
    switching = context.switchWorkspace("b");
  });
  await expect(context.read("/tasks")).rejects.toMatchObject({ status: 409 });
  expect(cacheWrite).not.toHaveBeenCalled();
  await act(async () => {
    switchResponse.resolve({ ...fixture, workspace: { id: "b", name: "B" } });
    await switching;
  });
  await act(async () => {
    oldMe.resolve(fixture);
    await refresh;
  });
  expect(context.session?.workspace.id).toBe("b");
  await act(async () => {
    await context.read("/tasks");
  });
  expect(cacheWrite).toHaveBeenLastCalledWith(
    JSON.stringify(["https://test.local", "u", "b"]),
    "/tasks",
    { tasks: [{ id: "task-b" }] },
  );
});
test("a delayed detail response cannot restore cache after a permission denial", async () => {
  await signedIn();
  const delayed = deferred<unknown>();
  transport.mockImplementation((path) =>
    path === "/tasks/old/detail"
      ? delayed.promise
      : Promise.reject(new ApiError(403, "revoked")),
  );
  const read = context.read("/tasks/old/detail");
  const rejection = expect(read).rejects.toMatchObject({ status: 499 });
  await act(async () => {
    await expect(context.api("/tasks/old/collaboration")).rejects.toMatchObject(
      { status: 403 },
    );
  });
  expect(cacheClear).toHaveBeenCalledWith(
    JSON.stringify(["https://test.local", "u", "a"]),
  );
  await act(async () => {
    delayed.resolve({ task: { title: "revoked title" } });
    await rejection;
  });
  expect(cacheWrite).not.toHaveBeenCalled();
});
test("lost workspace switch response logs out instead of retaining uncertain cache scope", async () => {
  await signedIn();
  transport.mockRejectedValue(new ApiError(0, "connection lost"));
  await act(async () => {
    await expect(context.switchWorkspace("b")).rejects.toMatchObject({
      status: 0,
    });
  });
  expect(context.session).toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("nhactoi.session");
});
test("expired offline permission hides content until verification and clears on server failure", async () => {
  await signedIn();
  const now = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 86400001);
  let reject!: (reason: unknown) => void;
  transport.mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  let refresh!: Promise<void>;
  try {
    await act(async () => {
      refresh = context.refresh();
    });
    expect(context.loading).toBe(true);
    await act(async () => {
      reject(new ApiError(503, "unavailable"));
      await refresh;
    });
    expect(context.loading).toBe(false);
    expect(context.session).toBeNull();
    expect(cacheClear).toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
});
