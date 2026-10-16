import * as Picker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  clearTemporaryFiles,
  openAttachment,
  uploadFile,
  pickTextFile,
} from "../src/core/files";
import type { Attachment } from "../src/core/types";

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(),
}));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  FileSystemUploadType: { BINARY_CONTENT: "binary" },
  deleteAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  createDownloadResumable: jest.fn(),
  createUploadTask: jest.fn(),
  readAsStringAsync: jest.fn(),
  EncodingType: { UTF8: 'utf8' },
}));
jest.mock("expo-sharing", () => ({
  shareAsync: jest.fn(),
}));
jest.mock("react-native", () => ({
  Linking: { openURL: jest.fn() },
}));
jest.mock("../src/core/api", () => ({
  API_URL: "https://test.local",
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const deleteAsync = FileSystem.deleteAsync as jest.Mock;
const makeDirectoryAsync = FileSystem.makeDirectoryAsync as jest.Mock;
const createDownloadResumable = FileSystem.createDownloadResumable as jest.Mock;
const createUploadTask = FileSystem.createUploadTask as jest.Mock;
const shareAsync = Sharing.shareAsync as jest.Mock;
const getDocumentAsync = Picker.getDocumentAsync as jest.Mock;

const file: Attachment = {
  id: "attachment-private",
  title: "Private task attachment",
  kind: "file",
  originalName: "private.txt",
  mimeType: "text/plain",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForCall(mock: jest.Mock) {
  for (
    let attempt = 0;
    attempt < 20 && mock.mock.calls.length === 0;
    attempt += 1
  )
    await Promise.resolve();
  expect(mock).toHaveBeenCalled();
}

function captureConsole() {
  const methods = ["debug", "info", "log", "warn", "error"] as const;
  const spies = methods.map((method) =>
    jest.spyOn(console, method).mockImplementation(() => {}),
  );
  return {
    spies,
    text: () =>
      spies
        .flatMap((spy) => spy.mock.calls.flat())
        .map(String)
        .join(" "),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  deleteAsync.mockReset();
  deleteAsync.mockResolvedValue(undefined);
  makeDirectoryAsync.mockReset();
  makeDirectoryAsync.mockResolvedValue(undefined);
  createDownloadResumable.mockReset();
  createUploadTask.mockReset();
  shareAsync.mockReset();
  shareAsync.mockResolvedValue(undefined);
  getDocumentAsync.mockReset();
  (FileSystem.readAsStringAsync as jest.Mock).mockReset();
  await clearTemporaryFiles();
  jest.clearAllMocks();
});

test('import text picker deletes cache after reading without retaining a second file copy', async () => {
  getDocumentAsync.mockResolvedValue({canceled:false,assets:[{uri:'file:///cache/DocumentPicker/import.csv',name:'import.csv',size:16}]});
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('title\nPrivate');
  await expect(pickTextFile(64)).resolves.toEqual({name:'import.csv',content:'title\nPrivate'});
  expect(deleteAsync).toHaveBeenCalledWith('file:///cache/DocumentPicker/import.csv',{idempotent:true});
});

test('import text read finishing after session change is discarded and cleaned', async () => {
  const read=deferred<string>();
  getDocumentAsync.mockResolvedValue({canceled:false,assets:[{uri:'file:///cache/DocumentPicker/import.csv',name:'import.csv',size:16}]});
  (FileSystem.readAsStringAsync as jest.Mock).mockReturnValue(read.promise);
  const pending=pickTextFile(64);await waitForCall(FileSystem.readAsStringAsync as jest.Mock);await clearTemporaryFiles();read.resolve('title\nPrivate');
  await expect(pending).rejects.toMatchObject({status:499});expect(deleteAsync).toHaveBeenCalledWith('file:///cache/DocumentPicker/import.csv',{idempotent:true});
});

test('oversized import deletes picker cache before returning validation error', async () => {
  getDocumentAsync.mockResolvedValue({canceled:false,assets:[{uri:'file:///cache/DocumentPicker/large.csv',name:'large.csv',size:65}]});
  await expect(pickTextFile(64)).rejects.toThrow('tối đa');expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();expect(deleteAsync).toHaveBeenCalledWith('file:///cache/DocumentPicker/large.csv',{idempotent:true});
});

test("restart cleanup removes both temporary cache directories", async () => {
  await clearTemporaryFiles();

  expect(deleteAsync).toHaveBeenCalledWith("file:///cache/nhactoi-downloads", {
    idempotent: true,
  });
  expect(deleteAsync).toHaveBeenCalledWith("file:///cache/DocumentPicker", {
    idempotent: true,
  });
});

test("active download cancellation rejects before sharing and removes its destination", async () => {
  const download = deferred<undefined>();
  const transfer = {
    downloadAsync: jest.fn(() => download.promise),
    cancelAsync: jest.fn(async () => download.resolve(undefined)),
  };
  createDownloadResumable.mockReturnValue(transfer);
  const logs = captureConsole();

  try {
    const pending = openAttachment("private-task-id", file, "old-token");
    await waitForCall(createDownloadResumable);
    const clearing = clearTemporaryFiles();
    await expect(pending).rejects.toMatchObject({ status: 499 });
    await clearing;

    const destination = createDownloadResumable.mock.calls[0][1] as string;
    expect(transfer.cancelAsync).toHaveBeenCalledTimes(1);
    expect(shareAsync).not.toHaveBeenCalled();
    expect(deleteAsync).toHaveBeenCalledWith(destination, { idempotent: true });
    expect(logs.text()).not.toContain("private-task-id");
    expect(logs.text()).not.toContain("old-token");
  } finally {
    logs.restore();
  }
});

test("upload started during cleanup rejects 499 after session invalidation without starting a task", async () => {
  const cleanupGate = deferred<void>();
  deleteAsync.mockImplementation(() => cleanupGate.promise);
  const firstCleanup = clearTemporaryFiles();
  await waitForCall(deleteAsync);

  const staleUpload = uploadFile(
    "private-task-id",
    {
      uri: "file:///cache/private.txt",
      name: "private.txt",
      size: 7,
      mimeType: "text/plain",
    } as Picker.DocumentPickerAsset,
    "old-token",
  );
  await flush();
  const secondCleanup = clearTemporaryFiles();
  cleanupGate.resolve();

  await expect(staleUpload).rejects.toMatchObject({ status: 499 });
  await Promise.all([firstCleanup, secondCleanup]);
  expect(createUploadTask).not.toHaveBeenCalled();
});

test("directory creation invalidation rejects before creating a download transfer", async () => {
  const directoryGate = deferred<void>();
  makeDirectoryAsync.mockImplementation(() => directoryGate.promise);
  const logs = captureConsole();

  try {
    const staleDownload = openAttachment("private-task-id", file, "old-token");
    await waitForCall(makeDirectoryAsync);
    const clearing = clearTemporaryFiles();
    directoryGate.resolve();

    await expect(staleDownload).rejects.toMatchObject({ status: 499 });
    await clearing;
    expect(createDownloadResumable).not.toHaveBeenCalled();
    expect(shareAsync).not.toHaveBeenCalled();
    expect(logs.text()).not.toContain("private-task-id");
    expect(logs.text()).not.toContain("old-token");
  } finally {
    logs.restore();
  }
});

test("failed sharing still deletes the downloaded temporary file without logging task content", async () => {
  const transfer = {
    downloadAsync: jest.fn(async () => ({
      status: 200,
      uri: "file:///cache/downloaded-private.txt",
    })),
    cancelAsync: jest.fn(async () => {}),
  };
  createDownloadResumable.mockReturnValue(transfer);
  shareAsync.mockRejectedValue(new Error("share failed"));
  const logs = captureConsole();

  try {
    await expect(
      openAttachment("private-task-id", file, "old-token"),
    ).rejects.toThrow("share failed");
    const destination = createDownloadResumable.mock.calls[0][1] as string;
    expect(deleteAsync).toHaveBeenCalledWith(destination, { idempotent: true });
    expect(logs.text()).not.toContain("private-task-id");
    expect(logs.text()).not.toContain("old-token");
    expect(logs.text()).not.toContain(file.title);
  } finally {
    logs.restore();
  }
});
