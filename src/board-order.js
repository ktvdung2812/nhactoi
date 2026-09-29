export function reorderBeforeId(cards, draggedId, clientY) {
  const rows = Array.isArray(cards) ? cards : [];
  for (const card of rows) {
    if (card?.id == null || String(card.id) === String(draggedId)) continue;
    const top = Number(card.top);
    const height = Number(card.height);
    if (!Number.isFinite(top) || !Number.isFinite(height)) continue;
    if (clientY < top + height / 2) return card.id;
  }
  return null;
}

export function reorderIsNoop(cards, draggedId, beforeId) {
  const rows = Array.isArray(cards) ? cards : [];
  const index = rows.findIndex((card) => String(card?.id) === String(draggedId));
  if (index < 0) return false;
  const nextId = rows[index + 1]?.id ?? null;
  return String(nextId ?? "") === String(beforeId ?? "");
}

export function moveColumnId(order, draggedId, targetId, before) {
  const rows = Array.isArray(order) ? order.map(String) : [];
  const from = rows.indexOf(String(draggedId));
  if (from < 0) return null;
  const next = [...rows];
  next.splice(from, 1);
  let to = next.indexOf(String(targetId));
  if (to < 0) return null;
  if (!before) to += 1;
  next.splice(to, 0, String(draggedId));
  return next;
}

export function moveColumnToEndId(order, draggedId) {
  const rows = Array.isArray(order) ? order.map(String) : [];
  const id = String(draggedId);
  if (!rows.includes(id)) return null;
  return [...rows.filter((value) => value !== id), id];
}
