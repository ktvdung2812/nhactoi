import * as Picker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Linking } from "react-native";
import { API_URL, ApiError } from "./api";
import type { Attachment } from "./types";
let generation = 0;
let cleanup = Promise.resolve();
const transfers = new Set<{ cancelAsync: () => Promise<void> }>();
export function clearTemporaryFiles() {
  generation++;
  const active = [...transfers];
  cleanup = cleanup
    .catch(() => {})
    .then(async () => {
      await Promise.all(active.map((t) => t.cancelAsync().catch(() => {})));
      for (const name of ["nhactoi-downloads", "DocumentPicker"])
        await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${name}`, {
          idempotent: true,
        });
    });
  return cleanup;
}
export async function pickFiles(maxMb: number, multiple = false) {
  const version = generation;
  await cleanup;
  if (version !== generation)
    throw new ApiError(499, "Phiên làm việc đã thay đổi.");
  const result = await Picker.getDocumentAsync({
    multiple,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  if (version !== generation) {
    for (const f of result.assets)
      await FileSystem.deleteAsync(f.uri, { idempotent: true });
    throw new ApiError(499, "Phiên làm việc đã thay đổi.");
  }
  if (result.assets.length > 10 || result.assets.some((f) => !f.size || f.size > maxMb * 1024 * 1024)) {
    await Promise.all(result.assets.map(f => FileSystem.deleteAsync(f.uri, { idempotent: true })));
    throw new Error(result.assets.length > 10 ? 'Mỗi lần tối đa 10 tệp.' : `Chọn tệp có dữ liệu, tối đa ${maxMb} MB/tệp.`);
  }
  return result.assets;
}
export async function uploadFile(
  taskId: string,
  file: Picker.DocumentPickerAsset,
  token: string,
): Promise<Attachment> {
  const version = generation;
  await cleanup;
  if (version !== generation)
    throw new ApiError(499, "Phiên làm việc đã thay đổi.");
  const transfer = FileSystem.createUploadTask(
    `${API_URL}/api/tasks/${encodeURIComponent(taskId)}/files`,
    file.uri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
    },
  );
  transfers.add(transfer);
  const result = await transfer
    .uploadAsync()
    .finally(() => transfers.delete(transfer));
  if (!result || version !== generation)
    throw new ApiError(499, "Tải tệp đã hủy do phiên làm việc thay đổi.");
  if (result.status < 200 || result.status >= 300)
    throw new ApiError(
      result.status,
      "Không tải được tệp. Kiểm tra quyền và dung lượng rồi thử lại.",
    );
  return JSON.parse(result.body).attachment;
}
export async function openAttachment(
  taskId: string,
  file: Attachment,
  token: string,
) {
  const version = generation;
  await cleanup;
  if (version !== generation)
    throw new ApiError(499, "Phiên làm việc đã thay đổi.");
  if (file.kind === "link") {
    const url = new URL(file.url || "");
    if (!["https:", "http:"].includes(url.protocol))
      throw new Error("Liên kết không hợp lệ.");
    await Linking.openURL(url.href);
    return;
  }
  const directory = `${FileSystem.cacheDirectory}nhactoi-downloads/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  if (version !== generation)
    throw new ApiError(499, "Phiên làm việc đã thay đổi.");
  const name =
    (file.originalName || file.title)
      .replace(/[^\p{L}\p{N}._ -]/gu, "_")
      .slice(0, 160) || "attachment";
  const destination = directory + Date.now() + "-" + name;
  const transfer = FileSystem.createDownloadResumable(
    `${API_URL}/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(file.id)}/download`,
    destination,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  transfers.add(transfer);
  try {
    const result = await transfer.downloadAsync();
    if (!result || version !== generation)
      throw new ApiError(499, "Tải xuống đã hủy do phiên làm việc thay đổi.");
    if (result.status !== 200)
      throw new ApiError(
        result.status,
        "Không thể tải tệp hoặc quyền truy cập đã thay đổi.",
      );
    await Sharing.shareAsync(result.uri, {
      mimeType: file.mimeType,
      dialogTitle: file.title,
    });
  } finally {
    transfers.delete(transfer);
    await FileSystem.deleteAsync(destination, { idempotent: true });
  }
}

// Reuse the authenticated session's temporary-file lifecycle for user exports.
export async function shareGeneratedText(name: string, content: string, mimeType = 'text/csv') {
  const version = generation;
  await cleanup;
  if (version !== generation) throw new ApiError(499, 'Phiên làm việc đã thay đổi.');
  const directory = `${FileSystem.cacheDirectory}nhactoi-downloads/`;
  const destination = directory + Date.now() + '-' + name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120);
  try {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await FileSystem.writeAsStringAsync(destination, content);
    if (version !== generation) throw new ApiError(499, 'Phiên làm việc đã thay đổi.');
    await Sharing.shareAsync(destination, { mimeType, dialogTitle: name });
  } finally {
    await FileSystem.deleteAsync(destination, { idempotent: true });
  }
}

export async function pickTextFile(maxBytes: number): Promise<{ name: string; content: string } | null> {
  const version = generation;
  const [file] = await pickFiles(maxBytes / (1024 * 1024));
  if (!file) return null;
  try {
    const content = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 });
    if (version !== generation) throw new ApiError(499, 'Phiên làm việc đã thay đổi.');
    return { name: file.name, content };
  } finally {
    await FileSystem.deleteAsync(file.uri, { idempotent: true });
  }
}
