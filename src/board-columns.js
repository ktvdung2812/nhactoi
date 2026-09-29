export function taskBelongsToBoard(task, teamId) {
  if (task?.kind && task.kind !== "task") return false;
  const taskTeam = task?.teamId || null;
  const boardTeam = teamId || null;
  return taskTeam === boardTeam;
}

export function resolveDisplayedColumn(task, activeColumns, { placeByStatus = false, teamId = null } = {}) {
  const columns = Array.isArray(activeColumns) ? activeColumns : [];
  const explicit = task?.columnId == null || String(task.columnId) === "" ? "" : String(task.columnId);
  const listed = explicit !== "" && columns.some((column) => String(column.id) === explicit);
  if ((!placeByStatus || taskBelongsToBoard(task, teamId)) && explicit && (listed || !placeByStatus)) return explicit;
  const status = task?.status == null || String(task.status) === "" ? "todo" : String(task.status);
  const home = columns.find((column) => String(column.status) === status);
  return home ? String(home.id) : status;
}

export function classifyColumnDrop(task, columnId, activeColumns, { placeByStatus = false, teamId = null } = {}) {
  const columns = Array.isArray(activeColumns) ? activeColumns : [];
  const column = columns.find((item) => String(item.id) === String(columnId));
  if (!column) return { mode: "error", message: "Cột đích không còn hoạt động." };
  if (!placeByStatus || taskBelongsToBoard(task, teamId)) return { mode: "board", column };
  const home = columns.find((item) => String(item.status) === String(column.status));
  if (!home || String(home.id) !== String(column.id)) {
    return { mode: "error", message: "Cột tùy chỉnh chỉ nhận công việc thuộc bảng đang chọn." };
  }
  const current = resolveDisplayedColumn(task, columns, { placeByStatus, teamId });
  if (current === String(column.id)) return { mode: "skip", column };
  return { mode: "status", status: String(column.status), column };
}
