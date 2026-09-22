export const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
export const BOARD_TRANSFER_MAX_TASKS = 500;
export const BOARD_TRANSFER_MAX_COLUMNS = 40;

// Count the UTF-8 request actually sent, independent of export indentation.
export function boardTransferBody(data, teamId = null) {
  if (!data || data.format !== 'nhactoi-board' || data.version !== 1 ||
      !Array.isArray(data.tasks) || !Array.isArray(data.columns)) {
    throw new Error('Cần tệp xuất từ Nhắc tôi phiên bản 1');
  }
  if (data.tasks.length > BOARD_TRANSFER_MAX_TASKS || data.columns.length > BOARD_TRANSFER_MAX_COLUMNS) {
    throw new Error('Mỗi lần nhập/xuất tối đa 500 công việc và 40 cột');
  }
  const body = JSON.stringify({ teamId: teamId || null, data });
  if (new TextEncoder().encode(body).byteLength > JSON_BODY_LIMIT_BYTES) {
    throw new Error('Dữ liệu nhập/xuất vượt quá 1 MiB sau khi bỏ thụt lề JSON. Vui lòng giảm dữ liệu của bảng.');
  }
  return body;
}
